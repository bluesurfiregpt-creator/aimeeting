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
    session: AsyncSession, auth: AuthContext
) -> None:
    """v26.7-06: 声纹库 ABAC — 录入 / 删除 缩窄到 会议召集权限 (leader+).

    设计原则:
      - 声纹是 workspace 级共享资源, 任何成员可读列表
      - 录入 / 修改 / 删除 涉及麦克风 + 音频 + pyannote 调用 — 限 leader+
      - 录的是 "声纹库的某个用户" 不是 "自己的声纹"
        (新人 没账号没关系, 先 POST /api/users 建 speaker-only profile 再 POST /api/voiceprints)
    """
    if not await is_leader_or_admin(session, auth):
        raise HTTPException(
            403,
            "[权限不足] 录入 / 删除 声纹 需要 owner / admin / leader 权限",
        )


@router.post("", response_model=VoiceprintOut)
async def enroll_voiceprint(
    user_id: str = Form(...),
    audio: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    # v26.7-06: 录入声纹 限 leader+
    await _require_voiceprint_writer(session, auth)
    user = (
        await session.execute(
            select(User).where(
                User.id == user_id, User.workspace_id == auth.workspace.id
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


# v27.0-mobile P22: 撤销 user 声纹 — 把该 user 所有 active 声纹 标 is_active=false.
# ABAC: leader+ (跟 enroll 一致, 因为是 workspace 级管理)
@router.delete("/by-user/{user_id}", status_code=204)
async def delete_voiceprint_for_user(
    user_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    await _require_voiceprint_writer(session, auth)
    user = (
        await session.execute(
            select(User).where(
                User.id == user_id, User.workspace_id == auth.workspace.id
            )
        )
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "user not found")
    await session.execute(
        update(Voiceprint)
        .where(
            Voiceprint.user_id == user.id,
            Voiceprint.is_active.is_(True),
        )
        .values(is_active=False)
    )
    await session.commit()
    return None
