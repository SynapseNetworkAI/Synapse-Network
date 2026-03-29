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
