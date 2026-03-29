CREATE TABLE IF NOT EXISTS provider_reddit_media_assets (
    asset_key TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    post_url TEXT NOT NULL,
    subreddit TEXT,
    author TEXT,
    media_kind TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS provider_reddit_media_assets_post_id_idx
ON provider_reddit_media_assets (post_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS provider_reddit_media_assets_expires_at_idx
ON provider_reddit_media_assets (expires_at);
