"""
v27.0-mobile P19-B · 会议参考资料 CRUD.

Endpoints (prefix /api/meetings):
  POST   /attachments                — multipart 上传 (前端 / 小程序 都走这条)
  GET    /attachments?draft_id=...   — 列 draft 下的所有 attachments (创建会议前)
  GET    /{meeting_id}/attachments   — 列已挂会议的 attachments
  DELETE /attachments/{aid}          — 删 (上传人 或 leader+ 可删, 未挂会议 时可删)

跨端 兼容:
  - H5 标准 multipart (浏览器 <input type=file>)
  - 小程序 wx.uploadFile (本质 也是 multipart) — endpoint 复用同一个

抽取流程:
  - 上传 endpoint 立即 落库 (extract_status='pending', 文件 持久化 到 OSS).
  - 小文件 (< 2MB) 同步 抽取 + 返回 (前端 一拿到 response 就知道 ready).
  - 大文件 异步 抽取 (asyncio.create_task), response 立即 返回 status='extracting',
    前端 visibility-change / polling 重拉 拿到 final state.

ABAC:
  - 上传:本 workspace 内任何登录用户.
  - 删:上传人 自己, 或 leader+.
  - 列出: 同 workspace 任何登录用户 (draft 下的 attachments 仅上传人 自己可见).
"""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import audit_log
from ..auth import AuthContext, get_current_auth, is_leader_or_admin
from ..db import get_session
from ..doc_parser import (
    SUPPORTED_EXTENSIONS,
    extract_text,
    extract_text_async,
    kind_from_filename,
)
from ..models import Meeting, MeetingAttachment
from ..oss_client import OSSClient

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/meetings", tags=["meeting-attachments"])


# ===== 常量 =====================================================================

MAX_BYTES = 50 * 1024 * 1024  # 50MB 单文件上限
SYNC_EXTRACT_THRESHOLD = 2 * 1024 * 1024  # < 2MB 同步抽

# 允许的 扩展名 (跟 doc_parser SUPPORTED_EXTENSIONS 一致).
# 文本类 同步 抽; 图片 走 async OCR (Qwen-VL); PPTX 同步 抽 (v27.0-mobile P19-B.2 加).
TEXT_EXTRACTABLE_EXTS = {
    ".pdf", ".docx", ".xlsx", ".xls",
    ".pptx",
    ".txt", ".md", ".markdown", ".text",
    ".csv", ".log", ".json", ".yaml", ".yml",
}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp", ".gif"}
# 联合 — 前端 accept 提示用
ALLOWED_EXTS = TEXT_EXTRACTABLE_EXTS | IMAGE_EXTS

_DRAFT_ID_RE = re.compile(r"^[a-fA-F0-9\-]{8,64}$")


# ===== schemas =================================================================

class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    meeting_id: Optional[uuid.UUID] = None
    client_draft_id: Optional[str] = None
    uploader_user_id: Optional[uuid.UUID] = None

    filename: str
    mime: Optional[str] = None
    extension: Optional[str] = None
    size_bytes: int

    extract_status: str
    # 不返回 extract_text (太长占带宽; 详情接口里 才单独取)
    extract_summary: Optional[str] = None
    last_error: Optional[str] = None


class AttachmentListOut(BaseModel):
    items: list[AttachmentOut]


# ===== helpers =================================================================

def _safe_filename(name: str) -> str:
    """去掉 路径分隔符 / 控制字符 / null. 仍保留中文 + 空格."""
    if not name:
        return "untitled"
    # 把斜杠 + 反斜杠 + null + 控制字符 替换为 _
    cleaned = re.sub(r"[\x00-\x1f/\\]+", "_", name)
    # 截到 200 字符 (DB 是 512 字符 cap, 留余量)
    return cleaned[:200] or "untitled"


def _extension_from_filename(name: str) -> Optional[str]:
    """返回 小写 扩展名, 不含 dot. 例 'pdf'."""
    if "." not in name:
        return None
    return name.rsplit(".", 1)[1].lower()


