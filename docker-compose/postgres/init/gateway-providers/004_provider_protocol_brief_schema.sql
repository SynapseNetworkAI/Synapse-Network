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

CREATE INDEX IF NOT EXISTS provider_protocol_briefs_protocol_chain_idx
ON provider_protocol_briefs (protocol, chain, updated_at DESC);

CREATE INDEX IF NOT EXISTS provider_protocol_briefs_expires_at_idx
ON provider_protocol_briefs (expires_at);

CREATE INDEX IF NOT EXISTS provider_protocol_brief_raw_feeds_brief_key_idx
ON provider_protocol_brief_raw_feeds (brief_key, created_at DESC);

CREATE INDEX IF NOT EXISTS provider_protocol_brief_raw_feeds_source_name_idx
ON provider_protocol_brief_raw_feeds (source_name, created_at DESC);