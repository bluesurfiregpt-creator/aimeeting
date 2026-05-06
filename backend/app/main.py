import json
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .stt_client import FunASRClient

logger = logging.getLogger(__name__)
settings = get_settings()

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)

app = FastAPI(title="Aimeeting Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz():
    return {"ok": True, "env": settings.app_env}


@app.websocket("/ws/stt")
async def ws_stt(ws: WebSocket):
    """
    Front-end sends 16kHz mono Int16 PCM as binary frames.
    Server pipes them to DashScope and pushes back JSON results:
        {"type": "transcript", "text": "...", "is_final": true,
         "start_ts": 1234, "end_ts": 1500}
        {"type": "system", "msg": "..."}
    Client may send {"action": "stop"} to close.
    """
    await ws.accept()

    async def emit(text: str, is_final: bool, start_ts, end_ts) -> None:
        try:
            await ws.send_text(
                json.dumps(
                    {
                        "type": "transcript",
                        "text": text,
                        "is_final": is_final,
                        "start_ts": start_ts,
                        "end_ts": end_ts,
                    },
                    ensure_ascii=False,
                )
            )
        except Exception:
            logger.exception("ws send failed")

    client = FunASRClient(emit)
    try:
        await client.start()
        await ws.send_text(json.dumps({"type": "system", "msg": "ready"}))

        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if "bytes" in msg and msg["bytes"] is not None:
                await client.feed(msg["bytes"])
            elif "text" in msg and msg["text"] is not None:
                try:
                    payload = json.loads(msg["text"])
                except json.JSONDecodeError:
                    continue
                if payload.get("action") == "stop":
                    break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("ws_stt error")
        try:
            await ws.send_text(
                json.dumps({"type": "system", "msg": "internal_error"})
            )
        except Exception:
            pass
    finally:
        await client.stop()
        try:
            await ws.close()
        except Exception:
            pass
