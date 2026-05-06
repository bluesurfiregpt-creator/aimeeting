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

from ..audio_utils import pcm_seconds, pcm_to_wav
from ..db import get_session
from ..models import User, Voiceprint
from ..oss_client import OSSClient
from ..pyannote_client import PyannoteClient, PyannoteError
from ..schemas import VoiceprintOut

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/voiceprints", tags=["voiceprints"])


@router.post("", response_model=VoiceprintOut)
async def enroll_voiceprint(
    user_id: str = Form(...),
    audio: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
):
    user = (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "user not found")

    raw = await audio.read()
    if not raw:
        raise HTTPException(400, "empty audio")

    seconds = pcm_seconds(raw)
    if seconds < 5:
        raise HTTPException(400, f"recording too short ({seconds:.1f}s); need 30s+ for usable voiceprint")

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
