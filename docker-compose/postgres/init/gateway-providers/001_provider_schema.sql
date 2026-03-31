CREATE TABLE IF NOT EXISTS provider_sentiment_snapshots (
    snapshot_key TEXT PRIMARY KEY,
    symbol TEXT NOT NULL DEFAULT '',
    chain TEXT NOT NULL DEFAULT 'market-wide',
    lookback_hours INTEGER NOT NULL DEFAULT 24,
    include_narrative BOOLEAN NOT NULL DEFAULT TRUE,
    source_count INTEGER NOT NULL DEFAULT 0,
    max_source_age_sec INTEGER NOT NULL DEFAULT 0,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sentiment_score INTEGER NOT NULL DEFAULT 0,
    sentiment_label TEXT NOT NULL DEFAULT 'neutral',
    trend_direction TEXT NOT NULL DEFAULT 'sideways',
    volatility_signal TEXT NOT NULL DEFAULT 'medium',
    market_temperature TEXT NOT NULL DEFAULT '',
    response_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (jsonb_typeof(response_json) = 'object')
);

CREATE INDEX IF NOT EXISTS provider_sentiment_snapshots_symbol_chain_idx
ON provider_sentiment_snapshots (symbol, chain, updated_at DESC);

CREATE TABLE IF NOT EXISTS provider_sentiment_raw_feeds (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    snapshot_key TEXT NOT NULL REFERENCES provider_sentiment_snapshots (snapshot_key) ON DELETE CASCADE,
    symbol TEXT NOT NULL DEFAULT '',
    chain TEXT NOT NULL DEFAULT 'market-wide',
    source_name TEXT,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    fetched_at TIMESTAMPTZ,
    source_timestamp TIMESTAMPTZ,
    latency_ms INTEGER,
    retry_count INTEGER NOT NULL DEFAULT 0,
    timeout_ms INTEGER,
    http_status INTEGER,
    payload_hash TEXT,
    error_code TEXT,
    error_message TEXT,
    payload_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (jsonb_typeof(payload_json) = 'object')
);

CREATE INDEX IF NOT EXISTS provider_sentiment_raw_feeds_snapshot_key_idx
ON provider_sentiment_raw_feeds (snapshot_key, created_at DESC);

