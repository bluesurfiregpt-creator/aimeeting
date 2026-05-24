from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "dev"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    log_level: str = "INFO"

    cors_allow_origins: str = "http://localhost:3000"

    dashscope_api_key: str = ""
    # v25.8-#1: 升级到 v2 — 中文 WER 显著降低,业务术语识别率提升
    dashscope_stt_model: str = "paraformer-realtime-v2"
    # v25.8-#3: ASR 自定义词表 ID(在 DashScope 控制台创建一个 vocabulary,
    # 填入业务术语 — 留空时不传,模型用通用词表)
    dashscope_stt_vocabulary_id: str = ""

    pyannote_api_key: str = ""
    pyannote_base_url: str = "https://api.pyannote.ai"

    oss_access_key_id: str = ""
    oss_access_key_secret: str = ""
    oss_bucket: str = ""
    oss_endpoint: str = "https://oss-cn-hangzhou.aliyuncs.com"
    oss_region: str = "oss-cn-hangzhou"

    database_url: str = "postgresql+asyncpg://aimeeting:aimeeting@localhost:5432/aimeeting"
    redis_url: str = "redis://localhost:6379/0"

    dify_api_key: str = ""
    dify_base_url: str = "https://api.dify.ai"

    # Auth (Sprint F)
    jwt_secret: str = "dev-not-for-prod-replace-me"
    jwt_ttl_days: int = 14
    cookie_secure: bool = True

    # v24.4 #2 Sentry (DSN 不填 → init no-op,完全不上报;线上配上 DSN 即激活)
    sentry_dsn: str = ""
    sentry_environment: str = ""        # 默认走 app_env
    sentry_traces_sample_rate: float = 0.1  # 性能 trace 采样 10%
    sentry_send_default_pii: bool = False   # 安全默认:不带用户 IP / cookies

    # v26.4 Platform Admin · 跨 workspace 的 SaaS 平台层超管
    # 逗号分隔的邮箱列表 — 只有这些邮箱登录后才能调 /api/super/* 端点 + 看到 /super UI
    # Q1=C 决策:env var 硬配,不入库,避免被业务后台 SQL 污染
    # 留空 = 没有超管(默认安全)
    # 示例:PLATFORM_ADMIN_EMAILS=bluesurfiregpt@gmail.com,ops@yourcompany.com
    platform_admin_emails: str = ""

    # v27.1 微信 OAuth (原生小程序一键登录)
    # AppID 公开,从 mp.weixin.qq.com → 开发 → 开发管理 → 开发设置.
    # AppSecret 私密 — 后台同一页面 "重置". 若历史 secret 已泄露 必须 reset.
    # 任一为空 时, /api/auth/wx-login 返 503 提示 "未配置微信 OAuth".
    # 部署: 在 /opt/aimeeting/deploy/.env 加 WX_APPID=... + WX_SECRET=...
    wx_appid: str = ""
    wx_secret: str = ""
    # code2Session API. 默认是官方 endpoint, 一般不改.
    wx_code2session_url: str = "https://api.weixin.qq.com/sns/jscode2session"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]

    @property
    def platform_admin_emails_set(self) -> set[str]:
        """归一到 小写 + 去空白 — 用 email 比对时调 .lower().strip() 再匹配."""
        raw = self.platform_admin_emails or ""
        return {
            e.strip().lower()
            for e in raw.split(",")
            if e.strip()
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
