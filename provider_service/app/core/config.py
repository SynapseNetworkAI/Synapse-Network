from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    service_host: str = "0.0.0.0"
    service_port: int = 8100

    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"
    deepseek_timeout_s: float = 30.0
    gateway_provider_signature_secret: str = (
        "replace-this-with-a-provider-signature-secret"
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