async def _maybe_summarize(att: MeetingAttachment, text: str) -> Optional[str]:
    """v27.0-mobile P19-B: 用 LLM 把 extract_text 抽成 ≤ 2000 字 summary.

    给 orchestrator / decompose-agenda 直接 拼 prompt 用. 失败 时 返回 None
    (caller 不抛错, 后续 fallback 用 filename + 截断 text).
    """
    from ..db import SessionLocal
    from ..llm_direct import LlmError, get_active_provider, stream_chat

    if not text or len(text.strip()) < 30:
        return text.strip() if text else None  # 短到不必 summarize, 直接当 summary

    # 如果 text 不长 (≤ 1500 字), 直接 当 summary 用 — 省 LLM 调用
    if len(text) <= 1500:
        return text.strip()

    # 长文 → LLM 抽
    async with SessionLocal() as db:
        provider = await get_active_provider(db)
    if provider is None:
        return text[:1500] + "…"  # 退化 截断

    system_prompt = (
        "你是文档摘要助手. 输入一段文档原文, 输出 600-1500 字的中文摘要. "
        "要求: 保留关键 数据 / 数字 / 时间 / 人名 / 决策 / 结论, "
        "丢掉 寒暄 / 抬头 / 模板 / 重复 部分. 摘要里 不要 出现 "
        "'本文档' / '本摘要' / '该资料' 这种自指词, 直接陈述事实."
    )
    user_prompt = f"文档名: {att.filename}\n\n原文 (开头 8000 字):\n{text[:8000]}"

    parts: list[str] = []
    try:
        async for chunk in stream_chat(
            provider=provider,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=0.2,
        ):
            if chunk:
                parts.append(chunk)
    except LlmError as e:
        logger.warning("attachment summary LLM failed att=%s: %s", att.id, e)
        return text[:1500] + "…"

    summary = "".join(parts).strip()
    if not summary:
        return text[:1500] + "…"
    return summary[:2000]


async def _extract_and_save(attachment_id: uuid.UUID, raw: bytes) -> None:
    """v27.0-mobile P19-B: 异步 worker. 抽文本 + LLM summary, 写回 DB.

    大文件 走这条 (上传 endpoint 立刻 返回 'extracting', worker 慢慢跑).
    失败时 状态 = 'failed' + last_error, 不阻塞前端.
    """
    from ..db import SessionLocal

    async with SessionLocal() as db:
        att = (
            await db.execute(
                select(MeetingAttachment).where(MeetingAttachment.id == attachment_id)
            )
        ).scalar_one_or_none()
        if att is None:
            logger.warning("extract worker: attachment %s gone", attachment_id)
            return

        try:
            kind = kind_from_filename(att.filename)
            if kind is None:
                att.extract_status = "skipped"
                att.extract_summary = f"[未支持的文件类型 {att.filename}] 内容暂未识别"
            else:
                # v27.0-mobile P19-B.2: 图片走 async OCR (Qwen-VL),
                # 其他 类型 同步 抽. extract_text_async 内部 自动 分发.
                text = await extract_text_async(att.filename, raw)
                if not text or not text.strip():
                    # OCR 抽空 / 纯装饰图 — 占位 不算 failed
                    att.extract_status = "skipped"
                    att.extract_summary = f"[{att.filename}] 未识别到 文字内容"
                else:
                    att.extract_text = text
                    att.extract_summary = await _maybe_summarize(att, text)
                    att.extract_status = "ready"
        except Exception as e:
            logger.exception("extract worker failed att=%s", attachment_id)
            att.extract_status = "failed"
            att.last_error = str(e)[:1000]
        await db.commit()


# ===== endpoints ===============================================================

