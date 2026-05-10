"""
v24.4 #2 — Sentry 观测层 init.

设计要点:
  - DSN 空 → 完全 no-op(开发 / 测试不上报,启动也不报错)
  - 必须在 FastAPI / uvicorn import 后立刻 init,但要在 add_middleware 前 — sentry-sdk
    的 FastAPI integration 自动包 ASGI middleware 抓 unhandled exception.
  - send_default_pii 默认关闭(不上报用户 IP / cookies),线上若需开,通过 env 显式打开.
  - 配额:traces_sample_rate=0.1(性能 trace 采 10%,够看 P95 不会爆 quota)
  - 200/300 类不上报(uvicorn access log 已有)
  - 屏蔽 HTTPException(那是业务错误,不是真异常)

集成点:main.py 顶部 init_sentry() 一行(no-op 安全).
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def init_sentry() -> bool:
    """初始化 Sentry. DSN 空 → no-op 返回 False(让 caller 知道没接).

    返回 True 表示 Sentry 已激活(可上报).
    """
    from .config import get_settings

    settings = get_settings()
    dsn = (settings.sentry_dsn or "").strip()
    if not dsn:
        logger.info("Sentry DSN 未配置 → 跳过(no-op)")
        return False

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
    except ImportError:
        logger.exception("sentry-sdk 未安装,跳过 init")
        return False

    env = (settings.sentry_environment or settings.app_env or "dev").strip()

    def _before_send(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any] | None:
        """过滤已知的 业务级 异常 — 不算真 bug,不打 Sentry."""
        exc_info = hint.get("exc_info")
        if exc_info:
            exc_type = exc_info[0]
            exc_name = getattr(exc_type, "__name__", "")
            # FastAPI HTTPException / StarletteHTTPException / 业务自抛 4xx 不上报
            if exc_name in {"HTTPException", "StarletteHTTPException", "RequestValidationError"}:
                return None
            # 客户端断 WS 不上报(很常见,不是 bug)
            if exc_name in {"WebSocketDisconnect", "ConnectionClosedOK", "ConnectionClosedError"}:
                return None
        return event

    try:
        sentry_sdk.init(
            dsn=dsn,
            environment=env,
            release=None,  # 由 BUILD_VERSION 间接体现 — 之后可加
            traces_sample_rate=float(settings.sentry_traces_sample_rate),
            send_default_pii=bool(settings.sentry_send_default_pii),
            integrations=[
                StarletteIntegration(),
                FastApiIntegration(),
                SqlalchemyIntegration(),
            ],
            before_send=_before_send,
            attach_stacktrace=True,
            max_breadcrumbs=50,
        )
        logger.info(
            "Sentry 已激活 env=%s sample=%.2f pii=%s",
            env, settings.sentry_traces_sample_rate, settings.sentry_send_default_pii,
        )
        return True
    except Exception:
        logger.exception("Sentry init 失败 — 继续运行不上报")
        return False


def capture_message(msg: str, level: str = "info") -> None:
    """对外手动上报小工具.DSN 没配 → no-op."""
    try:
        import sentry_sdk
        sentry_sdk.capture_message(msg, level=level)  # type: ignore[arg-type]
    except Exception:
        pass


def capture_exception(exc: BaseException | None = None) -> None:
    """对外手动上报异常.DSN 没配 → no-op."""
    try:
        import sentry_sdk
        if exc is not None:
            sentry_sdk.capture_exception(exc)
        else:
            sentry_sdk.capture_exception()
    except Exception:
        pass
