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
