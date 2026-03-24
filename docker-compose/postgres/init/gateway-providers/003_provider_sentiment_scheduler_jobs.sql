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