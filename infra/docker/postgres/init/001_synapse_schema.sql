-- Synapse Gateway PostgreSQL bootstrap schema
-- Executed automatically on first container initialization via docker-entrypoint-initdb.d

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'synapse_business_type') THEN
        CREATE TYPE synapse_business_type AS ENUM ('deposit', 'charge', 'refund', 'withdraw', 'freeze', 'unfreeze');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'synapse_risk_level') THEN
        CREATE TYPE synapse_risk_level AS ENUM ('green', 'yellow', 'red');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'synapse_withdraw_status') THEN
        CREATE TYPE synapse_withdraw_status AS ENUM ('REQUESTED', 'APPROVED_AUTO', 'PENDING_MANUAL_REVIEW', 'REJECTED', 'COMPLETED');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS synapse_audit_log (
    id BIGSERIAL PRIMARY KEY,
    action_type TEXT NOT NULL,
    business_type synapse_business_type NOT NULL DEFAULT 'charge',
    risk_level synapse_risk_level NOT NULL DEFAULT 'green',
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
    account_type TEXT NOT NULL,
    available_balance NUMERIC(36, 6) NOT NULL DEFAULT 0,
    pending_balance NUMERIC(36, 6) NOT NULL DEFAULT 0,
    frozen_balance NUMERIC(36, 6) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (owner_address, account_type),
    CHECK (account_type IN ('buyer', 'seller', 'platform_fee')),
    CHECK (available_balance >= 0),
    CHECK (pending_balance >= 0),
    CHECK (frozen_balance >= 0)
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_synapse_refund_intents_owner
ON synapse_refund_intents (lower(owner_address), created_at DESC);

CREATE TABLE IF NOT EXISTS synapse_withdrawal_intents (
    id TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    tx_hash TEXT,
    status synapse_withdraw_status NOT NULL DEFAULT 'REQUESTED',
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_synapse_withdrawal_intents_owner
ON synapse_withdrawal_intents (lower(owner_address), created_at DESC);

CREATE TABLE IF NOT EXISTS synapse_router_config (
    owner_address TEXT PRIMARY KEY,
    daily_limit_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    total_charge NUMERIC(36, 6),
    business_type synapse_business_type NOT NULL DEFAULT 'charge',
    risk_level synapse_risk_level NOT NULL DEFAULT 'green'
);

CREATE INDEX IF NOT EXISTS idx_synapse_usage_log_owner
ON synapse_usage_log (lower(buyer_address), lower(seller_address), ts DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_usage_log_request
ON synapse_usage_log (request_id);

CREATE TABLE IF NOT EXISTS synapse_processed_deposit_events (
    dedup_key TEXT PRIMARY KEY,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS synapse_service_registry (
    service_id TEXT PRIMARY KEY,
    record_id TEXT,
    owner_address TEXT NOT NULL,
    service_name TEXT NOT NULL,
    service_role TEXT NOT NULL DEFAULT 'Provider / Seller',
    service_address TEXT,
    summary TEXT,
    endpoint TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    pricing_amount NUMERIC(36, 6) NOT NULL DEFAULT 0,
    tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    auth_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    health_check_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    forwarding_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    metering_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    invoke_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    pricing_currency TEXT NOT NULL DEFAULT 'USDC',
    schema_version BIGINT NOT NULL DEFAULT 2,
    timeout_ms INTEGER NOT NULL DEFAULT 3000,
    max_qps INTEGER NOT NULL DEFAULT 50,
    max_request_bytes INTEGER NOT NULL DEFAULT 4096,
    max_response_bytes INTEGER NOT NULL DEFAULT 2048,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('active', 'inactive', 'archived')),
    CHECK (pricing_amount >= 0),
    CHECK (timeout_ms BETWEEN 300 AND 15000),
    CHECK (max_qps BETWEEN 1 AND 200),
    CHECK (max_request_bytes BETWEEN 256 AND 262144),
    CHECK (max_response_bytes BETWEEN 256 AND 1048576),
    CHECK (jsonb_typeof(tags_json) = 'array'),
    CHECK (jsonb_typeof(auth_json) = 'object'),
    CHECK (jsonb_typeof(health_check_json) = 'object'),
    CHECK (jsonb_typeof(forwarding_json) = 'object'),
    CHECK (jsonb_typeof(metering_json) = 'object'),
    CHECK (jsonb_typeof(invoke_config) = 'object')
);

ALTER TABLE synapse_service_registry ADD COLUMN IF NOT EXISTS record_id TEXT;
ALTER TABLE synapse_service_registry ADD COLUMN IF NOT EXISTS schema_version BIGINT;
ALTER TABLE synapse_service_registry ADD COLUMN IF NOT EXISTS service_role TEXT;
ALTER TABLE synapse_service_registry ADD COLUMN IF NOT EXISTS service_address TEXT;
ALTER TABLE synapse_service_registry ADD COLUMN IF NOT EXISTS tags_json JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE synapse_service_registry ADD COLUMN IF NOT EXISTS auth_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE synapse_service_registry ADD COLUMN IF NOT EXISTS health_check_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE synapse_service_registry ADD COLUMN IF NOT EXISTS forwarding_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE synapse_service_registry ADD COLUMN IF NOT EXISTS metering_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE synapse_service_registry ADD COLUMN IF NOT EXISTS invoke_config JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE synapse_service_registry ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE synapse_service_registry ALTER COLUMN pricing_amount SET DEFAULT 0;
ALTER TABLE synapse_service_registry ALTER COLUMN pricing_currency SET DEFAULT 'USDC';
ALTER TABLE synapse_service_registry ALTER COLUMN schema_version SET DEFAULT 2;
ALTER TABLE synapse_service_registry ALTER COLUMN timeout_ms SET DEFAULT 3000;
ALTER TABLE synapse_service_registry ALTER COLUMN max_qps SET DEFAULT 50;
ALTER TABLE synapse_service_registry ALTER COLUMN max_request_bytes SET DEFAULT 4096;
ALTER TABLE synapse_service_registry ALTER COLUMN max_response_bytes SET DEFAULT 2048;

CREATE INDEX IF NOT EXISTS idx_synapse_service_registry_owner
ON synapse_service_registry (lower(owner_address), updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_service_registry_active
ON synapse_service_registry (is_active, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_service_registry_tags_gin
ON synapse_service_registry USING GIN (tags_json);

CREATE INDEX IF NOT EXISTS idx_synapse_service_registry_invoke_gin
ON synapse_service_registry USING GIN (invoke_config);

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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_synapse_credentials_type_owner
ON synapse_credentials (credential_type, lower(owner_address), created_at DESC);

CREATE TABLE IF NOT EXISTS synapse_wallet_roles (
    wallet_address TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS synapse_auth_sessions (
    wallet_address TEXT PRIMARY KEY,
    registered_at BIGINT NOT NULL,
    last_login BIGINT NOT NULL,
    status TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS synapse_platform_fee_policy_default (
    singleton_id SMALLINT PRIMARY KEY,
    default_rate NUMERIC(10, 6) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_address, action)
);

-- Column comments (schema dictionary)
COMMENT ON COLUMN synapse_audit_log.id IS '审计日志主键ID';
COMMENT ON COLUMN synapse_audit_log.action_type IS '资金动作类型';
COMMENT ON COLUMN synapse_audit_log.business_type IS '标准资金业务类型枚举';
COMMENT ON COLUMN synapse_audit_log.risk_level IS '风控风险等级枚举';
COMMENT ON COLUMN synapse_audit_log.owner_address IS '资金归属钱包地址';
COMMENT ON COLUMN synapse_audit_log.actor IS '触发动作的执行者';
COMMENT ON COLUMN synapse_audit_log.request_id IS '请求追踪ID';
COMMENT ON COLUMN synapse_audit_log.tx_hash IS '链上交易哈希';
COMMENT ON COLUMN synapse_audit_log.amount_delta IS '本次资金变动值';
COMMENT ON COLUMN synapse_audit_log.before_balance IS '变动前余额';
COMMENT ON COLUMN synapse_audit_log.after_balance IS '变动后余额';
COMMENT ON COLUMN synapse_audit_log.result_status IS '动作执行结果状态';
COMMENT ON COLUMN synapse_audit_log.error_code IS '业务错误码';
COMMENT ON COLUMN synapse_audit_log.message IS '审计补充说明';
COMMENT ON COLUMN synapse_audit_log.created_at IS '记录创建时间';

COMMENT ON COLUMN synapse_deposit_dedup.tx_hash IS '充值去重主键: 交易哈希';
COMMENT ON COLUMN synapse_deposit_dedup.owner_address IS '充值归属钱包地址';
COMMENT ON COLUMN synapse_deposit_dedup.request_id IS '充值请求ID';
COMMENT ON COLUMN synapse_deposit_dedup.created_at IS '去重记录创建时间';

COMMENT ON COLUMN synapse_withdraw_tx_dedup.owner_address IS '提现/退款归属钱包地址';
COMMENT ON COLUMN synapse_withdraw_tx_dedup.tx_hash IS '提现/退款完成交易哈希';
COMMENT ON COLUMN synapse_withdraw_tx_dedup.kind IS '交易类型(提现或退款)';
COMMENT ON COLUMN synapse_withdraw_tx_dedup.created_at IS '去重记录创建时间';

COMMENT ON COLUMN synapse_balances.owner_address IS '余额归属钱包地址';
COMMENT ON COLUMN synapse_balances.account_type IS '账户余额类型(buyer/seller/platform_fee)';
COMMENT ON COLUMN synapse_balances.available_balance IS '可用余额(可扣费/可提现)';
COMMENT ON COLUMN synapse_balances.pending_balance IS '待确认余额(链上确认中/审核中)';
COMMENT ON COLUMN synapse_balances.frozen_balance IS '冻结余额(命中风控或人工冻结)';
COMMENT ON COLUMN synapse_balances.updated_at IS '更新时间（yyyy-MM-dd HH:mm:ss）';

COMMENT ON COLUMN synapse_deposit_intents.id IS '充值意图ID';
COMMENT ON COLUMN synapse_deposit_intents.owner_address IS '充值归属钱包地址';
COMMENT ON COLUMN synapse_deposit_intents.tx_hash IS '充值链上交易哈希';
COMMENT ON COLUMN synapse_deposit_intents.request_id IS '充值请求ID';
COMMENT ON COLUMN synapse_deposit_intents.buyer_address IS '买家钱包地址';
COMMENT ON COLUMN synapse_deposit_intents.amount_usdc IS '充值金额(USDC)';
COMMENT ON COLUMN synapse_deposit_intents.idempotency_key IS '幂等键';
COMMENT ON COLUMN synapse_deposit_intents.status IS '充值状态';
COMMENT ON COLUMN synapse_deposit_intents.created_at IS '创建时间（yyyy-MM-dd HH:mm:ss）';
COMMENT ON COLUMN synapse_deposit_intents.updated_at IS '更新时间（yyyy-MM-dd HH:mm:ss）';

COMMENT ON COLUMN synapse_refund_intents.id IS '退款意图ID';
COMMENT ON COLUMN synapse_refund_intents.owner_address IS '退款归属钱包地址';
COMMENT ON COLUMN synapse_refund_intents.tx_hash IS '退款链上交易哈希';
COMMENT ON COLUMN synapse_refund_intents.status IS '退款状态';
COMMENT ON COLUMN synapse_refund_intents.request_id IS '退款请求ID';
COMMENT ON COLUMN synapse_refund_intents.buyer_address IS '买家钱包地址';
COMMENT ON COLUMN synapse_refund_intents.amount_usdc IS '退款金额(USDC)';
COMMENT ON COLUMN synapse_refund_intents.idempotency_key IS '幂等键';
COMMENT ON COLUMN synapse_refund_intents.created_at IS '创建时间（yyyy-MM-dd HH:mm:ss）';
COMMENT ON COLUMN synapse_refund_intents.updated_at IS '更新时间（yyyy-MM-dd HH:mm:ss）';

COMMENT ON COLUMN synapse_withdrawal_intents.id IS '提现意图ID';
COMMENT ON COLUMN synapse_withdrawal_intents.owner_address IS '提现归属钱包地址';
COMMENT ON COLUMN synapse_withdrawal_intents.tx_hash IS '提现链上交易哈希';
COMMENT ON COLUMN synapse_withdrawal_intents.status IS '提现状态';
COMMENT ON COLUMN synapse_withdrawal_intents.request_id IS '提现请求ID';
COMMENT ON COLUMN synapse_withdrawal_intents.idempotency_key IS '幂等键';
COMMENT ON COLUMN synapse_withdrawal_intents.amount_usdc IS '提现金额(USDC)';
COMMENT ON COLUMN synapse_withdrawal_intents.amount_wei IS '提现金额(最小单位字符串)';
COMMENT ON COLUMN synapse_withdrawal_intents.fee_wei IS '提现手续费(最小单位字符串)';
COMMENT ON COLUMN synapse_withdrawal_intents.nonce IS '提现签名nonce';
COMMENT ON COLUMN synapse_withdrawal_intents.deadline IS '签名有效期截止时间';
COMMENT ON COLUMN synapse_withdrawal_intents.signature IS 'EIP-712签名';
COMMENT ON COLUMN synapse_withdrawal_intents.chain_id IS '链ID';
COMMENT ON COLUMN synapse_withdrawal_intents.contract_address IS '提现合约地址';
COMMENT ON COLUMN synapse_withdrawal_intents.signer_address IS '签名地址';
COMMENT ON COLUMN synapse_withdrawal_intents.created_at IS '创建时间（yyyy-MM-dd HH:mm:ss）';
COMMENT ON COLUMN synapse_withdrawal_intents.updated_at IS '更新时间（yyyy-MM-dd HH:mm:ss）';

COMMENT ON COLUMN synapse_router_config.owner_address IS '路由配置归属钱包地址';
COMMENT ON COLUMN synapse_router_config.daily_limit_usdc IS '每日限额(USDC)';
COMMENT ON COLUMN synapse_router_config.created_at IS '创建时间（yyyy-MM-dd HH:mm:ss）';
COMMENT ON COLUMN synapse_router_config.updated_at IS '更新时间（yyyy-MM-dd HH:mm:ss）';

COMMENT ON COLUMN synapse_usage_log.id IS '用量日志ID';
COMMENT ON COLUMN synapse_usage_log.ts IS '计费时间戳(毫秒)';
COMMENT ON COLUMN synapse_usage_log.request_id IS '请求ID';
COMMENT ON COLUMN synapse_usage_log.service_id IS '服务ID';
COMMENT ON COLUMN synapse_usage_log.buyer_address IS '买家钱包地址';
COMMENT ON COLUMN synapse_usage_log.seller_address IS '卖家钱包地址';
COMMENT ON COLUMN synapse_usage_log.status IS '调用状态';
COMMENT ON COLUMN synapse_usage_log.unit_price IS '服务单价';
COMMENT ON COLUMN synapse_usage_log.protocol_fee IS '协议手续费';
COMMENT ON COLUMN synapse_usage_log.routing_tax IS '路由税';
COMMENT ON COLUMN synapse_usage_log.total_charge IS '总扣费金额';
COMMENT ON COLUMN synapse_usage_log.business_type IS '资金业务类型枚举';
COMMENT ON COLUMN synapse_usage_log.risk_level IS '风控风险等级枚举';

COMMENT ON COLUMN synapse_processed_deposit_events.dedup_key IS '链上事件去重键';
COMMENT ON COLUMN synapse_processed_deposit_events.updated_at IS '更新时间戳(毫秒)';

COMMENT ON COLUMN synapse_service_registry.service_id IS '服务唯一ID';
COMMENT ON COLUMN synapse_service_registry.owner_address IS '服务拥有者钱包地址';
COMMENT ON COLUMN synapse_service_registry.service_name IS '服务名称';
COMMENT ON COLUMN synapse_service_registry.summary IS '服务简介';
COMMENT ON COLUMN synapse_service_registry.endpoint IS '服务主入口URL';
COMMENT ON COLUMN synapse_service_registry.status IS '服务状态';
COMMENT ON COLUMN synapse_service_registry.is_active IS '服务是否激活';
COMMENT ON COLUMN synapse_service_registry.pricing_amount IS '服务定价金额';
COMMENT ON COLUMN synapse_service_registry.pricing_currency IS '定价币种';
COMMENT ON COLUMN synapse_service_registry.timeout_ms IS '上游超时阈值(毫秒)';
COMMENT ON COLUMN synapse_service_registry.max_qps IS '最大QPS限制';
COMMENT ON COLUMN synapse_service_registry.max_request_bytes IS '最大请求体字节数';
COMMENT ON COLUMN synapse_service_registry.max_response_bytes IS '最大响应体字节数';
COMMENT ON COLUMN synapse_service_registry.record_id IS '服务记录ID(兼容前端编辑ID字段)';
COMMENT ON COLUMN synapse_service_registry.schema_version IS '服务清单Schema版本';
COMMENT ON COLUMN synapse_service_registry.service_role IS '服务角色';
COMMENT ON COLUMN synapse_service_registry.service_address IS '服务地址(兼容字段)';
COMMENT ON COLUMN synapse_service_registry.tags_json IS '服务标签JSON数组';
COMMENT ON COLUMN synapse_service_registry.auth_json IS '鉴权配置JSON';
COMMENT ON COLUMN synapse_service_registry.health_check_json IS '健康检查配置JSON';
COMMENT ON COLUMN synapse_service_registry.forwarding_json IS '转发策略JSON';
COMMENT ON COLUMN synapse_service_registry.metering_json IS '计费策略JSON';
COMMENT ON COLUMN synapse_service_registry.invoke_config IS '调用配置JSON';
COMMENT ON COLUMN synapse_service_registry.created_at IS '创建时间（yyyy-MM-dd HH:mm:ss）';
COMMENT ON COLUMN synapse_service_registry.updated_at IS '更新时间（yyyy-MM-dd HH:mm:ss）';

COMMENT ON COLUMN synapse_service_target_health.service_id IS '服务ID';
COMMENT ON COLUMN synapse_service_target_health.target_url IS '目标节点URL';
COMMENT ON COLUMN synapse_service_target_health.owner_address IS '节点归属钱包地址';
COMMENT ON COLUMN synapse_service_target_health.status IS '当前探活状态';
COMMENT ON COLUMN synapse_service_target_health.overall_status IS '聚合健康状态';
COMMENT ON COLUMN synapse_service_target_health.http_status IS '最近HTTP状态码';
COMMENT ON COLUMN synapse_service_target_health.latency_ms IS '最近延迟(毫秒)';
COMMENT ON COLUMN synapse_service_target_health.consecutive_successes IS '连续成功次数';
COMMENT ON COLUMN synapse_service_target_health.consecutive_failures IS '连续失败次数';
COMMENT ON COLUMN synapse_service_target_health.probe_url IS '探活URL';
COMMENT ON COLUMN synapse_service_target_health.last_checked_at IS '最近检查时间戳(毫秒)';
COMMENT ON COLUMN synapse_service_target_health.last_healthy_at IS '最近健康时间戳(毫秒)';
COMMENT ON COLUMN synapse_service_target_health.error IS '最近错误信息';
COMMENT ON COLUMN synapse_service_target_health.weight IS '负载权重';
COMMENT ON COLUMN synapse_service_target_health.region IS '节点区域';

COMMENT ON COLUMN synapse_service_target_health_history.id IS '健康历史主键ID';
COMMENT ON COLUMN synapse_service_target_health_history.service_id IS '服务ID';
COMMENT ON COLUMN synapse_service_target_health_history.owner_address IS '节点归属钱包地址';
COMMENT ON COLUMN synapse_service_target_health_history.target_url IS '目标节点URL';
COMMENT ON COLUMN synapse_service_target_health_history.status IS '本次探活状态';
COMMENT ON COLUMN synapse_service_target_health_history.http_status IS '本次HTTP状态码';
COMMENT ON COLUMN synapse_service_target_health_history.latency_ms IS '本次延迟(毫秒)';
COMMENT ON COLUMN synapse_service_target_health_history.probe_url IS '探活URL';
COMMENT ON COLUMN synapse_service_target_health_history.consecutive_successes IS '连续成功次数';
COMMENT ON COLUMN synapse_service_target_health_history.consecutive_failures IS '连续失败次数';
COMMENT ON COLUMN synapse_service_target_health_history.checked_at IS '检查时间戳(毫秒)';
COMMENT ON COLUMN synapse_service_target_health_history.last_healthy_at IS '最近健康时间戳(毫秒)';
COMMENT ON COLUMN synapse_service_target_health_history.error IS '错误信息';

COMMENT ON COLUMN synapse_credentials.id IS '凭据ID';
COMMENT ON COLUMN synapse_credentials.credential_type IS '凭据类型(API_KEY等)';
COMMENT ON COLUMN synapse_credentials.owner_address IS '凭据归属钱包地址';
COMMENT ON COLUMN synapse_credentials.name IS '凭据名称';
COMMENT ON COLUMN synapse_credentials.token_hash IS '凭据哈希值';
COMMENT ON COLUMN synapse_credentials.token_prefix IS '凭据前缀(用于展示)';
COMMENT ON COLUMN synapse_credentials.status IS '凭据状态';
COMMENT ON COLUMN synapse_credentials.max_calls IS '调用总额度';
COMMENT ON COLUMN synapse_credentials.calls_used IS '已使用调用次数';
COMMENT ON COLUMN synapse_credentials.rpm IS '每分钟请求上限';
COMMENT ON COLUMN synapse_credentials.credit_limit IS '信用额度';
COMMENT ON COLUMN synapse_credentials.reset_interval IS '额度重置周期';
COMMENT ON COLUMN synapse_credentials.expiration IS '过期时间戳(兼容字段)';
COMMENT ON COLUMN synapse_credentials.expires_at IS '过期时间戳(毫秒)';
COMMENT ON COLUMN synapse_credentials.created_at IS '创建时间（yyyy-MM-dd HH:mm:ss）';
COMMENT ON COLUMN synapse_credentials.updated_at IS '更新时间（yyyy-MM-dd HH:mm:ss）';
COMMENT ON COLUMN synapse_credentials.revoked_at IS '吊销时间（yyyy-MM-dd HH:mm:ss）';

COMMENT ON COLUMN synapse_wallet_roles.wallet_address IS '钱包地址';
COMMENT ON COLUMN synapse_wallet_roles.role IS '钱包角色';
COMMENT ON COLUMN synapse_wallet_roles.updated_at IS '更新时间（yyyy-MM-dd HH:mm:ss）';

COMMENT ON COLUMN synapse_auth_sessions.wallet_address IS '会话绑定钱包地址';
COMMENT ON COLUMN synapse_auth_sessions.registered_at IS '首次注册时间戳(秒)';
COMMENT ON COLUMN synapse_auth_sessions.last_login IS '最近登录时间戳(秒)';
COMMENT ON COLUMN synapse_auth_sessions.status IS '会话状态';
COMMENT ON COLUMN synapse_auth_sessions.updated_at IS '更新时间（yyyy-MM-dd HH:mm:ss）';

COMMENT ON COLUMN synapse_platform_fee_policy_default.singleton_id IS '单例配置ID';
COMMENT ON COLUMN synapse_platform_fee_policy_default.default_rate IS '默认平台费率';
COMMENT ON COLUMN synapse_platform_fee_policy_default.updated_at IS '更新时间（yyyy-MM-dd HH:mm:ss）';
COMMENT ON COLUMN synapse_platform_fee_policy_default.updated_by IS '最后更新操作者';

COMMENT ON COLUMN synapse_platform_fee_policy_owner.owner_address IS '费率归属钱包地址';
COMMENT ON COLUMN synapse_platform_fee_policy_owner.fee_rate IS '钱包级平台费率';

COMMENT ON COLUMN synapse_idempotency_keys.id IS '幂等记录ID';
COMMENT ON COLUMN synapse_idempotency_keys.scope IS '幂等作用域';
COMMENT ON COLUMN synapse_idempotency_keys.owner_address IS '归属钱包地址';
COMMENT ON COLUMN synapse_idempotency_keys.idempotency_key IS '幂等键';
COMMENT ON COLUMN synapse_idempotency_keys.request_hash IS '请求内容哈希';
COMMENT ON COLUMN synapse_idempotency_keys.response_code IS '响应状态码';
COMMENT ON COLUMN synapse_idempotency_keys.response_digest IS '响应摘要';
COMMENT ON COLUMN synapse_idempotency_keys.created_at IS '创建时间戳(毫秒)';
COMMENT ON COLUMN synapse_idempotency_keys.expires_at IS '过期时间戳(毫秒)';

COMMENT ON COLUMN synapse_finance_rate_limit.id IS '限流记录ID';
COMMENT ON COLUMN synapse_finance_rate_limit.owner_address IS '限流归属钱包地址';
COMMENT ON COLUMN synapse_finance_rate_limit.action IS '受限动作类型';
COMMENT ON COLUMN synapse_finance_rate_limit.window_start IS '窗口起始时间戳(毫秒)';
COMMENT ON COLUMN synapse_finance_rate_limit.count IS '窗口内请求计数';
COMMENT ON COLUMN synapse_finance_rate_limit.updated_at IS '更新时间（yyyy-MM-dd HH:mm:ss）';

-- Merged from 002_audit_dual_log_upgrade.sql
-- Keep synapse_audit_log as finance/risk audit source of truth,
-- and add a dedicated system activity log table for non-financial operations.
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
