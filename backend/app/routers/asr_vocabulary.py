"""
v25.9 — workspace 级 ASR 词表 admin endpoints.

GET  /api/asr-vocabulary
POST /api/asr-vocabulary/save (替换全表 + 同步 DashScope)
POST /api/asr-vocabulary/import-from-meeting/{meeting_id} (合并 hot words)
POST /api/asr-vocabulary/resync (用现有 entries 重新 push DashScope)
"""

from __future__ import annotations

import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..asr_vocabulary import (
    MAX_ENTRIES,
    get_vocabulary_state,
    import_from_meeting_hot_words,
    normalize_entries,
    update_workspace_vocabulary,
)
from ..audit import audit_log
from ..auth import AuthContext, get_current_auth, require_leader_or_admin
from ..db import get_session
from ..models import Meeting, Workspace

router = APIRouter(prefix="/api/asr-vocabulary", tags=["asr-vocabulary"])


class VocabEntryIn(BaseModel):
    text: str
    weight: int = 4
    lang: str = "zh"


class VocabStateOut(BaseModel):
    dashscope_vocab_id: Optional[str] = None
    entries: list[VocabEntryIn]
    last_synced_at: Optional[str] = None
    sync_status: str
    sync_error: Optional[str] = None
    target_model: str
    max_entries: int = MAX_ENTRIES


class SaveVocabIn(BaseModel):
    # 接受两种格式:str 列表(简单)/ 完整对象列表
    entries: list[Any]


def _state_to_out(state: dict) -> VocabStateOut:
    return VocabStateOut(
        dashscope_vocab_id=state.get("dashscope_vocab_id"),
        entries=[VocabEntryIn(**e) for e in state.get("entries") or [] if isinstance(e, dict)],
        last_synced_at=state.get("last_synced_at"),
        sync_status=state.get("sync_status") or "never",
        sync_error=state.get("sync_error"),
        target_model=state.get("target_model") or "paraformer-realtime-v2",
    )


async def _load_workspace(session: AsyncSession, auth: AuthContext) -> Workspace:
    ws = (
        await session.execute(
            select(Workspace).where(Workspace.id == auth.workspace.id)
        )
    ).scalar_one_or_none()
    if not ws:
        raise HTTPException(404, "workspace not found")
    return ws


@router.get("", response_model=VocabStateOut)
async def get_vocabulary(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """读 当前 workspace 的 ASR 词表 + 同步状态."""
    ws = await _load_workspace(session, auth)
    return _state_to_out(get_vocabulary_state(ws))


@router.post("/save", response_model=VocabStateOut)
async def save_vocabulary(
    payload: SaveVocabIn,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """leader/admin 全量替换 词表 + 自动同步 DashScope.

    传入 entries 可以是 str 列表(默认 weight=4 lang=zh)或完整 {text,weight,lang}.
    """
    await require_leader_or_admin(session, auth)
    ws = await _load_workspace(session, auth)
    state = await update_workspace_vocabulary(session, ws, payload.entries)
    await audit_log(
        session, auth, "asr_vocabulary.save",
        target_type="workspace", target_id=str(ws.id),
        payload={
            "entries_count": len(state.get("entries") or []),
            "sync_status": state.get("sync_status"),
            "vocab_id": state.get("dashscope_vocab_id"),
        },
    )
    return _state_to_out(state)


@router.post("/import-from-meeting/{meeting_id}", response_model=VocabStateOut)
async def import_from_meeting(
    meeting_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """从某场会议合并 hot words → 词表(预览,不立刻同步).

    用户审 完 列表后 再点保存 才同步 DashScope.返回合并后的 entries.
    """
    await require_leader_or_admin(session, auth)
    try:
        mid = uuid.UUID(meeting_id)
    except ValueError:
        raise HTTPException(400, "invalid meeting id")
    m = (
        await session.execute(
            select(Meeting).where(
                Meeting.id == mid, Meeting.workspace_id == auth.workspace.id
            )
        )
    ).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "meeting not found in your workspace")
    ws = await _load_workspace(session, auth)
    merged = await import_from_meeting_hot_words(session, ws, mid)
    # 仅返回 预览(不写 DB,前端点保存才落)
    return VocabStateOut(
        dashscope_vocab_id=get_vocabulary_state(ws).get("dashscope_vocab_id"),
        entries=[VocabEntryIn(**e) for e in merged if isinstance(e, dict)],
        last_synced_at=get_vocabulary_state(ws).get("last_synced_at"),
        sync_status="preview",
        sync_error=None,
        target_model="paraformer-realtime-v2",
    )


@router.post("/resync", response_model=VocabStateOut)
async def resync(
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """用 现有 entries 重新 push DashScope(用于 sync_status=failed 时重试)."""
    await require_leader_or_admin(session, auth)
    ws = await _load_workspace(session, auth)
    state = get_vocabulary_state(ws)
    entries = state.get("entries") or []
    new_state = await update_workspace_vocabulary(session, ws, entries)
    return _state_to_out(new_state)