CREATE INDEX IF NOT EXISTS provider_sentiment_raw_feeds_source_name_idx
ON provider_sentiment_raw_feeds (source_name, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_sentiment_scheduler_jobs (
    snapshot_key TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    chain TEXT NOT NULL,
    lookback_hours INTEGER NOT NULL,
    include_narrative BOOLEAN NOT NULL,
    job_owner TEXT,
    job_status TEXT NOT NULL DEFAULT 'idle' CHECK (job_status IN ('idle', 'running', 'cooldown', 'failed')),
    lease_expires_at TIMESTAMPTZ,
    last_started_at TIMESTAMPTZ,
    last_finished_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    last_error_code TEXT,
    last_error_message TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    next_run_at TIMESTAMPTZ,
    last_refresh_reason TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_sentiment_scheduler_jobs_next_run_at
ON provider_sentiment_scheduler_jobs (next_run_at);

CREATE INDEX IF NOT EXISTS idx_provider_sentiment_scheduler_jobs_lease_expires_at
ON provider_sentiment_scheduler_jobs (lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_provider_sentiment_scheduler_jobs_status
ON provider_sentiment_scheduler_jobs (job_status);

CREATE TABLE IF NOT EXISTS provider_protocol_briefs (
    brief_key TEXT PRIMARY KEY,
    protocol TEXT NOT NULL DEFAULT '',
    chain TEXT NOT NULL DEFAULT '',
    lookback_days INTEGER NOT NULL DEFAULT 30,
    peer_set_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_count INTEGER NOT NULL DEFAULT 0,
    max_source_age_sec INTEGER NOT NULL DEFAULT 0,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_generated_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    response_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (jsonb_typeof(peer_set_json) = 'array'),
    CHECK (jsonb_typeof(response_json) = 'object')
);

CREATE INDEX IF NOT EXISTS provider_protocol_briefs_protocol_chain_idx
ON provider_protocol_briefs (protocol, chain, updated_at DESC);

CREATE INDEX IF NOT EXISTS provider_protocol_briefs_expires_at_idx
ON provider_protocol_briefs (expires_at);

CREATE TABLE IF NOT EXISTS provider_protocol_brief_raw_feeds (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    brief_key TEXT NOT NULL REFERENCES provider_protocol_briefs (brief_key) ON DELETE CASCADE,
    protocol TEXT NOT NULL DEFAULT '',
    chain TEXT NOT NULL DEFAULT '',
    source_name TEXT,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    fetched_at TIMESTAMPTZ,
    source_timestamp TIMESTAMPTZ,
    latency_ms INTEGER,
    retry_count INTEGER NOT NULL DEFAULT 0,
    timeout_ms INTEGER,
    http_status INTEGER,
    payload_hash TEXT,
    error_code TEXT,
    error_message TEXT,
    payload_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (jsonb_typeof(payload_json) = 'object')
);

CREATE INDEX IF NOT EXISTS provider_protocol_brief_raw_feeds_brief_key_idx
ON provider_protocol_brief_raw_feeds (brief_key, created_at DESC);

CREATE INDEX IF NOT EXISTS provider_protocol_brief_raw_feeds_source_name_idx
ON provider_protocol_brief_raw_feeds (source_name, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_api_invocations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invocation_id TEXT NOT NULL UNIQUE,
    service_id TEXT NOT NULL,
    request_id TEXT,
    gateway_request_id TEXT,
    caller_type TEXT NOT NULL DEFAULT 'gateway',
    input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    response_status INTEGER NOT NULL,
    error_code TEXT,
    upstream_status INTEGER,
    latency_ms INTEGER,
    cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
    observability_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (jsonb_typeof(input_payload) = 'object'),
    CHECK (jsonb_typeof(observability_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_provider_api_invocations_service_created
ON provider_api_invocations (service_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_api_invocations_request_id
ON provider_api_invocations (request_id);

CREATE TABLE IF NOT EXISTS provider_contract_audit_reports (
    report_key TEXT PRIMARY KEY,
    contract_address TEXT,
    chain TEXT,
    source_fingerprint TEXT,
    analysis_depth TEXT NOT NULL,
    source_provider TEXT,
    source_count INTEGER NOT NULL DEFAULT 0,
    max_source_age_sec INTEGER NOT NULL DEFAULT 0,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_generated_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    result_payload JSONB NOT NULL,
    observability_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (jsonb_typeof(result_payload) = 'object'),
    CHECK (jsonb_typeof(observability_json) = 'object')
);

CREATE INDEX IF NOT EXISTS provider_contract_audit_reports_target_idx
ON provider_contract_audit_reports (chain, contract_address, updated_at DESC);

CREATE INDEX IF NOT EXISTS provider_contract_audit_reports_expires_at_idx
ON provider_contract_audit_reports (expires_at);

CREATE TABLE IF NOT EXISTS provider_whale_flow_snapshots (
    snapshot_key TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    chain TEXT NOT NULL,
    window_minutes INTEGER NOT NULL DEFAULT 60,
    min_usd_value NUMERIC(30, 8) NOT NULL DEFAULT 100000,
    source_count INTEGER NOT NULL DEFAULT 0,
    max_source_age_sec INTEGER NOT NULL DEFAULT 0,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    response_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (window_minutes >= 5 AND window_minutes <= 1440),
    CHECK (min_usd_value >= 10000),
    CHECK (jsonb_typeof(response_json) = 'object')
);

CREATE INDEX IF NOT EXISTS provider_whale_flow_snapshots_token_chain_idx
ON provider_whale_flow_snapshots (token, chain, updated_at DESC);

CREATE INDEX IF NOT EXISTS provider_whale_flow_snapshots_expires_at_idx
ON provider_whale_flow_snapshots (expires_at);

CREATE TABLE IF NOT EXISTS provider_oss_security_reports (
    report_key TEXT PRIMARY KEY,
    repo_url_hash TEXT,
    package_fingerprint TEXT,
    ecosystem TEXT,
    dependency_count INTEGER NOT NULL DEFAULT 0,
    vulnerability_count INTEGER NOT NULL DEFAULT 0,
    repo_health_score INTEGER NOT NULL DEFAULT 0,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    response_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (dependency_count >= 0),
    CHECK (vulnerability_count >= 0),
    CHECK (repo_health_score >= 0 AND repo_health_score <= 100),
    CHECK (jsonb_typeof(response_json) = 'object')
);

CREATE INDEX IF NOT EXISTS provider_oss_security_reports_repo_url_hash_idx
ON provider_oss_security_reports (repo_url_hash, updated_at DESC);

CREATE INDEX IF NOT EXISTS provider_oss_security_reports_pkg_fingerprint_idx
ON provider_oss_security_reports (package_fingerprint, updated_at DESC);

CREATE INDEX IF NOT EXISTS provider_oss_security_reports_expires_at_idx
ON provider_oss_security_reports (expires_at);

CREATE TABLE IF NOT EXISTS provider_twitter_video_assets (
    asset_key TEXT PRIMARY KEY,
    tweet_id TEXT NOT NULL,
    post_url TEXT NOT NULL,
    storage_backend TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    duration_sec INTEGER,
    width INTEGER,
    height INTEGER,
    sha256 TEXT NOT NULL,
    download_status TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    response_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (size_bytes >= 0),
    CHECK (duration_sec IS NULL OR duration_sec >= 0),
    CHECK (jsonb_typeof(response_json) = 'object')
);

CREATE INDEX IF NOT EXISTS provider_twitter_video_assets_tweet_id_idx
ON provider_twitter_video_assets (tweet_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS provider_twitter_video_assets_expires_at_idx
ON provider_twitter_video_assets (expires_at);

CREATE TABLE IF NOT EXISTS provider_youtube_video_assets (
    asset_key TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    video_url TEXT NOT NULL,
    storage_backend TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    duration_sec INTEGER,
    width INTEGER,
    height INTEGER,
    sha256 TEXT NOT NULL,
    download_status TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    response_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (size_bytes >= 0),
    CHECK (duration_sec IS NULL OR duration_sec >= 0),
    CHECK (jsonb_typeof(response_json) = 'object')
);

CREATE INDEX IF NOT EXISTS provider_youtube_video_assets_video_id_idx
ON provider_youtube_video_assets (video_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS provider_youtube_video_assets_expires_at_idx
ON provider_youtube_video_assets (expires_at);

CREATE TABLE IF NOT EXISTS provider_tiktok_video_assets (
    asset_key TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    video_url TEXT NOT NULL,
    preferred_quality TEXT NOT NULL,
    max_duration_sec INTEGER NOT NULL,
    with_subtitle BOOLEAN NOT NULL DEFAULT FALSE,
    storage_backend TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    duration_sec INTEGER,
    width INTEGER,
    height INTEGER,
    sha256 TEXT NOT NULL,
    download_status TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    response_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (size_bytes >= 0),
    CHECK (max_duration_sec >= 0),
    CHECK (duration_sec IS NULL OR duration_sec >= 0),
    CHECK (jsonb_typeof(response_json) = 'object')
);

CREATE INDEX IF NOT EXISTS provider_tiktok_video_assets_video_id_idx
ON provider_tiktok_video_assets (video_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS provider_tiktok_video_assets_expires_at_idx
ON provider_tiktok_video_assets (expires_at);

CREATE TABLE IF NOT EXISTS provider_reddit_media_assets (
    asset_key TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    post_url TEXT NOT NULL,
    max_file_size_mb INTEGER NOT NULL,
    subreddit TEXT NOT NULL,
    author TEXT NOT NULL,
    created_utc BIGINT NOT NULL,
    media_type TEXT NOT NULL,
    storage_backend TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    sha256 TEXT NOT NULL,
    download_status TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    response_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (size_bytes >= 0),
    CHECK (max_file_size_mb >= 0),
    CHECK (created_utc >= 0),
    CHECK (media_type IN ('video', 'image_set', 'gif')),
    CHECK (jsonb_typeof(response_json) = 'object')
);

CREATE INDEX IF NOT EXISTS provider_reddit_media_assets_post_id_idx
ON provider_reddit_media_assets (post_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS provider_reddit_media_assets_expires_at_idx
ON provider_reddit_media_assets (expires_at);

CREATE TABLE IF NOT EXISTS provider_github_release_assets (
    asset_key TEXT PRIMARY KEY,
    repo TEXT NOT NULL,
    tag_name TEXT,
    latest BOOLEAN NOT NULL DEFAULT FALSE,
    asset_pattern TEXT,
    asset_name TEXT NOT NULL,
    signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
    storage_backend TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    sha256 TEXT NOT NULL,
    download_status TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    response_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (size_bytes >= 0),
    CHECK (jsonb_typeof(response_json) = 'object')
);

CREATE INDEX IF NOT EXISTS provider_github_release_assets_repo_tag_idx
ON provider_github_release_assets (repo, tag_name, updated_at DESC);

CREATE INDEX IF NOT EXISTS provider_github_release_assets_expires_at_idx
ON provider_github_release_assets (expires_at);

CREATE TABLE IF NOT EXISTS provider_paper_pdf_assets (
    asset_key TEXT PRIMARY KEY,
    source_name TEXT NOT NULL,
    paper_id TEXT,
    paper_url TEXT,
    title TEXT,
    authors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    publication_year INTEGER,
    doi TEXT,
    storage_backend TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    sha256 TEXT NOT NULL,
    text_extract_job_id TEXT,
    download_status TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    response_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (size_bytes >= 0),
    CHECK (publication_year IS NULL OR publication_year >= 1900),
    CHECK (jsonb_typeof(authors_json) = 'array'),
    CHECK (jsonb_typeof(response_json) = 'object')
);

CREATE INDEX IF NOT EXISTS provider_paper_pdf_assets_source_paper_idx
ON provider_paper_pdf_assets (source_name, paper_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS provider_paper_pdf_assets_expires_at_idx
ON provider_paper_pdf_assets (expires_at);
