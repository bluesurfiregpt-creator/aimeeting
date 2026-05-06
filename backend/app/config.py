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
    dashscope_stt_model: str = "paraformer-realtime-v1"

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

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
