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
