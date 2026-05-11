"""
DashScope Paraformer 实时 STT 客户端

封装：
- async 队列接收前端音频帧
- 推送 send_audio_frame 给 DashScope Recognition
- 15 秒空闲断开、新音频到来自动重连
- 通过回调把识别结果广播回 WebSocket
"""

import asyncio
import logging
import time
import uuid
from typing import Awaitable, Callable, Optional

from dashscope.audio.asr import Recognition, RecognitionCallback, RecognitionResult

from .config import get_settings

logger = logging.getLogger(__name__)

IDLE_DISCONNECT_SECONDS = 15

# Result emitter type: an async fn taking (text, is_final, start_ts, end_ts)
ResultEmitter = Callable[[str, bool, Optional[int], Optional[int]], Awaitable[None]]


class _Callback(RecognitionCallback):
    """Bridge DashScope sync callbacks back into the asyncio loop."""

    def __init__(self, loop: asyncio.AbstractEventLoop, emitter: ResultEmitter):
        self._loop = loop
        self._emitter = emitter

    def on_open(self) -> None:
        logger.info("DashScope STT connection opened")

    def on_close(self) -> None:
        logger.info("DashScope STT connection closed")

    def on_error(self, message) -> None:
        logger.error("DashScope STT error: %s", message)

    def on_event(self, result: RecognitionResult) -> None:
        sentence = result.get_sentence()
        if not sentence:
            return
        text = sentence.get("text", "")
        if not text:
            return
        is_final = RecognitionResult.is_sentence_end(sentence)
        begin = sentence.get("begin_time")
        end = sentence.get("end_time")
        # Schedule emit back on the event loop (we're called on a worker thread).
        asyncio.run_coroutine_threadsafe(
            self._emitter(text, bool(is_final), begin, end),
            self._loop,
        )


class FunASRClient:
    """
    Per-WebSocket STT pipe to DashScope.

    Lifecycle:
        client = FunASRClient(emit)
        await client.start()
        await client.feed(pcm_bytes)
        ...
        await client.stop()
    """

    def __init__(
        self,
        emitter: ResultEmitter,
        *,
        workspace_id: Optional[uuid.UUID] = None,  # v25.9: workspace 级 vocab_id
    ):
        self._settings = get_settings()
        self._emitter = emitter
        self._workspace_id = workspace_id
        self._loop = asyncio.get_event_loop()
        self._queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=200)
        self._recognition: Optional[Recognition] = None
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._last_audio_ts: float = 0.0

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._process_loop())

    async def feed(self, pcm: bytes) -> None:
        if not self._running:
            return
        self._last_audio_ts = time.monotonic()
        try:
            self._queue.put_nowait(pcm)
        except asyncio.QueueFull:
            logger.warning("STT queue full; dropping frame")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._close_recognition()

    # --- internal ---

    async def _open_recognition(self) -> None:
        if not self._settings.dashscope_api_key:
            raise RuntimeError("DASHSCOPE_API_KEY is not configured")
        cb = _Callback(self._loop, self._emitter)
        kwargs: dict = {
            "model": self._settings.dashscope_stt_model,
            "format": "pcm",
            "sample_rate": 16000,
            "callback": cb,
            "api_key": self._settings.dashscope_api_key,
        }
        # v25.9: 优先 workspace 词表 vocab_id,fallback 到 env(v25.8-#1).
        vocab_id = await self._resolve_vocab_id()
        if vocab_id:
            kwargs["vocabulary_id"] = vocab_id
        self._recognition = Recognition(**kwargs)
        self._recognition.start()
        logger.info(
            "DashScope Recognition started (model=%s vocab=%s workspace=%s)",
            self._settings.dashscope_stt_model,
            vocab_id or "(none)",
            self._workspace_id or "(none)",
        )

    async def _resolve_vocab_id(self) -> Optional[str]:
        """优先 workspace.preset.asr_vocabulary.dashscope_vocab_id;否则 env."""
        env_id = (self._settings.dashscope_stt_vocabulary_id or "").strip() or None
        if self._workspace_id is None:
            return env_id
        try:
            from .db import SessionLocal
            from .models import Workspace
            from .asr_vocabulary import get_active_vocab_id
            from sqlalchemy import select as _select
            async with SessionLocal() as db:
                ws = (
                    await db.execute(
                        _select(Workspace).where(Workspace.id == self._workspace_id)
                    )
                ).scalar_one_or_none()
                if ws is None:
                    return env_id
                return get_active_vocab_id(ws)
        except Exception:
            logger.exception("workspace vocab_id 解析失败,fallback env")
            return env_id

    def _close_recognition(self) -> None:
        if self._recognition is not None:
            try:
                self._recognition.stop()
            except Exception:
                logger.exception("error stopping DashScope Recognition")
            self._recognition = None

    async def _process_loop(self) -> None:
        try:
            while self._running:
                # Wait for a frame; if idle long enough, drop the connection.
                try:
                    frame = await asyncio.wait_for(
                        self._queue.get(), timeout=IDLE_DISCONNECT_SECONDS
                    )
                except asyncio.TimeoutError:
                    if self._recognition is not None:
                        logger.info("STT idle %ss, closing connection", IDLE_DISCONNECT_SECONDS)
                        self._close_recognition()
                    continue

                if self._recognition is None:
                    await self._open_recognition()

                try:
                    self._recognition.send_audio_frame(frame)
                except Exception:
                    logger.exception("send_audio_frame failed; resetting connection")
                    self._close_recognition()
        except asyncio.CancelledError:
            pass
        finally:
            self._close_recognition()
