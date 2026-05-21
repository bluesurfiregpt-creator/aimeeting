"""
Voiceprint enrollment.

The frontend posts raw 16kHz mono Int16 PCM (same shape as the meeting WS
frames). We wrap into WAV → upload to OSS → sign URL → call pyannoteAI
/voiceprint → persist the returned voiceprint id and full payload (we'll need
the payload back when calling /identify later).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..audio_utils import pcm_quality_metrics, pcm_seconds, pcm_to_wav
from ..auth import AuthContext, get_current_auth, is_leader_or_admin
from ..db import get_session
from ..models import User, Voiceprint
from ..oss_client import OSSClient
from ..pyannote_client import PyannoteClient, PyannoteError
from ..schemas import VoiceprintOut

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/voiceprints", tags=["voiceprints"])


async def _require_voiceprint_writer(
    session: AsyncSession, auth: AuthContext,
    target_user_id: uuid.UUID | None = None,
) -> None:
    """v26.7-06: 声纹库 ABAC — 录入 / 删除 缩窄到 会议召集权限 (leader+).

    设计原则 (per 用户反馈):
      - 声纹本质是 "对外界声音的识别与标注", 不和 账号/科室/AI 绑定
      - 但 录入声纹 涉及 麦克风 + 音频上传, 需要 控制成本 + 隐私
      - 缩窄到 owner / admin / leader (= 会议召集权限) 是合理边界
      - manager / member 仍可 读 列表 (用于 会议 attendee picker)

    v27.0-mobile P22: 加"自己给自己录"豁免 —
      移动端用户(任何角色) 给自己录声纹 是合理需求, 不能因为 ABAC 拒掉.
      仅给别人录 (例如 leader 帮全部门成员录) 才走 leader+ 校验.
    """
    # 自己录自己 — 任何角色都允许
    if target_user_id is not None and target_user_id == auth.user.id:
        return
    if not await is_leader_or_admin(session, auth):
        raise HTTPException(
            403,
            "[权限不足] 录入 别人 的声纹 需要 owner / admin / leader 权限. "
            "录入 自己 的声纹 在 移动端 → 我的 → 声纹 操作.",
        )


@router.post("", response_model=VoiceprintOut)
async def enroll_voiceprint(
    user_id: str = Form(...),
    audio: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    # v26.7-06 + v27.0-mobile P22: 自己录自己 OK, 给别人录 限 leader+
    try:
        target_uuid = uuid.UUID(user_id)
    except (ValueError, TypeError):
        raise HTTPException(400, "user_id 格式错")
    await _require_voiceprint_writer(session, auth, target_user_id=target_uuid)
    user = (
        await session.execute(
            select(User).where(
                User.id == target_uuid, User.workspace_id == auth.workspace.id
            )
        )
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "user not found")

    raw = await audio.read()
    if not raw:
        raise HTTPException(400, "empty audio")

    seconds = pcm_seconds(raw)
    metrics = pcm_quality_metrics(raw)

    # Quality gate — picked so a clean 30s reading clears every check
    # while a 30s noisy/silence-heavy upload is rejected with a useful
    # error the frontend can show.
    if metrics["speech_seconds"] < 20:
        raise HTTPException(
            400,
            f"effective speech only {metrics['speech_seconds']:.1f}s "
            f"(need ≥20s of actual talking). Re-record in a quieter spot "
            f"and read straight through without long pauses.",
        )
    if metrics["speech_ratio"] < 0.55:
        raise HTTPException(
            400,
            f"too much silence ({(1-metrics['speech_ratio'])*100:.0f}%). "
            f"Re-record reading the prompt continuously without big gaps.",
        )
    if metrics["mean_speech_rms"] < 0.02:
        raise HTTPException(
            400,
            f"recording is too quiet (mean loudness {metrics['mean_speech_rms']*100:.1f}%). "
            f"Move closer to the mic or speak up.",
        )

    oss = OSSClient()
    pyannote = PyannoteClient()
    if not oss.configured or not pyannote.configured:
        raise HTTPException(503, "OSS or pyannoteAI not configured on server")

    wav = pcm_to_wav(raw)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    key = f"voiceprints/{user.id}/{ts}.wav"
    oss.put_bytes(key, wav, content_type="audio/wav")
    signed = oss.signed_url(key, expires_seconds=3600)
    logger.info("uploaded voiceprint sample %s (%.1fs)", key, seconds)

    try:
        resp = await pyannote.create_voiceprint(signed)
    except PyannoteError as e:
        logger.exception("pyannote /voiceprint failed")
        raise HTTPException(502, f"pyannoteAI error: {e}") from e

    # pyannote responds with `{jobId, voiceprint}` where `voiceprint` is a
    # ~2KB embedding string — not a short id. We use the jobId (UUID) as our
    # stable handle and keep the embedding in pyannote_payload for later
    # /identify calls.
    pyannote_id = (
        resp.get("voiceprintId")
        or resp.get("jobId")
        or resp.get("id")
    )
    if not pyannote_id or not resp.get("voiceprint"):
        raise HTTPException(502, f"pyannote response unusable: {list(resp.keys())}")

    await session.execute(
        update(Voiceprint)
        .where(Voiceprint.user_id == user.id, Voiceprint.is_active.is_(True))
        .values(is_active=False)
    )

    last_ver = (
        await session.execute(
            select(Voiceprint.version)
            .where(Voiceprint.user_id == user.id)
            .order_by(Voiceprint.version.desc())
        )
    ).scalars().first() or 0

    vp = Voiceprint(
        user_id=user.id,
        pyannote_id=str(pyannote_id),
        pyannote_payload=resp,
        sample_oss_key=key,
        sample_seconds=seconds,
        version=last_ver + 1,
        is_active=True,
    )
    session.add(vp)
    await session.commit()
    await session.refresh(vp)
    return VoiceprintOut.model_validate(vp)


@router.get("/me", response_model=VoiceprintOut | None)
async def my_voiceprint(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v27.0-mobile P22: 当前用户自己的 active 声纹状态.

    返回:
      - VoiceprintOut: 用户已录声纹 (返当前 active 那条)
      - null: 用户未录声纹

    移动端 /m/me 设置页用. 不需要任何 ABAC — 自己看自己永远可以.
    """
    vp = (
        await session.execute(
            select(Voiceprint).where(
                Voiceprint.user_id == auth.user.id,
                Voiceprint.is_active.is_(True),
            ).order_by(Voiceprint.created_at.desc())
        )
    ).scalar_one_or_none()
    if vp is None:
        return None
    return VoiceprintOut.model_validate(vp)


@router.delete("/me", status_code=204)
async def delete_my_voiceprint(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """v27.0-mobile P22: 删除当前用户自己的 active 声纹.

    用户隐私选择 — 可随时撤回声纹授权. 把所有 active 声纹 标 is_active=false
    (不真删行, 保留 audit trail).
    """
    res = await session.execute(
        update(Voiceprint)
        .where(
            Voiceprint.user_id == auth.user.id,
            Voiceprint.is_active.is_(True),
        )
        .values(is_active=False)
    )
    await session.commit()
    return None