@router.post("/attachments", response_model=AttachmentOut)
async def upload_attachment(
    file: UploadFile = File(...),
    client_draft_id: Optional[str] = Form(None),
    meeting_id: Optional[uuid.UUID] = Form(None),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v27.0-mobile P19-B: 上传 一个 会议参考资料.

    入参 (multipart):
      - file: 文件 二进制
      - client_draft_id: 前端 在 新建会议页 生成的 uuid, 用于 跨次 上传 关联同 draft.
                         必须 跟 meeting_id 二选一 (都给 也行, meeting_id 优先).
      - meeting_id: 若 已 创建 会议 (中途追加附件), 给 meeting_id.

    出参: AttachmentOut. extract_status 可能是:
      - 'ready'      — 小文件 同步抽完 + summary
      - 'extracting' — 大文件 异步 抽中 (前端 polling / visibility-change 重拉)
      - 'skipped'    — 图片 / 未支持类型, 占位 summary
      - 'failed'     — 抽取本身 失败 (极少, 一般 是 corrupt 文件)
    """
    if client_draft_id is None and meeting_id is None:
        raise HTTPException(400, "client_draft_id 或 meeting_id 二选一 必填")
    if client_draft_id is not None and not _DRAFT_ID_RE.match(client_draft_id):
        raise HTTPException(400, "client_draft_id 格式不合法 (8-64 hex/-)")

    # 校验 meeting (若给了)
    if meeting_id is not None:
        m = (
            await session.execute(
                select(Meeting).where(
                    Meeting.id == meeting_id,
                    Meeting.workspace_id == auth.workspace.id,
                )
            )
        ).scalar_one_or_none()
        if m is None:
            raise HTTPException(404, "meeting 不存在 或 不属于本工作区")

    # 读 bytes — 限大小
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "空文件")
    if len(raw) > MAX_BYTES:
        raise HTTPException(
            413,
            f"文件 太大 ({len(raw) // 1024 // 1024} MB), 单文件上限 {MAX_BYTES // 1024 // 1024} MB",
        )

    filename = _safe_filename(file.filename or "untitled")
    ext = _extension_from_filename(filename)
    ext_with_dot = f".{ext}" if ext else ""
    if ext_with_dot not in ALLOWED_EXTS:
        raise HTTPException(
            400,
            f"不支持的文件格式 .{ext}; "
            f"支持: {', '.join(sorted(ALLOWED_EXTS))}",
        )

    # 落库 — 先建 row (拿 id, 用于 storage_key); 再上传 OSS; 抽取 状态 同步/异步.
    att = MeetingAttachment(
        workspace_id=auth.workspace.id,
        meeting_id=meeting_id,
        client_draft_id=client_draft_id if meeting_id is None else None,
        uploader_user_id=auth.user.id,
        filename=filename,
        mime=file.content_type or None,
        extension=ext,
        size_bytes=len(raw),
        storage_key="",  # 先占位, 立刻 update
        extract_status="pending",
    )
    session.add(att)
    await session.flush()  # 拿到 att.id

    storage_key = f"meeting-attachments/{auth.workspace.id}/{att.id}/{filename}"
    att.storage_key = storage_key

    # 上传 OSS
    oss = OSSClient()
    if not oss.configured:
        raise HTTPException(503, "OSS 未配置, 暂不支持上传附件")
    try:
        oss.put_bytes(storage_key, raw, content_type=file.content_type or "application/octet-stream")
    except Exception as e:
        logger.exception("OSS upload failed for att=%s", att.id)
        raise HTTPException(502, f"OSS 上传失败: {e}")

    # 抽取 — 文本类小文件 同步; 图片 + 大文件 异步.
    # 图片 走 OCR (Qwen-VL) — 总要网络 IO ~2-5 秒, 同步会拖 上传 response 太久,
    # 干脆 一律 async 让前端 立即 拿到 'extracting' 状态.
    kind = kind_from_filename(filename)
    if kind == "image":
        att.extract_status = "extracting"
        asyncio.create_task(_extract_and_save(att.id, raw))
    elif len(raw) <= SYNC_EXTRACT_THRESHOLD:
        try:
            if kind is None:
                att.extract_status = "skipped"
                att.extract_summary = f"[未支持的文件类型 {filename}] 内容暂未识别"
            else:
                text = extract_text(filename, raw)
                att.extract_text = text
                att.extract_summary = await _maybe_summarize(att, text)
                att.extract_status = "ready"
        except Exception as e:
            logger.exception("inline extract failed att=%s", att.id)
            att.extract_status = "failed"
            att.last_error = str(e)[:1000]
    else:
        att.extract_status = "extracting"
        # fire-and-forget — worker 跑完会自己 commit
        asyncio.create_task(_extract_and_save(att.id, raw))

    await session.commit()
    await session.refresh(att)

    await audit_log(
        session, auth, "meeting_attachment.upload",
        target_type="meeting_attachment", target_id=str(att.id),
        payload={
            "filename": filename,
            "size_bytes": len(raw),
            "extension": ext,
            "draft_id": client_draft_id,
            "meeting_id": str(meeting_id) if meeting_id else None,
            "extract_status": att.extract_status,
        },
    )
    return AttachmentOut.model_validate(att)


@router.get("/attachments", response_model=AttachmentListOut)
async def list_attachments_for_draft(
    draft_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v27.0-mobile P19-B: 列 draft 下的所有 attachments.

    严格 限 上传人 自己 (draft 是 前端 临时 uuid, 不允许别人 借 draft_id 偷看).
    """
    if not _DRAFT_ID_RE.match(draft_id):
        raise HTTPException(400, "draft_id 格式不合法")
    rows = (
        await session.execute(
            select(MeetingAttachment).where(
                MeetingAttachment.client_draft_id == draft_id,
                MeetingAttachment.workspace_id == auth.workspace.id,
                MeetingAttachment.uploader_user_id == auth.user.id,
            ).order_by(MeetingAttachment.created_at.asc())
        )
    ).scalars().all()
    return AttachmentListOut(
        items=[AttachmentOut.model_validate(r) for r in rows],
    )


@router.get("/{meeting_id}/attachments", response_model=AttachmentListOut)
async def list_attachments_for_meeting(
    meeting_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v27.0-mobile P19-B: 列已挂会议的 attachments. 同 workspace 任何登录用户可见."""
    m = (
        await session.execute(
            select(Meeting).where(
                Meeting.id == meeting_id,
                Meeting.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if m is None:
        raise HTTPException(404, "meeting 不存在 或 不属于本工作区")
    rows = (
        await session.execute(
            select(MeetingAttachment).where(
                MeetingAttachment.meeting_id == meeting_id,
            ).order_by(MeetingAttachment.created_at.asc())
        )
    ).scalars().all()
    return AttachmentListOut(
        items=[AttachmentOut.model_validate(r) for r in rows],
    )


@router.delete("/attachments/{attachment_id}")
async def delete_attachment(
    attachment_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v27.0-mobile P19-B: 删 attachment.

    ABAC:
      - 上传人 自己 可删 (不论 是否已挂会议)
      - leader+ / admin / owner 可删 任何 同工作区 附件
    OSS 对象 也一起 删 (best-effort, 失败 仅 log).
    """
    att = (
        await session.execute(
            select(MeetingAttachment).where(
                MeetingAttachment.id == attachment_id,
                MeetingAttachment.workspace_id == auth.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if att is None:
        raise HTTPException(404, "attachment 不存在")

    is_uploader = att.uploader_user_id == auth.user.id
    is_admin = await is_leader_or_admin(session, auth)
    if not (is_uploader or is_admin):
        raise HTTPException(403, "仅 上传人 或 leader+ 可删")

    # 删 OSS 对象 (best-effort)
    try:
        oss = OSSClient()
        if oss.configured and att.storage_key:
            oss.delete(att.storage_key)
    except Exception:
        logger.warning("OSS delete failed key=%s", att.storage_key)

    await session.delete(att)
    await session.commit()

    await audit_log(
        session, auth, "meeting_attachment.delete",
        target_type="meeting_attachment", target_id=str(attachment_id),
        payload={"filename": att.filename, "as_uploader": is_uploader},
    )
    return {"ok": True}


# ===== helper for create_meeting hook =========================================

async def attach_drafts_to_meeting(
    session: AsyncSession,
    *,
    draft_id: str,
    meeting_id: uuid.UUID,
    workspace_id: uuid.UUID,
    uploader_user_id: uuid.UUID,
) -> int:
    """v27.0-mobile P19-B: create_meeting 调用 — 把 draft 下的 attachments
    关联到 新建的 meeting. 仅 同上传人 + 同 workspace 的 attachment 才会 hop 过去.

    返回 关联的 attachment 数. 不抛错 — 即使 0 个 attachment 也算 成功.
    """
    if not draft_id or not _DRAFT_ID_RE.match(draft_id):
        return 0
    res = await session.execute(
        update(MeetingAttachment)
        .where(
            MeetingAttachment.client_draft_id == draft_id,
            MeetingAttachment.workspace_id == workspace_id,
            MeetingAttachment.uploader_user_id == uploader_user_id,
            MeetingAttachment.meeting_id.is_(None),
        )
        .values(meeting_id=meeting_id, client_draft_id=None)
    )
    return res.rowcount or 0


async def load_attachment_context_for_prompt(
    session: AsyncSession,
    *,
    draft_id: Optional[str] = None,
    meeting_id: Optional[uuid.UUID] = None,
    workspace_id: uuid.UUID,
    uploader_user_id: Optional[uuid.UUID] = None,
    max_summary_chars: int = 6000,
) -> str:
    """v27.0-mobile P19-B: 拼 attachment summaries 成 一段 prompt block.

    给 decompose-agenda + orchestrator intro/reply prompt 用.
    优先用 extract_summary; 没就 退化 fallback 文本.

    返回:
      "" — 没附件 / 全部 skipped 没内容
      "用户提供的参考资料:\n附件 1: <filename>\n<summary>\n\n附件 2: ..."

    max_summary_chars: 总长上限. 超了 把 后面的附件 fallback 成 仅 文件名.
    """
    q = select(MeetingAttachment).order_by(MeetingAttachment.created_at.asc())
    if meeting_id is not None:
        q = q.where(MeetingAttachment.meeting_id == meeting_id)
    elif draft_id is not None and uploader_user_id is not None:
        if not _DRAFT_ID_RE.match(draft_id):
            return ""
        q = q.where(
            MeetingAttachment.client_draft_id == draft_id,
            MeetingAttachment.workspace_id == workspace_id,
            MeetingAttachment.uploader_user_id == uploader_user_id,
        )
    else:
        return ""

    rows = (await session.execute(q)).scalars().all()
    if not rows:
        return ""

    lines: list[str] = ["用户提供的参考资料:"]
    total = len(lines[0])
    for i, att in enumerate(rows):
        header = f"附件 {i + 1}: {att.filename}"
        if att.extract_status == "ready" and att.extract_summary:
            body = att.extract_summary
        elif att.extract_status == "extracting":
            body = "(抽取中, 暂未就绪)"
        elif att.extract_status == "skipped":
            body = att.extract_summary or "(未识别内容)"
        elif att.extract_status == "failed":
            body = f"(抽取失败: {att.last_error or '未知错误'})"
        else:
            body = "(未就绪)"
        block = f"{header}\n{body}"
        if total + len(block) > max_summary_chars:
            # 超额 — 后面的附件 仅给文件名 占位
            lines.append(f"{header} (因 prompt 长度限制 内容省略)")
            total += len(lines[-1])
        else:
            lines.append(block)
            total += len(block)
    return "\n\n".join(lines)
