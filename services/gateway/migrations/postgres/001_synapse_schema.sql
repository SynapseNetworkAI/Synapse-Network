-- Synapse Gateway PostgreSQL bootstrap schema
-- Pure target-state schema for the Owner / Agent / Provider / Platform model.
-- This file intentionally deletes the old legacy role bootstrap design.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'synapse_budget_event_kind') THEN
        CREATE TYPE synapse_budget_event_kind AS ENUM ('reserve', 'capture', 'release', 'adjust');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'synapse_quote_status') THEN
        CREATE TYPE synapse_quote_status AS ENUM ('OPEN', 'EXPIRED', 'CONSUMED', 'CANCELLED');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'synapse_invocation_status') THEN
        CREATE TYPE synapse_invocation_status AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'SETTLED');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'synapse_withdrawal_kind') THEN
        CREATE TYPE synapse_withdrawal_kind AS ENUM ('consumer_refund', 'provider_withdrawal', 'platform_distribution');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS synapse_owner_accounts (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    owner_id TEXT PRIMARY KEY,
    owner_wallet TEXT NOT NULL UNIQUE,
    display_name TEXT,
    email TEXT,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    pending_email TEXT,
    email_verification_code_hash TEXT,
    email_verification_expires_at TIMESTAMPTZ,
    email_verification_attempts INTEGER NOT NULL DEFAULT 0,
    email_verification_requested_at TIMESTAMPTZ,
    email_verification_send_count INTEGER NOT NULL DEFAULT 0,
    email_verification_send_count_date DATE,
    notify_marketing BOOLEAN NOT NULL DEFAULT TRUE,
    notify_alerts BOOLEAN NOT NULL DEFAULT TRUE,
    status TEXT NOT NULL DEFAULT 'active',
    default_currency TEXT NOT NULL DEFAULT 'USDC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('active', 'suspended', 'closed'))
);

ALTER TABLE synapse_owner_accounts
    ADD COLUMN IF NOT EXISTS pending_email TEXT,
    ADD COLUMN IF NOT EXISTS email_verification_code_hash TEXT,
    ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS email_verification_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS email_verification_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS email_verification_send_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS email_verification_send_count_date DATE;

UPDATE synapse_owner_accounts
SET pending_email = email,
    email = NULL,
    email_verification_requested_at = COALESCE(email_verification_requested_at, NOW()),
    updated_at = NOW()
WHERE email IS NOT NULL
  AND email_verified = FALSE
  AND pending_email IS NULL;

CREATE TABLE IF NOT EXISTS synapse_provider_profiles (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    provider_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL UNIQUE REFERENCES synapse_owner_accounts (owner_id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('active', 'paused', 'archived'))
);

CREATE TABLE IF NOT EXISTS synapse_provider_payout_accounts (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    payout_account_id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL REFERENCES synapse_provider_profiles (provider_id) ON DELETE CASCADE,
    payout_address TEXT NOT NULL,
    chain_id BIGINT NOT NULL,
    settlement_currency TEXT NOT NULL DEFAULT 'USDC',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider_id, payout_address, chain_id),
    CHECK (status IN ('active', 'paused', 'archived'))
);

CREATE TABLE IF NOT EXISTS synapse_agent_profiles (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    agent_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES synapse_owner_accounts (owner_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    purpose TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    runtime_label TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('active', 'paused', 'revoked'))
);

CREATE TABLE IF NOT EXISTS synapse_agent_credentials (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    credential_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES synapse_agent_profiles (agent_id) ON DELETE CASCADE,
    secret_hash TEXT NOT NULL UNIQUE,
    secret_prefix TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    CHECK (status IN ('active', 'revoked', 'expired'))
);

CREATE TABLE IF NOT EXISTS synapse_budget_policies (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    policy_id TEXT PRIMARY KEY,
    credential_id TEXT NOT NULL UNIQUE REFERENCES synapse_agent_credentials (credential_id) ON DELETE CASCADE,
    lifetime_cap_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    daily_cap_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    per_invocation_cap_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    rpm_limit INTEGER NOT NULL DEFAULT 60,
    qps_limit INTEGER NOT NULL DEFAULT 5,
    allowed_service_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    allowed_service_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    blocked_service_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (lifetime_cap_usdc >= 0),
    CHECK (daily_cap_usdc >= 0),
    CHECK (per_invocation_cap_usdc >= 0),
    CHECK (rpm_limit >= 0),
    CHECK (qps_limit >= 0),
    CHECK (jsonb_typeof(allowed_service_tags) = 'array'),
    CHECK (jsonb_typeof(allowed_service_ids) = 'array'),
    CHECK (jsonb_typeof(blocked_service_ids) = 'array')
);

CREATE TABLE IF NOT EXISTS synapse_service_manifests (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    service_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES synapse_owner_accounts (owner_id) ON DELETE RESTRICT,
    provider_id TEXT NOT NULL REFERENCES synapse_provider_profiles (provider_id) ON DELETE RESTRICT,
    service_name TEXT NOT NULL,
    manifest_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    description_for_model TEXT NOT NULL,
    task_category TEXT,
    capabilities_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    examples_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    limitations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    price_model TEXT NOT NULL,
    base_price_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    quote_required BOOLEAN NOT NULL DEFAULT TRUE,
    settlement_currency TEXT NOT NULL DEFAULT 'USDC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('draft', 'active', 'paused', 'offline', 'archived')),
    CHECK (price_model IN ('fixed', 'tiered', 'quote', 'token_metered')),
    CHECK (base_price_usdc >= 0),
    CHECK (jsonb_typeof(capabilities_json) = 'array'),
    CHECK (jsonb_typeof(input_schema) = 'object'),
    CHECK (jsonb_typeof(output_schema) = 'object'),
    CHECK (jsonb_typeof(examples_json) = 'array'),
    CHECK (jsonb_typeof(limitations_json) = 'array')
);

