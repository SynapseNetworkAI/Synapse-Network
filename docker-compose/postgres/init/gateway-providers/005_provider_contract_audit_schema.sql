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

CREATE INDEX IF NOT EXISTS idx_provider_api_invocations_service_created
ON provider_api_invocations (service_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_api_invocations_request_id
ON provider_api_invocations (request_id);

CREATE INDEX IF NOT EXISTS provider_contract_audit_reports_target_idx
ON provider_contract_audit_reports (chain, contract_address, updated_at DESC);

CREATE INDEX IF NOT EXISTS provider_contract_audit_reports_expires_at_idx
ON provider_contract_audit_reports (expires_at);
