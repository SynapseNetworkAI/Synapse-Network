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

CREATE INDEX IF NOT EXISTS provider_sentiment_snapshots_symbol_chain_idx
ON provider_sentiment_snapshots (symbol, chain, updated_at DESC);