CREATE TABLE IF NOT EXISTS synapse_service_endpoints (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    endpoint_id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL REFERENCES synapse_service_manifests (service_id) ON DELETE CASCADE,
    endpoint_url TEXT NOT NULL,
    auth_mode TEXT NOT NULL DEFAULT 'gateway_forward',
    timeout_ms INTEGER NOT NULL DEFAULT 15000,
    max_payload_bytes INTEGER NOT NULL DEFAULT 4194304,
    streaming_supported BOOLEAN NOT NULL DEFAULT FALSE,
    async_supported BOOLEAN NOT NULL DEFAULT FALSE,
    callback_supported BOOLEAN NOT NULL DEFAULT FALSE,
    region TEXT,
    weight INTEGER NOT NULL DEFAULT 100,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (timeout_ms BETWEEN 300 AND 300000),
    CHECK (max_payload_bytes BETWEEN 256 AND 33554432),
    CHECK (weight BETWEEN 1 AND 1000),
    CHECK (status IN ('active', 'paused', 'archived'))
);

CREATE TABLE IF NOT EXISTS synapse_service_health_snapshots (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    service_id TEXT NOT NULL REFERENCES synapse_service_manifests (service_id) ON DELETE CASCADE,
    endpoint_id TEXT NOT NULL REFERENCES synapse_service_endpoints (endpoint_id) ON DELETE CASCADE,
    health_score INTEGER NOT NULL DEFAULT 100,
    p95_latency_ms INTEGER,
    success_rate_24h NUMERIC(8, 6),
    last_checked_at TIMESTAMPTZ,
    error_code TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (service_id, endpoint_id),
    CHECK (health_score BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS synapse_service_health_runtime (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    service_id TEXT NOT NULL REFERENCES synapse_service_manifests (service_id) ON DELETE CASCADE,
    target_url TEXT NOT NULL,
    owner_address TEXT,
    status TEXT NOT NULL DEFAULT 'unknown',
    overall_status TEXT,
    http_status INTEGER,
    latency_ms INTEGER,
    consecutive_successes INTEGER NOT NULL DEFAULT 0,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    probe_url TEXT,
    last_checked_at TIMESTAMPTZ,
    last_healthy_at TIMESTAMPTZ,
    timeout_ms INTEGER,
    error_code TEXT,
    offline_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (service_id, target_url),
    CHECK (consecutive_successes >= 0),
    CHECK (consecutive_failures >= 0)
);

CREATE TABLE IF NOT EXISTS synapse_service_health_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    service_id TEXT NOT NULL REFERENCES synapse_service_manifests (service_id) ON DELETE CASCADE,
    target_url TEXT NOT NULL,
    owner_address TEXT,
    from_status TEXT,
    to_status TEXT NOT NULL DEFAULT 'unknown',
    http_status INTEGER,
    latency_ms INTEGER,
    probe_url TEXT,
    consecutive_successes INTEGER NOT NULL DEFAULT 0,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    checked_at TIMESTAMPTZ NOT NULL,
    last_healthy_at TIMESTAMPTZ,
    error_code TEXT,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (consecutive_successes >= 0),
    CHECK (consecutive_failures >= 0)
);

CREATE TABLE IF NOT EXISTS synapse_service_search_index (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    service_id TEXT PRIMARY KEY REFERENCES synapse_service_manifests (service_id) ON DELETE CASCADE,
    tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    search_text TEXT NOT NULL,
    embedding_ref TEXT,
    reliability_tier TEXT,
    health_score INTEGER,
    p95_latency_ms INTEGER,
    success_rate_24h NUMERIC(8, 6),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (jsonb_typeof(tags_json) = 'array')
);

CREATE TABLE IF NOT EXISTS synapse_service_quotes (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    quote_id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL REFERENCES synapse_service_manifests (service_id) ON DELETE RESTRICT,
    credential_id TEXT NOT NULL REFERENCES synapse_agent_credentials (credential_id) ON DELETE RESTRICT,
    agent_id TEXT NOT NULL REFERENCES synapse_agent_profiles (agent_id) ON DELETE RESTRICT,
    quoted_price_usdc NUMERIC(36, 6) NOT NULL,
    price_model TEXT NOT NULL,
    status synapse_quote_status NOT NULL DEFAULT 'OPEN',
    request_fingerprint TEXT NOT NULL,
    response_mode TEXT NOT NULL DEFAULT 'sync',
    invoke_constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (quoted_price_usdc >= 0),
    CHECK (price_model IN ('fixed', 'tiered', 'quote', 'token_metered')),
    CHECK (response_mode IN ('sync', 'async', 'stream')),
    CHECK (jsonb_typeof(invoke_constraints) = 'object')
);

ALTER TABLE synapse_service_manifests
DROP CONSTRAINT IF EXISTS synapse_service_manifests_price_model_check;

ALTER TABLE synapse_service_manifests
ADD CONSTRAINT synapse_service_manifests_price_model_check
CHECK (price_model IN ('fixed', 'tiered', 'quote', 'token_metered'));

ALTER TABLE synapse_service_manifests
DROP CONSTRAINT IF EXISTS synapse_service_manifests_status_check;

ALTER TABLE synapse_service_manifests
ADD CONSTRAINT synapse_service_manifests_status_check
CHECK (status IN ('draft', 'active', 'paused', 'offline', 'archived'));

ALTER TABLE synapse_service_quotes
DROP CONSTRAINT IF EXISTS synapse_service_quotes_price_model_check;

ALTER TABLE synapse_service_quotes
ADD CONSTRAINT synapse_service_quotes_price_model_check
CHECK (price_model IN ('fixed', 'tiered', 'quote', 'token_metered'));

ALTER TABLE synapse_service_quotes
DROP CONSTRAINT IF EXISTS synapse_service_quotes_quoted_price_usdc_check;

ALTER TABLE synapse_service_quotes
ADD CONSTRAINT synapse_service_quotes_quoted_price_usdc_check
CHECK (quoted_price_usdc >= 0);

ALTER TABLE synapse_service_endpoints
DROP CONSTRAINT IF EXISTS synapse_service_endpoints_timeout_ms_check;

ALTER TABLE synapse_service_endpoints
ADD CONSTRAINT synapse_service_endpoints_timeout_ms_check
CHECK (timeout_ms BETWEEN 300 AND 300000);

CREATE TABLE IF NOT EXISTS synapse_invocations (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    invocation_id TEXT PRIMARY KEY,
    quote_id TEXT NOT NULL REFERENCES synapse_service_quotes (quote_id) ON DELETE RESTRICT,
    service_id TEXT NOT NULL REFERENCES synapse_service_manifests (service_id) ON DELETE RESTRICT,
    endpoint_id TEXT REFERENCES synapse_service_endpoints (endpoint_id) ON DELETE SET NULL,
    credential_id TEXT NOT NULL REFERENCES synapse_agent_credentials (credential_id) ON DELETE RESTRICT,
    agent_id TEXT NOT NULL REFERENCES synapse_agent_profiles (agent_id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    response_mode TEXT NOT NULL DEFAULT 'sync',
    status synapse_invocation_status NOT NULL DEFAULT 'PENDING',
    charged_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    error_code TEXT,
    error_action TEXT,
    upstream_status INTEGER,
    result_digest TEXT,
    result_json JSONB,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (credential_id, idempotency_key),
    CHECK (response_mode IN ('sync', 'async', 'stream')),
    CHECK (charged_usdc >= 0)
);

CREATE TABLE IF NOT EXISTS synapse_budget_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    event_id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL REFERENCES synapse_budget_policies (policy_id) ON DELETE RESTRICT,
    credential_id TEXT NOT NULL REFERENCES synapse_agent_credentials (credential_id) ON DELETE RESTRICT,
    quote_id TEXT REFERENCES synapse_service_quotes (quote_id) ON DELETE SET NULL,
    invocation_id TEXT REFERENCES synapse_invocations (invocation_id) ON DELETE SET NULL,
    event_kind synapse_budget_event_kind NOT NULL,
    amount_usdc NUMERIC(36, 6) NOT NULL,
    remaining_lifetime_usdc NUMERIC(36, 6),
    remaining_daily_usdc NUMERIC(36, 6),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (amount_usdc > 0)
);

CREATE TABLE IF NOT EXISTS synapse_ledger_accounts (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    account_id TEXT PRIMARY KEY,
    account_kind TEXT NOT NULL,
    owner_id TEXT REFERENCES synapse_owner_accounts (owner_id) ON DELETE SET NULL,
    provider_id TEXT REFERENCES synapse_provider_profiles (provider_id) ON DELETE SET NULL,
    currency TEXT NOT NULL DEFAULT 'USDC',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (account_kind IN ('consumer_wallet', 'provider_wallet', 'platform_revenue', 'budget_hold')),
    CHECK (status IN ('active', 'paused', 'closed')),
    CHECK (
        (account_kind = 'consumer_wallet' AND owner_id IS NOT NULL AND provider_id IS NULL)
        OR (account_kind = 'provider_wallet' AND owner_id IS NOT NULL AND provider_id IS NOT NULL)
        OR (account_kind = 'platform_revenue' AND owner_id IS NULL AND provider_id IS NULL)
        OR (account_kind = 'budget_hold' AND owner_id IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS synapse_account_balances (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    account_id TEXT PRIMARY KEY REFERENCES synapse_ledger_accounts (account_id) ON DELETE CASCADE,
    available_balance NUMERIC(36, 6) NOT NULL DEFAULT 0,
    pending_balance NUMERIC(36, 6) NOT NULL DEFAULT 0,
    frozen_balance NUMERIC(36, 6) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (available_balance >= 0),
    CHECK (pending_balance >= 0),
    CHECK (frozen_balance >= 0)
);

CREATE TABLE IF NOT EXISTS synapse_ledger_entries (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    entry_id TEXT PRIMARY KEY,
    reference_type TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    business_type TEXT NOT NULL,
    debit_account_id TEXT NOT NULL REFERENCES synapse_ledger_accounts (account_id) ON DELETE RESTRICT,
    credit_account_id TEXT NOT NULL REFERENCES synapse_ledger_accounts (account_id) ON DELETE RESTRICT,
    amount_usdc NUMERIC(36, 6) NOT NULL,
    status TEXT NOT NULL DEFAULT 'posted',
    request_id TEXT,
    trace_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (amount_usdc > 0),
    CHECK (status IN ('pending', 'posted', 'reversed')),
    UNIQUE (reference_type, reference_id, debit_account_id, credit_account_id)
);

CREATE TABLE IF NOT EXISTS synapse_vault_deposits (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    deposit_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES synapse_owner_accounts (owner_id) ON DELETE RESTRICT,
    owner_address TEXT NOT NULL,
    target_account_id TEXT NOT NULL REFERENCES synapse_ledger_accounts (account_id) ON DELETE RESTRICT,
    tx_hash TEXT NOT NULL UNIQUE,
    amount_usdc NUMERIC(36, 6) NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    block_number BIGINT,
    request_id TEXT,
    client_request_id TEXT,
    client_ip TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (amount_usdc > 0),
    CHECK (status IN ('PENDING_CONFIRMATION', 'CONFIRMED', 'FAILED'))
);

CREATE TABLE IF NOT EXISTS synapse_vault_withdrawals (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    withdrawal_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES synapse_owner_accounts (owner_id) ON DELETE RESTRICT,
    provider_id TEXT REFERENCES synapse_provider_profiles (provider_id) ON DELETE SET NULL,
    source_account_id TEXT NOT NULL REFERENCES synapse_ledger_accounts (account_id) ON DELETE RESTRICT,
    withdrawal_kind synapse_withdrawal_kind NOT NULL,
    tx_hash TEXT UNIQUE,
    amount_usdc NUMERIC(36, 6) NOT NULL,
    status TEXT NOT NULL DEFAULT 'REQUESTED',
    request_id TEXT,
    ticket_id TEXT,
    ticket_hash TEXT,
    signature TEXT,
    nonce BIGINT,
    deadline BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (amount_usdc > 0),
    CHECK (status IN ('REQUESTED', 'SIGNED', 'FAILED', 'FAILED_EXPIRED', 'APPROVED_AUTO', 'PENDING_MANUAL_REVIEW', 'REJECTED', 'COMPLETED', 'CANCELLED')),
    CHECK (
        (withdrawal_kind = 'consumer_refund' AND provider_id IS NULL)
        OR (withdrawal_kind = 'provider_withdrawal' AND provider_id IS NOT NULL)
        OR (withdrawal_kind = 'platform_distribution')
    )
);

CREATE TABLE IF NOT EXISTS synapse_audit_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    business_type TEXT NOT NULL,
    owner_id TEXT,
    provider_id TEXT,
    agent_id TEXT,
    credential_id TEXT,
    service_id TEXT,
    quote_id TEXT,
    invocation_id TEXT,
    amount_delta NUMERIC(36, 6),
    result_status TEXT,
    error_code TEXT,
    detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (jsonb_typeof(detail_json) = 'object')
);

CREATE TABLE IF NOT EXISTS synapse_analytics_outbox (
    row_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    event_name TEXT NOT NULL,
    event_key TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT,
    lease_id TEXT,
    leased_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('pending', 'retry', 'leased', 'dead_letter')),
    CHECK (jsonb_typeof(payload) = 'object'),
    CHECK (attempt_count >= 0)
);

CREATE TABLE IF NOT EXISTS synapse_notification_outbox (
    row_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    notification_id TEXT NOT NULL UNIQUE,
    dedupe_key TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    recipient_owner_id TEXT,
    priority TEXT NOT NULL DEFAULT 'transactional',
    template_key TEXT NOT NULL,
    template_version TEXT NOT NULL DEFAULT 'v1',
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT,
    lease_id TEXT,
    leased_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('pending', 'retry', 'leased', 'dead_letter', 'suppressed')),
    CHECK (priority IN ('security', 'transactional_high', 'transactional', 'ops', 'digest')),
    CHECK (jsonb_typeof(payload) = 'object'),
    CHECK (attempt_count >= 0)
);

CREATE TABLE IF NOT EXISTS synapse_notification_delivery_log (
    row_id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    notification_id TEXT PRIMARY KEY,
    dedupe_key TEXT NOT NULL,
    event_type TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    recipient_owner_id TEXT,
    priority TEXT NOT NULL,
    template_key TEXT NOT NULL,
    template_version TEXT NOT NULL,
    message_id TEXT,
    provider_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (jsonb_typeof(provider_response) = 'object')
);

CREATE TABLE IF NOT EXISTS synapse_in_app_notifications (
    row_id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    notification_id TEXT PRIMARY KEY,
    dedupe_key TEXT NOT NULL UNIQUE,
    recipient_type TEXT NOT NULL,
    recipient_owner_id TEXT,
    recipient_admin_id TEXT,
    event_type TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    priority TEXT NOT NULL DEFAULT 'transactional',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    action_url TEXT,
    resource_type TEXT,
    resource_id TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    read_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (recipient_type IN ('owner', 'provider', 'admin', 'ops')),
    CHECK (category IN ('finance', 'withdrawal', 'deposit', 'refund', 'security', 'service', 'approval', 'system')),
    CHECK (severity IN ('info', 'success', 'warning', 'critical')),
    CHECK (priority IN ('security', 'transactional_high', 'transactional', 'ops', 'digest')),
    CHECK (jsonb_typeof(payload) = 'object'),
    CHECK (
        (recipient_type IN ('owner', 'provider') AND recipient_owner_id IS NOT NULL)
        OR (recipient_type = 'admin' AND recipient_admin_id IS NOT NULL)
        OR (recipient_type = 'ops')
    )
);

CREATE TABLE IF NOT EXISTS synapse_idempotency_keys (
    row_id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES synapse_owner_accounts (owner_id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_code TEXT,
    response_digest TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at BIGINT NOT NULL,
    UNIQUE (scope, owner_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS synapse_finance_rate_limit (
    row_id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES synapse_owner_accounts (owner_id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    window_start BIGINT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (count >= 0),
    UNIQUE (owner_id, action)
);

CREATE TABLE IF NOT EXISTS synapse_runtime_state (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    state_key TEXT PRIMARY KEY,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS synapse_processed_deposit_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    dedup_key TEXT PRIMARY KEY,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS synapse_deposit_attempts (
    id BIGSERIAL PRIMARY KEY,
    attempt_id TEXT NOT NULL,
    owner_id TEXT REFERENCES synapse_owner_accounts (owner_id) ON DELETE SET NULL,
    owner_address TEXT,
    client_request_id TEXT,
    tx_hash TEXT,
    amount_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    stage TEXT NOT NULL,
    failure_reason TEXT,
    request_id TEXT,
    client_ip TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (amount_usdc > 0),
    CHECK (stage IN ('SIGN_REQUESTED', 'TX_BROADCASTED', 'RECEIPT_FAILED', 'RECEIPT_CONFIRMED', 'INTENT_REGISTERED')),
    UNIQUE (attempt_id, stage)
);

CREATE TABLE IF NOT EXISTS synapse_platform_fee_policy_default (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    singleton_id INTEGER NOT NULL UNIQUE,
    default_rate NUMERIC(12, 6) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT NOT NULL,
    CHECK (default_rate >= 0),
    CHECK (singleton_id = 1)
);

CREATE TABLE IF NOT EXISTS synapse_platform_fee_policy_owner (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_address TEXT NOT NULL UNIQUE,
    fee_rate NUMERIC(12, 6) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (fee_rate >= 0)
);

CREATE TABLE IF NOT EXISTS synapse_provider_risk_flags (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_address TEXT NOT NULL UNIQUE,
    is_high_risk BOOLEAN NOT NULL DEFAULT FALSE,
    risk_reason_code TEXT,
    risk_level TEXT NOT NULL DEFAULT 'green',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (risk_level IN ('green', 'yellow', 'red'))
);

CREATE TABLE IF NOT EXISTS synapse_withdraw_tx_dedup (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_address TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_address, tx_hash, kind)
);

CREATE TABLE IF NOT EXISTS synapse_router_config (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_address TEXT NOT NULL UNIQUE,
    daily_limit_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (daily_limit_usdc >= 0)
);

CREATE TABLE IF NOT EXISTS synapse_owner_spend_limits (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_address TEXT NOT NULL UNIQUE,
    spending_limit_usdc NUMERIC(36, 6),
    cycle_interval TEXT NOT NULL DEFAULT 'monthly',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (spending_limit_usdc IS NULL OR spending_limit_usdc > 0),
    CHECK (cycle_interval IN ('monthly'))
);

ALTER TABLE IF EXISTS synapse_ledger_accounts
DROP CONSTRAINT IF EXISTS synapse_ledger_accounts_account_kind_check;

ALTER TABLE IF EXISTS synapse_ledger_accounts
ADD CONSTRAINT synapse_ledger_accounts_account_kind_check
CHECK (
    account_kind IN (
        'consumer_wallet',
        'provider_wallet',
        'platform_revenue',
        'platform_promo',
        'budget_hold'
    )
);

ALTER TABLE IF EXISTS synapse_ledger_accounts
DROP CONSTRAINT IF EXISTS synapse_ledger_accounts_check;

ALTER TABLE IF EXISTS synapse_ledger_accounts
ADD CONSTRAINT synapse_ledger_accounts_check
CHECK (
    (account_kind = 'consumer_wallet' AND owner_id IS NOT NULL AND provider_id IS NULL)
    OR (account_kind = 'provider_wallet' AND owner_id IS NOT NULL AND provider_id IS NOT NULL)
    OR (account_kind IN ('platform_revenue', 'platform_promo') AND owner_id IS NULL AND provider_id IS NULL)
    OR (account_kind = 'budget_hold' AND owner_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS synapse_credit_voucher_campaigns (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    campaign_id TEXT PRIMARY KEY,
    campaign_code TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    credit_amount_usdc NUMERIC(36, 6) NOT NULL,
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    max_total_redemptions INTEGER,
    max_redemptions_per_owner INTEGER NOT NULL DEFAULT 1,
    allowlist_mode TEXT NOT NULL DEFAULT 'open',
    notes TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (credit_amount_usdc > 0),
    CHECK (max_total_redemptions IS NULL OR max_total_redemptions > 0),
    CHECK (max_redemptions_per_owner > 0),
    CHECK (status IN ('draft', 'active', 'paused', 'expired', 'archived')),
    CHECK (allowlist_mode IN ('open', 'owner_allowlist'))
);

CREATE TABLE IF NOT EXISTS synapse_credit_voucher_codes (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    voucher_code_id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES synapse_credit_voucher_campaigns (campaign_id) ON DELETE RESTRICT,
    code_hash TEXT NOT NULL UNIQUE,
    code_last4 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    owner_id_redeemed TEXT REFERENCES synapse_owner_accounts (owner_id) ON DELETE SET NULL,
    redeemed_by_address TEXT,
    redeemed_at TIMESTAMPTZ,
    redemption_id TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('active', 'reserved', 'redeemed', 'disabled', 'expired'))
);

CREATE TABLE IF NOT EXISTS synapse_credit_voucher_owner_allowlist (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    campaign_id TEXT NOT NULL REFERENCES synapse_credit_voucher_campaigns (campaign_id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL REFERENCES synapse_owner_accounts (owner_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id, owner_id)
);

CREATE TABLE IF NOT EXISTS synapse_credit_voucher_redemptions (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    redemption_id TEXT PRIMARY KEY,
    voucher_code_id TEXT NOT NULL REFERENCES synapse_credit_voucher_codes (voucher_code_id) ON DELETE RESTRICT,
    campaign_id TEXT NOT NULL REFERENCES synapse_credit_voucher_campaigns (campaign_id) ON DELETE RESTRICT,
    owner_id TEXT NOT NULL REFERENCES synapse_owner_accounts (owner_id) ON DELETE RESTRICT,
    owner_address TEXT NOT NULL,
    target_account_id TEXT NOT NULL REFERENCES synapse_ledger_accounts (account_id) ON DELETE RESTRICT,
    promo_account_id TEXT NOT NULL REFERENCES synapse_ledger_accounts (account_id) ON DELETE RESTRICT,
    ledger_entry_id TEXT UNIQUE REFERENCES synapse_ledger_entries (entry_id) ON DELETE SET NULL,
    granted_amount_usdc NUMERIC(36, 6) NOT NULL,
    before_balance_usdc NUMERIC(36, 6) NOT NULL,
    after_balance_usdc NUMERIC(36, 6) NOT NULL,
    status TEXT NOT NULL DEFAULT 'COMPLETED',
    request_id TEXT,
    client_request_id TEXT,
    request_hash TEXT,
    client_ip TEXT,
    user_agent TEXT,
    failure_code TEXT,
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (granted_amount_usdc > 0),
    CHECK (before_balance_usdc >= 0),
    CHECK (after_balance_usdc >= 0),
    CHECK (status IN ('PENDING', 'COMPLETED', 'REVERSED', 'FAILED'))
);

CREATE TABLE IF NOT EXISTS synapse_feedback_reports (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    feedback_id TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'dashboard',
    sentiment TEXT NOT NULL DEFAULT 'report_issue',
    category TEXT NOT NULL DEFAULT 'product_feedback',
    message TEXT NOT NULL DEFAULT '',
    route TEXT NOT NULL DEFAULT '',
    page_title TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT '',
    owner_address TEXT,
    context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'open',
    assignee TEXT,
    resolution_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (source IN ('docs', 'dashboard', 'forum', 'general')),
    CHECK (sentiment IN ('helpful', 'not_helpful', 'report_issue')),
    CHECK (status IN ('open', 'triaged', 'resolved', 'closed'))
);

CREATE TABLE IF NOT EXISTS synapse_forum_topics (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    topic_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    excerpt TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    author_address TEXT NOT NULL,
    author_display TEXT NOT NULL,
    author_roles TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    status TEXT NOT NULL DEFAULT 'open',
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    locked BOOLEAN NOT NULL DEFAULT FALSE,
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    closed_reason TEXT,
    closed_by_admin_id TEXT,
    closed_at TIMESTAMPTZ,
    views_count INTEGER NOT NULL DEFAULT 0,
    replies_count INTEGER NOT NULL DEFAULT 0,
    reactions_count INTEGER NOT NULL DEFAULT 0,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (category IN ('Announcements', 'Questions', 'Bugs', 'Feature Requests', 'Provider Services', 'SDKs', 'Showcase')),
    CHECK (status IN ('open', 'awaiting_admin', 'answered', 'resolved', 'closed', 'hidden', 'locked'))
);

CREATE TABLE IF NOT EXISTS synapse_forum_topic_events (
    event_id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES synapse_forum_topics (topic_id) ON DELETE CASCADE,
    actor_admin_id TEXT,
    action TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    reason TEXT,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE synapse_forum_topics
ADD COLUMN IF NOT EXISTS closed_reason TEXT,
ADD COLUMN IF NOT EXISTS closed_by_admin_id TEXT,
ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE synapse_forum_topics
DROP CONSTRAINT IF EXISTS synapse_forum_topics_status_check;

ALTER TABLE synapse_forum_topics
ADD CONSTRAINT synapse_forum_topics_status_check
CHECK (status IN ('open', 'awaiting_admin', 'answered', 'resolved', 'closed', 'hidden', 'locked'));

CREATE TABLE IF NOT EXISTS synapse_forum_replies (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    reply_id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES synapse_forum_topics (topic_id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    author_address TEXT NOT NULL,
    author_display TEXT NOT NULL,
    author_roles TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    status TEXT NOT NULL DEFAULT 'visible',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('visible', 'hidden', 'deleted'))
);

CREATE TABLE IF NOT EXISTS synapse_forum_reactions (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    reaction_id TEXT PRIMARY KEY,
    topic_id TEXT REFERENCES synapse_forum_topics (topic_id) ON DELETE CASCADE,
    reply_id TEXT REFERENCES synapse_forum_replies (reply_id) ON DELETE CASCADE,
    actor_address TEXT NOT NULL,
    reaction TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (reaction IN ('upvote', 'helpful', 'same_issue')),
    CHECK (
        (topic_id IS NOT NULL AND reply_id IS NULL)
        OR (topic_id IS NULL AND reply_id IS NOT NULL)
    ),
    UNIQUE (topic_id, actor_address, reaction),
    UNIQUE (reply_id, actor_address, reaction)
);

CREATE TABLE IF NOT EXISTS synapse_forum_response_tasks (
    response_task_id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES synapse_forum_topics (topic_id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'awaiting_response',
    source TEXT NOT NULL DEFAULT 'user_post',
    priority TEXT NOT NULL DEFAULT 'normal',
    classification TEXT,
    suggested_reply TEXT,
    suggested_reply_source TEXT,
    suggested_reply_updated_at TIMESTAMPTZ,
    replied_by_admin_id TEXT,
    reply_id TEXT REFERENCES synapse_forum_replies (reply_id) ON DELETE SET NULL,
    responded_at TIMESTAMPTZ,
    linked_requirement_candidate_id TEXT,
    linked_requirement_id TEXT,
    linked_workflow_run_id TEXT,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('awaiting_response', 'draft_ready', 'responded', 'ignored', 'closed')),
    CHECK (source IN ('user_post', 'growing_agent', 'admin')),
    CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    CHECK (
        classification IS NULL OR classification IN (
            'question', 'bug', 'feature_request', 'docs_issue',
            'needs_more_info', 'spam'
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_synapse_forum_response_tasks_active_topic
ON synapse_forum_response_tasks (topic_id)
WHERE status IN ('awaiting_response', 'draft_ready');

CREATE INDEX IF NOT EXISTS idx_synapse_provider_profiles_owner
ON synapse_provider_profiles (owner_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_synapse_owner_accounts_email_unique
ON synapse_owner_accounts ((lower(email)))
WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_synapse_agent_credentials_agent
ON synapse_agent_credentials (agent_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_budget_policies_credential
ON synapse_budget_policies (credential_id);

CREATE INDEX IF NOT EXISTS idx_synapse_service_manifests_owner
ON synapse_service_manifests (owner_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_service_manifests_provider
ON synapse_service_manifests (provider_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_service_manifests_status
ON synapse_service_manifests (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_service_search_index_tags_gin
ON synapse_service_search_index USING GIN (tags_json);

CREATE INDEX IF NOT EXISTS idx_synapse_service_quotes_lookup
ON synapse_service_quotes (credential_id, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_service_health_runtime_status
ON synapse_service_health_runtime (status, last_checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_service_health_events_service_created
ON synapse_service_health_events (service_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_service_health_events_created
ON synapse_service_health_events (created_at);

CREATE INDEX IF NOT EXISTS idx_synapse_invocations_service_created
ON synapse_invocations (service_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_budget_events_credential_created
ON synapse_budget_events (credential_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_ledger_accounts_kind_owner
ON synapse_ledger_accounts (account_kind, owner_id, provider_id);

CREATE INDEX IF NOT EXISTS idx_synapse_ledger_entries_reference
ON synapse_ledger_entries (reference_type, reference_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_ledger_entries_debit_business_created
ON synapse_ledger_entries (debit_account_id, business_type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_ledger_entries_credit_business_created
ON synapse_ledger_entries (credit_account_id, business_type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_vault_deposits_owner_created
ON synapse_vault_deposits (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_vault_deposits_owner_status_updated
ON synapse_vault_deposits (owner_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_vault_withdrawals_kind_owner
ON synapse_vault_withdrawals (withdrawal_kind, owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_audit_events_owner_created
ON synapse_audit_events (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_audit_events_provider_created
ON synapse_audit_events (provider_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_analytics_outbox_claim
ON synapse_analytics_outbox (status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_synapse_analytics_outbox_dead_letter
ON synapse_analytics_outbox (created_at DESC)
WHERE status = 'dead_letter';

CREATE INDEX IF NOT EXISTS idx_synapse_notification_outbox_claim
ON synapse_notification_outbox (status, next_attempt_at, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_synapse_notification_outbox_dead_letter
ON synapse_notification_outbox (created_at DESC)
WHERE status = 'dead_letter';

CREATE INDEX IF NOT EXISTS idx_synapse_notification_delivery_log_recipient_created
ON synapse_notification_delivery_log (recipient_email, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_notification_delivery_log_daily
ON synapse_notification_delivery_log (sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_in_app_notifications_owner_unread
ON synapse_in_app_notifications (recipient_owner_id, read_at, created_at DESC)
WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_synapse_in_app_notifications_admin_unread
ON synapse_in_app_notifications (recipient_admin_id, read_at, created_at DESC)
WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_synapse_in_app_notifications_owner_created
ON synapse_in_app_notifications (recipient_owner_id, created_at DESC)
WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_synapse_in_app_notifications_dedupe
ON synapse_in_app_notifications (dedupe_key);

CREATE INDEX IF NOT EXISTS idx_synapse_in_app_notifications_expires
ON synapse_in_app_notifications (expires_at);

CREATE INDEX IF NOT EXISTS idx_synapse_idempotency_keys_expires
ON synapse_idempotency_keys (expires_at);

CREATE INDEX IF NOT EXISTS idx_synapse_finance_rate_limit_owner_action
ON synapse_finance_rate_limit (owner_id, action);

CREATE INDEX IF NOT EXISTS idx_synapse_runtime_state_updated_at
ON synapse_runtime_state (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_processed_deposit_events_updated_at
ON synapse_processed_deposit_events (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_deposit_attempts_owner
ON synapse_deposit_attempts (lower(COALESCE(owner_address, '')), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_deposit_attempts_tx_hash
ON synapse_deposit_attempts (tx_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_deposit_attempts_stage
ON synapse_deposit_attempts (stage, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_vault_deposits_owner_address_created
ON synapse_vault_deposits (owner_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_platform_fee_policy_owner_address
ON synapse_platform_fee_policy_owner (owner_address);

CREATE INDEX IF NOT EXISTS idx_synapse_provider_risk_flags_high_risk
ON synapse_provider_risk_flags (is_high_risk, owner_address);

CREATE INDEX IF NOT EXISTS idx_synapse_withdraw_tx_dedup_lookup
ON synapse_withdraw_tx_dedup (owner_address, tx_hash, kind);

CREATE INDEX IF NOT EXISTS idx_synapse_router_config_updated_at
ON synapse_router_config (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_owner_spend_limits_updated_at
ON synapse_owner_spend_limits (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_voucher_campaign_status_window
ON synapse_credit_voucher_campaigns (status, starts_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_voucher_codes_campaign_status
ON synapse_credit_voucher_codes (campaign_id, status, redeemed_at DESC);

CREATE INDEX IF NOT EXISTS idx_voucher_redemptions_owner_created
ON synapse_credit_voucher_redemptions (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voucher_redemptions_campaign_created
ON synapse_credit_voucher_redemptions (campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_feedback_reports_route_created
ON synapse_feedback_reports (route, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_feedback_reports_owner_created
ON synapse_feedback_reports (owner_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_forum_topics_category_activity
ON synapse_forum_topics (category, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_forum_topics_activity
ON synapse_forum_topics (last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_forum_topics_status_activity
ON synapse_forum_topics (status, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_forum_topics_pinned_activity
ON synapse_forum_topics (pinned DESC, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_forum_topics_views
ON synapse_forum_topics (views_count DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_forum_replies_topic_created
ON synapse_forum_replies (topic_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_synapse_forum_response_tasks_status_updated
ON synapse_forum_response_tasks (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_forum_topic_events_topic_created
ON synapse_forum_topic_events (topic_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_voucher_redemptions_code_live
ON synapse_credit_voucher_redemptions (voucher_code_id)
WHERE status IN ('PENDING', 'COMPLETED', 'REVERSED');

CREATE UNIQUE INDEX IF NOT EXISTS uq_voucher_redemptions_owner_client_request
ON synapse_credit_voucher_redemptions (owner_id, client_request_id)
WHERE client_request_id IS NOT NULL
  AND status IN ('PENDING', 'COMPLETED', 'REVERSED');

ALTER TABLE IF EXISTS synapse_vault_withdrawals
ADD COLUMN IF NOT EXISTS ticket_id TEXT;

ALTER TABLE IF EXISTS synapse_vault_withdrawals
ADD COLUMN IF NOT EXISTS ticket_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_synapse_vault_withdrawals_ticket_hash
ON synapse_vault_withdrawals (ticket_hash)
WHERE ticket_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_synapse_vault_withdrawals_one_ticket
ON synapse_vault_withdrawals (withdrawal_id)
WHERE ticket_hash IS NOT NULL;

-- Reconcile legacy lowercase withdrawal statuses into the target uppercase contract.

UPDATE synapse_vault_withdrawals
SET status = CASE status
    WHEN 'requested' THEN 'REQUESTED'
    WHEN 'signed' THEN 'SIGNED'
    WHEN 'failed' THEN 'FAILED'
    WHEN 'failed_expired' THEN 'FAILED_EXPIRED'
    WHEN 'approved_auto' THEN 'APPROVED_AUTO'
    WHEN 'pending_manual_review' THEN 'PENDING_MANUAL_REVIEW'
    WHEN 'rejected' THEN 'REJECTED'
    WHEN 'completed' THEN 'COMPLETED'
    WHEN 'cancelled' THEN 'CANCELLED'
    ELSE status
END,
updated_at = NOW()
WHERE status IN (
    'requested',
    'signed',
    'failed',
    'failed_expired',
    'approved_auto',
    'pending_manual_review',
    'rejected',
    'completed',
    'cancelled'
);

ALTER TABLE IF EXISTS synapse_vault_withdrawals
DROP CONSTRAINT IF EXISTS synapse_vault_withdrawals_status_check;

ALTER TABLE IF EXISTS synapse_vault_withdrawals
ADD CONSTRAINT synapse_vault_withdrawals_status_check
CHECK (
    status IN (
        'REQUESTED',
        'SIGNED',
        'FAILED',
        'FAILED_EXPIRED',
        'APPROVED_AUTO',
        'PENDING_MANUAL_REVIEW',
        'REJECTED',
        'COMPLETED',
        'CANCELLED'
    )
) NOT VALID;

ALTER TABLE IF EXISTS synapse_vault_withdrawals
VALIDATE CONSTRAINT synapse_vault_withdrawals_status_check;
