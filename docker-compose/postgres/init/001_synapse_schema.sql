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

-- Optional seed row to keep non-empty baseline (safe no-op for runtime).
INSERT INTO synapse_collections (collection_name, payload, updated_at)
VALUES ('router_config', '{"rows": [], "updatedAt": 0}'::jsonb, NOW())
ON CONFLICT (collection_name) DO NOTHING;
