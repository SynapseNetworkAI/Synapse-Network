-- Synapse Gateway PostgreSQL bootstrap schema
-- Executed automatically on first container initialization via docker-entrypoint-initdb.d

CREATE TABLE IF NOT EXISTS synapse_collections (
    collection_name TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS synapse_audit_log (
    id BIGSERIAL PRIMARY KEY,
    collection_name TEXT NOT NULL DEFAULT 'audit_log',
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_synapse_audit_log_created_at
ON synapse_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_audit_log_owner
ON synapse_audit_log ((payload->>'ownerAddress'));

-- Physical dedup guard for deposit idempotency (tx_hash replay protection).
CREATE TABLE IF NOT EXISTS synapse_deposit_dedup (
    tx_hash TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    request_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_synapse_deposit_dedup_owner
ON synapse_deposit_dedup (owner_address, created_at DESC);

-- Physical dedup guard for withdraw/refund completion tx replay protection.
CREATE TABLE IF NOT EXISTS synapse_withdraw_tx_dedup (
    owner_address TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (owner_address, tx_hash, kind)
);

CREATE INDEX IF NOT EXISTS idx_synapse_withdraw_tx_dedup_owner
ON synapse_withdraw_tx_dedup (owner_address, created_at DESC);

CREATE TABLE IF NOT EXISTS synapse_balances (
    owner_address TEXT NOT NULL,
    bucket TEXT NOT NULL,
    amount NUMERIC(36, 6) NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (owner_address, bucket)
);

CREATE TABLE IF NOT EXISTS synapse_deposit_intents (
    id TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    tx_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS synapse_refund_intents (
    id TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    tx_hash TEXT,
    status TEXT NOT NULL,
    amount_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS synapse_withdrawal_intents (
    id TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    tx_hash TEXT,
    status TEXT NOT NULL,
    amount_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS synapse_router_config (
    owner_address TEXT PRIMARY KEY,
    daily_limit_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS synapse_usage_log (
    id TEXT PRIMARY KEY,
    ts BIGINT NOT NULL,
    buyer_address TEXT,
    seller_address TEXT,
    status TEXT,
    total_charge NUMERIC(36, 6),
    payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_synapse_usage_log_owner
ON synapse_usage_log (lower(buyer_address), lower(seller_address), ts DESC);

CREATE TABLE IF NOT EXISTS synapse_processed_deposit_events (
    dedup_key TEXT PRIMARY KEY,
    updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS synapse_service_registry (
    service_id TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS synapse_service_target_health (
    service_id TEXT NOT NULL,
    target_url TEXT NOT NULL,
    owner_address TEXT,
    status TEXT,
    overall_status TEXT,
    http_status INTEGER,
    latency_ms INTEGER,
    consecutive_successes INTEGER NOT NULL DEFAULT 0,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    probe_url TEXT,
    last_checked_at BIGINT,
    last_healthy_at BIGINT,
    error TEXT,
    weight INTEGER,
    region TEXT,
    PRIMARY KEY (service_id, target_url)
);

CREATE TABLE IF NOT EXISTS synapse_service_target_health_history (
    id BIGSERIAL PRIMARY KEY,
    service_id TEXT NOT NULL,
    owner_address TEXT,
    target_url TEXT NOT NULL,
    status TEXT,
    http_status INTEGER,
    latency_ms INTEGER,
    probe_url TEXT,
    consecutive_successes INTEGER NOT NULL DEFAULT 0,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    checked_at BIGINT NOT NULL,
    last_healthy_at BIGINT,
    error TEXT
);

CREATE TABLE IF NOT EXISTS synapse_credentials (
    id TEXT PRIMARY KEY,
    credential_type TEXT NOT NULL,
    owner_address TEXT NOT NULL,
    name TEXT,
    token_hash TEXT,
    token_prefix TEXT,
    status TEXT,
    max_calls INTEGER,
    calls_used INTEGER,
    rpm INTEGER,
    credit_limit NUMERIC(36, 6),
    reset_interval TEXT,
    expiration BIGINT,
    expires_at BIGINT,
    created_at BIGINT,
    updated_at BIGINT,
    revoked_at BIGINT,
    payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_synapse_credentials_type_owner
ON synapse_credentials (credential_type, lower(owner_address), created_at DESC);

CREATE TABLE IF NOT EXISTS synapse_wallet_roles (
    wallet_address TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS synapse_auth_sessions (
    wallet_address TEXT PRIMARY KEY,
    registered_at BIGINT NOT NULL,
    last_login BIGINT NOT NULL,
    status TEXT NOT NULL,
    updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS synapse_platform_fee_policy_default (
    singleton_id SMALLINT PRIMARY KEY,
    default_rate NUMERIC(10, 6) NOT NULL,
    updated_at BIGINT,
    updated_by TEXT
);

CREATE TABLE IF NOT EXISTS synapse_platform_fee_policy_owner (
    owner_address TEXT PRIMARY KEY,
    fee_rate NUMERIC(10, 6) NOT NULL
);

CREATE TABLE IF NOT EXISTS synapse_idempotency_keys (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    owner_address TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response JSONB,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    UNIQUE (scope, owner_address, idempotency_key)
);

CREATE TABLE IF NOT EXISTS synapse_finance_rate_limit (
    id TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    action TEXT NOT NULL,
    window_start BIGINT NOT NULL,
    count INTEGER NOT NULL,
    updated_at BIGINT NOT NULL,
    UNIQUE (owner_address, action)
);

-- Optional seed row to keep non-empty baseline (safe no-op for runtime).
INSERT INTO synapse_collections (collection_name, payload, updated_at)
VALUES ('router_config', '{"rows": [], "updatedAt": 0}'::jsonb, NOW())
ON CONFLICT (collection_name) DO NOTHING;
