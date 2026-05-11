"""
v25.8-#4 — 离线 ASR 复跑(paraformer-v2 batch / 高清).

会议结束的 实时 paraformer-realtime-v2 转录质量虽已 ↑ 30%,但仍受限于
"逐流处理 + 即时输出"约束.离线 paraformer-v2(批量)模型:
  - 看完整段录音再分句,语义边界更准
  - 中文 WER 比 realtime 再降 20-30%
  - 标点 / 多说话人识别更好
  - 缺点:不实时(2-5 分钟),需要先上传录音

流程:
  1. 拿 meeting.recording_oss_key(identify_pipeline 已上传)
  2. 生成 signed_url
  3. 提交 DashScope 异步任务(paraformer-v2)
  4. 轮询任务状态(SUCCEEDED / FAILED / RUNNING)
  5. 下载结果 JSON,解析为句子列表(含 start/end ms + text)
  6. 删除原 final 实录,插入新行
  7. 触发 run_identify (重新对齐说话人) + cleaner + summary

DashScope API ref:
  POST  /api/v1/services/audio/asr/transcription   (X-DashScope-Async: enable)
  GET   /api/v1/tasks/{task_id}                     (轮询)
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, Optional

import httpx
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import SessionLocal
from .models import Meeting, MeetingTranscript
from .oss_client import OSSClient

logger = logging.getLogger(__name__)


OFFLINE_MODEL = "paraformer-v2"
DASHSCOPE_TRANSCRIPTION_URL = (
    "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription"
)
DASHSCOPE_TASK_URL = "https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"

POLL_INTERVAL_S = 5
POLL_MAX_S = 300  # 5 分钟上限


class OfflineASRError(RuntimeError):
    pass


async def rerun_offline_asr(meeting_id: uuid.UUID) -> dict[str, Any]:
    """
    会议级 离线 ASR 复跑.成功后返回 summary dict;失败抛 OfflineASRError.

    Idempotent:可重复点(每次都重新跑 ASR 并 替换 final 实录).
    """
    settings = get_settings()
    if not settings.dashscope_api_key:
        raise OfflineASRError("DASHSCOPE_API_KEY 未配置")

    # 1) 找录音
    async with SessionLocal() as db:
        meeting = (
            await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        ).scalar_one_or_none()
        if not meeting:
            raise OfflineASRError(f"meeting {meeting_id} not found")
        if not meeting.recording_oss_key:
            raise OfflineASRError("会议无录音(recording_oss_key 为空) — 离线 ASR 跑不了")
        oss_key = meeting.recording_oss_key

    oss = OSSClient()
    if not oss.configured:
        raise OfflineASRError("OSS 未配置")
    signed_url = oss.signed_url(oss_key, expires_seconds=3600)

    # 2) 提交异步任务
    headers = {
        "Authorization": f"Bearer {settings.dashscope_api_key.strip()}",
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
    }
    body = {
        "model": OFFLINE_MODEL,
        "input": {"file_urls": [signed_url]},
        "parameters": {
            "sample_rate": 16000,
            "language_hints": ["zh"],
        },
    }
    logger.info("[offline-asr] submit meeting=%s key=%s", meeting_id, oss_key)

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as c:
            r = await c.post(DASHSCOPE_TRANSCRIPTION_URL, headers=headers, json=body)
    except httpx.HTTPError as e:
        raise OfflineASRError(f"提交失败(网络): {e}") from e
    if r.status_code >= 400:
        raise OfflineASRError(f"提交失败 HTTP {r.status_code}: {r.text[:300]}")
    submit_data = r.json()
    task_id = (submit_data.get("output") or {}).get("task_id")
    if not task_id:
        raise OfflineASRError(f"提交响应无 task_id: {submit_data}")
    logger.info("[offline-asr] task_id=%s", task_id)

    # 3) 轮询任务
    poll_headers = {"Authorization": f"Bearer {settings.dashscope_api_key.strip()}"}
    elapsed = 0
    last_status = "?"
    result_url: Optional[str] = None
    while elapsed < POLL_MAX_S:
        await asyncio.sleep(POLL_INTERVAL_S)
        elapsed += POLL_INTERVAL_S
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as c:
                pr = await c.get(
                    DASHSCOPE_TASK_URL.format(task_id=task_id),
                    headers=poll_headers,
                )
        except httpx.HTTPError as e:
            logger.warning("[offline-asr] poll error %s: %s", task_id, e)
            continue
        if pr.status_code >= 400:
            raise OfflineASRError(f"轮询失败 HTTP {pr.status_code}: {pr.text[:300]}")
        pdata = pr.json()
        out = pdata.get("output") or {}
        last_status = out.get("task_status") or "?"
        if last_status == "SUCCEEDED":
            results = out.get("results") or []
            if results and isinstance(results, list):
                result_url = results[0].get("transcription_url")
            break
        if last_status in ("FAILED", "UNKNOWN"):
            raise OfflineASRError(
                f"任务失败 status={last_status} message={out.get('message','')}"
            )

    if not result_url:
        raise OfflineASRError(
            f"任务超时(>{POLL_MAX_S}s) 或 无 transcription_url(last status={last_status})"
        )

    # 4) 下载结果
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as c:
            tr = await c.get(result_url)
    except httpx.HTTPError as e:
        raise OfflineASRError(f"下载结果失败: {e}") from e
    if tr.status_code >= 400:
        raise OfflineASRError(f"下载结果 HTTP {tr.status_code}")
    transcription = tr.json()

    # 5) 解析
    sentences = _flatten_sentences(transcription)
    if not sentences:
        raise OfflineASRError("解析得到 0 句话 — 可能录音异常")
    logger.info("[offline-asr] got %d sentences", len(sentences))

    # 6) 替换 final 实录
    async with SessionLocal() as db:
        await db.execute(
            delete(MeetingTranscript).where(
                MeetingTranscript.meeting_id == meeting_id,
                MeetingTranscript.is_final.is_(True),
            )
        )
        for s in sentences:
            db.add(
                MeetingTranscript(
                    meeting_id=meeting_id,
                    text=s["text"],
                    start_ms=s["start_ms"],
                    end_ms=s["end_ms"],
                    is_final=True,
                    speaker_user_id=None,
                    speaker_label=None,
                    speaker_status="pending_align",
                    confidence=None,
                )
            )
        # reset meeting status 让 run_identify 重新对齐 + cleaner + summary
        await db.execute(
            update(Meeting).where(Meeting.id == meeting_id).values(status="finished")
        )
        await db.commit()

    # 7) 触发 identify + cleaner + summary(复用现有 pipeline)
    from .identify_pipeline import run_identify
    asyncio.create_task(run_identify(meeting_id, final=True))

    return {
        "task_id": task_id,
        "sentences": len(sentences),
        "model": OFFLINE_MODEL,
        "elapsed_s": elapsed,
        "next_step": "已替换实录,正在后台 重新对齐说话人 + LLM 修字 + 重新生成纪要(2-3 分钟)",
    }


def _flatten_sentences(payload: dict) -> list[dict]:
    """从 DashScope transcription 结果 中 抽 (text, start_ms, end_ms) 列表.

    paraformer-v2 输出格式(简化):
      {transcripts: [{text, sentences: [{begin_time, end_time, text}, ...]}, ...]}
    """
    out: list[dict] = []
    transcripts = payload.get("transcripts") or []
    for tr in transcripts:
        sents = tr.get("sentences") or []
        if not sents:
            # 回退:整段当一句
            text = (tr.get("text") or "").strip()
            if text:
                out.append({"text": text, "start_ms": 0, "end_ms": 0})
            continue
        for s in sents:
            text = (s.get("text") or "").strip()
            if not text:
                continue
            out.append({
                "text": text,
                "start_ms": int(s.get("begin_time") or 0),
                "end_ms": int(s.get("end_time") or 0),
            })
    return out
