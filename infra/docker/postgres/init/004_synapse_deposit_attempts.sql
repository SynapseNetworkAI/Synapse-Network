-- Buyer deposit attempt funnel tracking.

CREATE TABLE IF NOT EXISTS synapse_deposit_attempts (
    id BIGSERIAL PRIMARY KEY,
    attempt_id TEXT NOT NULL,
    owner_address TEXT NOT NULL,
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
    CHECK (stage IN (
        'SIGN_REQUESTED',
        'TX_BROADCASTED',
        'RECEIPT_FAILED',
        'RECEIPT_CONFIRMED',
        'INTENT_REGISTERED'
    )),
    UNIQUE (attempt_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_synapse_deposit_attempts_owner
ON synapse_deposit_attempts (lower(owner_address), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_deposit_attempts_tx_hash
ON synapse_deposit_attempts (tx_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_deposit_attempts_stage
ON synapse_deposit_attempts (stage, created_at DESC);

COMMENT ON COLUMN synapse_deposit_attempts.id IS '充值尝试主键ID';
COMMENT ON COLUMN synapse_deposit_attempts.attempt_id IS '前端单次充值尝试ID，用于串联各阶段';
COMMENT ON COLUMN synapse_deposit_attempts.owner_address IS '尝试归属钱包地址';
COMMENT ON COLUMN synapse_deposit_attempts.client_request_id IS '前端请求关联ID';
COMMENT ON COLUMN synapse_deposit_attempts.tx_hash IS '链上交易哈希（若已广播）';
COMMENT ON COLUMN synapse_deposit_attempts.amount_usdc IS '尝试充值金额(USDC)';
COMMENT ON COLUMN synapse_deposit_attempts.stage IS '尝试阶段';
COMMENT ON COLUMN synapse_deposit_attempts.failure_reason IS '失败原因（若该阶段失败）';
COMMENT ON COLUMN synapse_deposit_attempts.request_id IS '网关请求追踪ID';
COMMENT ON COLUMN synapse_deposit_attempts.client_ip IS '客户端IP';
COMMENT ON COLUMN synapse_deposit_attempts.user_agent IS '客户端User-Agent';
COMMENT ON COLUMN synapse_deposit_attempts.created_at IS '创建时间';
COMMENT ON COLUMN synapse_deposit_attempts.updated_at IS '更新时间';