-- Synapse Gateway PostgreSQL bootstrap schema
-- Executed automatically on first container initialization via docker-entrypoint-initdb.d

CREATE TABLE IF NOT EXISTS synapse_audit_log (
    id BIGSERIAL PRIMARY KEY,
    action_type TEXT NOT NULL,
    owner_address TEXT NOT NULL,
    actor TEXT,
    request_id TEXT,
    tx_hash TEXT,
    amount_delta NUMERIC(36, 6),
    before_balance NUMERIC(36, 6),
    after_balance NUMERIC(36, 6),
    result_status TEXT,
    error_code TEXT,
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_synapse_audit_log_created_at
ON synapse_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_audit_log_owner
ON synapse_audit_log (lower(owner_address), created_at DESC);

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
    request_id TEXT,
    buyer_address TEXT,
    amount_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    idempotency_key TEXT,
    status TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_synapse_deposit_intents_owner
ON synapse_deposit_intents (lower(owner_address), created_at DESC);

CREATE TABLE IF NOT EXISTS synapse_refund_intents (
    id TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    tx_hash TEXT,
    status TEXT NOT NULL,
    request_id TEXT,
    buyer_address TEXT,
    amount_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    idempotency_key TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_synapse_refund_intents_owner
ON synapse_refund_intents (lower(owner_address), created_at DESC);

CREATE TABLE IF NOT EXISTS synapse_withdrawal_intents (
    id TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    tx_hash TEXT,
    status TEXT NOT NULL,
    request_id TEXT,
    idempotency_key TEXT,
    amount_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    amount_wei TEXT,
    fee_wei TEXT,
    nonce BIGINT,
    deadline BIGINT,
    signature TEXT,
    chain_id BIGINT,
    contract_address TEXT,
    signer_address TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_synapse_withdrawal_intents_owner
ON synapse_withdrawal_intents (lower(owner_address), created_at DESC);

CREATE TABLE IF NOT EXISTS synapse_router_config (
    owner_address TEXT PRIMARY KEY,
    daily_limit_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS synapse_usage_log (
    id TEXT PRIMARY KEY,
    ts BIGINT NOT NULL,
    request_id TEXT,
    service_id TEXT,
    buyer_address TEXT,
    seller_address TEXT,
    status TEXT,
    unit_price NUMERIC(36, 6),
    protocol_fee NUMERIC(36, 6),
    routing_tax NUMERIC(36, 6),
    total_charge NUMERIC(36, 6)
);

CREATE INDEX IF NOT EXISTS idx_synapse_usage_log_owner
ON synapse_usage_log (lower(buyer_address), lower(seller_address), ts DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_usage_log_request
ON synapse_usage_log (request_id);

CREATE TABLE IF NOT EXISTS synapse_processed_deposit_events (
    dedup_key TEXT PRIMARY KEY,
    updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS synapse_service_registry (
    service_id TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    service_name TEXT NOT NULL,
    summary TEXT,
    endpoint TEXT,
    status TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    pricing_amount NUMERIC(36, 6) NOT NULL DEFAULT 0,
    pricing_currency TEXT NOT NULL DEFAULT 'USDC',
    timeout_ms INTEGER,
    max_qps INTEGER,
    max_request_bytes INTEGER,
    max_response_bytes INTEGER,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_synapse_service_registry_owner
ON synapse_service_registry (lower(owner_address), updated_at DESC);

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
    revoked_at BIGINT
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
    response_code TEXT,
    response_digest TEXT,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    UNIQUE (scope, owner_address, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_synapse_idempotency_expires
ON synapse_idempotency_keys (expires_at);

CREATE TABLE IF NOT EXISTS synapse_finance_rate_limit (
    id TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    action TEXT NOT NULL,
    window_start BIGINT NOT NULL,
    count INTEGER NOT NULL,
    updated_at BIGINT NOT NULL,
    UNIQUE (owner_address, action)
);
