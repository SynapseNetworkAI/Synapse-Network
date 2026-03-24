from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    service_host: str = "0.0.0.0"
    service_port: int = 8100

    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"
    deepseek_timeout_s: float = 30.0
    sentiment_source_timeout_s: float = 2.0
    alternative_me_timeout_s: float = 2.0
    alternative_me_base_url: str = "https://api.alternative.me"
    coingecko_timeout_s: float = 2.0
    coingecko_base_url: str = "https://api.coingecko.com/api/v3"
    binance_timeout_s: float = 1.0
    binance_base_url: str = "https://api.binance.com"
    sentiment_source_max_attempts: int = 2
    sentiment_source_backoff_ms: int = 200
    sentiment_repository_backend: Literal["file", "postgres"] = "file"
    sentiment_storage_dir: str = "logs/sentiment"
    sentiment_postgres_dsn: str | None = None
    sentiment_postgres_snapshot_table: str = "provider_sentiment_snapshots"
    sentiment_postgres_raw_feed_table: str = "provider_sentiment_raw_feeds"
    gateway_provider_signature_secret: str = (
        "replace-this-with-a-provider-signature-secret"
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


def resolve_provider_path(relative_path: str) -> Path:
    root_dir = Path(__file__).resolve().parents[2]
    return (root_dir / relative_path).resolve()
