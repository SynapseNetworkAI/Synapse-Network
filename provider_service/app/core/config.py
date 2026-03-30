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
    provider_service_postgres_dsn: str | None = None
    sourcify_base_url: str = "https://sourcify.dev"
    sourcify_timeout_s: float = 6.0
    blockscout_base_urls_json: str = (
        '{"ethereum":"https://eth.blockscout.com/api",'
        '"arbitrum":"https://arbitrum.blockscout.com/api",'
        '"optimism":"https://optimism.blockscout.com/api",'
        '"base":"https://base.blockscout.com/api"}'
    )
    blockscout_timeout_s: float = 6.0
    etherscan_base_url: str = "https://api.etherscan.io/v2/api"
    etherscan_timeout_s: float = 6.0
    etherscan_api_key: str | None = None
    protocol_brief_postgres_snapshot_table: str = "provider_protocol_briefs"
    protocol_brief_postgres_raw_feed_table: str = "provider_protocol_brief_raw_feeds"
    protocol_brief_cache_ttl_s: int = 300
    provider_api_invocation_table: str = "provider_api_invocations"
    whale_flow_postgres_snapshot_table: str = "provider_whale_flow_snapshots"
    whale_flow_cache_ttl_s: int = 600
    oss_security_postgres_report_table: str = "provider_oss_security_reports"
    oss_security_cache_ttl_s: int = 7200
    twitter_video_postgres_asset_table: str = "provider_twitter_video_assets"
    twitter_video_cache_ttl_s: int = 86400
    twitter_video_tmp_dir: str = "storage/twitter_videos/tmp"
    twitter_video_download_timeout_s: float = 90.0
    twitter_video_max_concurrency: int = 2
    tiktok_video_postgres_asset_table: str = "provider_tiktok_video_assets"
    tiktok_video_cache_ttl_s: int = 86400
    tiktok_video_tmp_dir: str = "storage/tiktok_videos/tmp"
    tiktok_video_download_timeout_s: float = 90.0
    tiktok_video_max_concurrency: int = 2
    reddit_media_postgres_asset_table: str = "provider_reddit_media_assets"
    reddit_media_cache_ttl_s: int = 86400
    reddit_media_tmp_dir: str = "storage/reddit_media/tmp"
    reddit_media_download_timeout_s: float = 120.0
    reddit_media_max_concurrency: int = 2
    youtube_video_postgres_asset_table: str = "provider_youtube_video_assets"
    youtube_video_cache_ttl_s: int = 86400
    youtube_video_tmp_dir: str = "storage/youtube_videos/tmp"
    youtube_video_download_timeout_s: float = 180.0
    youtube_video_max_concurrency: int = 2
    github_release_asset_postgres_asset_table: str = "provider_github_release_assets"
    github_release_asset_cache_ttl_s: int = 86400
    github_release_asset_tmp_dir: str = "storage/github_release_assets/tmp"
    paper_pdf_postgres_asset_table: str = "provider_paper_pdf_assets"
    paper_pdf_cache_ttl_s: int = 86400
    paper_pdf_tmp_dir: str = "storage/paper_pdfs/tmp"
    video_storage_backend: Literal["minio"] = "minio"
    video_storage_key_prefix: str = "twitter"
    video_storage_minio_endpoint: str | None = None
    video_storage_minio_access_key: str | None = None
    video_storage_minio_secret_key: str | None = None
    video_storage_minio_bucket: str | None = None
    video_storage_minio_secure: bool = False
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
