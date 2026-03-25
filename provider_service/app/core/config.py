from functools import lru_cache
import json
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
    sentiment_proxy_timeout_floor_s: float = 8.0
    protocol_brief_source_timeout_s: float = 4.0
    protocol_brief_source_max_attempts: int = 2
    protocol_brief_source_backoff_ms: int = 250
    protocol_brief_repository_backend: Literal["file", "postgres"] = "file"
    protocol_brief_storage_dir: str = "logs/protocol_brief"
    protocol_brief_postgres_dsn: str | None = None
    protocol_brief_postgres_snapshot_table: str = "provider_protocol_briefs"
    protocol_brief_postgres_raw_feed_table: str = "provider_protocol_brief_raw_feeds"
    protocol_brief_cache_ttl_s: int = 300
    defillama_timeout_s: float = 4.0
    defillama_base_url: str = "https://api.llama.fi"
    dexscreener_timeout_s: float = 3.0
    dexscreener_base_url: str = "https://api.dexscreener.com"
    alternative_me_timeout_s: float = 2.0
    alternative_me_base_url: str = "https://api.alternative.me"
    binance_timeout_s: float = 1.0
    binance_base_url: str = "https://api.binance.com"
    sentiment_proxy_pool_enabled: bool = False
    sentiment_proxy_pool_urls_json: str = ""
    sentiment_source_max_attempts: int = 2
    sentiment_source_backoff_ms: int = 200
    sentiment_repository_backend: Literal["file", "postgres"] = "file"
    sentiment_storage_dir: str = "logs/sentiment"
    sentiment_postgres_dsn: str | None = None
    sentiment_postgres_snapshot_table: str = "provider_sentiment_snapshots"
    sentiment_postgres_raw_feed_table: str = "provider_sentiment_raw_feeds"
    sentiment_postgres_scheduler_job_table: str = "provider_sentiment_scheduler_jobs"
    sentiment_scheduler_enabled: bool = False
    sentiment_scheduler_interval_s: int = 30
    sentiment_scheduler_max_concurrent_snapshots: int = 2
    sentiment_scheduler_lease_ttl_s: int = 120
    sentiment_scheduler_targets_json: str = ""
    sentiment_scheduler_fresh_ttl_s: int = 60
    sentiment_scheduler_stale_ttl_s: int = 300
    sentiment_scheduler_hard_expire_s: int = 900
    gateway_provider_signature_enabled: bool = True
    gateway_provider_signature_secret: str = (
        "replace-this-with-a-provider-signature-secret"
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


def resolve_provider_path(relative_path: str) -> Path:
    root_dir = Path(__file__).resolve().parents[2]
    return (root_dir / relative_path).resolve()


def parse_json_config(value: str) -> object:
    normalized = str(value or "").strip()
    if not normalized:
        return []
    return json.loads(normalized)
