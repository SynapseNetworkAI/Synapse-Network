ALTER TABLE provider_sentiment_snapshots
    ADD COLUMN IF NOT EXISTS symbol TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS chain TEXT NOT NULL DEFAULT 'market-wide',
    ADD COLUMN IF NOT EXISTS lookback_hours INTEGER NOT NULL DEFAULT 24,
    ADD COLUMN IF NOT EXISTS include_narrative BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS source_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_source_age_sec INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS sentiment_score INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sentiment_label TEXT NOT NULL DEFAULT 'neutral',
    ADD COLUMN IF NOT EXISTS trend_direction TEXT NOT NULL DEFAULT 'sideways',
    ADD COLUMN IF NOT EXISTS volatility_signal TEXT NOT NULL DEFAULT 'medium',
    ADD COLUMN IF NOT EXISTS market_temperature TEXT NOT NULL DEFAULT '';

ALTER TABLE provider_sentiment_raw_feeds
    ADD COLUMN IF NOT EXISTS symbol TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS chain TEXT NOT NULL DEFAULT 'market-wide',
    ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS source_timestamp TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS latency_ms INTEGER,
    ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS timeout_ms INTEGER,
    ADD COLUMN IF NOT EXISTS http_status INTEGER,
    ADD COLUMN IF NOT EXISTS payload_hash TEXT,
    ADD COLUMN IF NOT EXISTS error_code TEXT,
    ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE INDEX IF NOT EXISTS provider_sentiment_snapshots_symbol_chain_idx
ON provider_sentiment_snapshots (symbol, chain, updated_at DESC);

CREATE INDEX IF NOT EXISTS provider_sentiment_raw_feeds_source_name_idx
ON provider_sentiment_raw_feeds (source_name, created_at DESC);