-- Synapse Gateway audit hardening migration
-- Purpose:
-- 1) Keep synapse_audit_log as finance/risk audit source of truth.
-- 2) Add a dedicated system activity log table for non-financial operations.

ALTER TABLE IF EXISTS synapse_audit_log
    ADD COLUMN IF NOT EXISTS counterparty_address TEXT,
    ADD COLUMN IF NOT EXISTS direction TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT,
    ADD COLUMN IF NOT EXISTS risk_reason_code TEXT,
    ADD COLUMN IF NOT EXISTS ledger_id TEXT,
    ADD COLUMN IF NOT EXISTS trace_id TEXT,
    ADD COLUMN IF NOT EXISTS client_ip TEXT,
    ADD COLUMN IF NOT EXISTS user_agent TEXT;

CREATE INDEX IF NOT EXISTS idx_synapse_audit_log_request_id
ON synapse_audit_log (request_id);

CREATE INDEX IF NOT EXISTS idx_synapse_audit_log_tx_hash
ON synapse_audit_log (tx_hash);

CREATE TABLE IF NOT EXISTS synapse_system_activity_log (
    id BIGSERIAL PRIMARY KEY,
    action_type TEXT NOT NULL,
    owner_address TEXT NOT NULL,
    actor TEXT,
    request_id TEXT,
    trace_id TEXT,
    resource_type TEXT,
    resource_id TEXT,
    result_status TEXT,
    error_code TEXT,
    ip_address TEXT,
    user_agent TEXT,
    detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_synapse_system_activity_created_at
ON synapse_system_activity_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_system_activity_owner
ON synapse_system_activity_log (lower(owner_address), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_system_activity_action
ON synapse_system_activity_log (action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_system_activity_request_id
ON synapse_system_activity_log (request_id);
