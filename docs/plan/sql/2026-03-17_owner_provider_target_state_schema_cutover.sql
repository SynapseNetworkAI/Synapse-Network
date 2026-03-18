-- Target-state schema cutover for the Owner / Agent / Provider / Platform model.
--
-- IMPORTANT:
-- 1. This script is a cutover draft for the upcoming code refactor.
-- 2. Do NOT auto-apply this while runtime code and admin projection views still depend on:
--    - synapse_balances
--    - synapse_refund_intents
--    - synapse_withdrawal_intents
--    - synapse_usage_log
--    - synapse_service_registry
-- 3. Apply together with storage/service layer refactor and 003_gateway_admin_projection_views.sql rewrite.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Provider is a role of Owner, not a separate root account.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS synapse_provider_profiles (
    provider_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL UNIQUE REFERENCES synapse_owner_accounts (owner_id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('active', 'paused', 'archived'))
);

INSERT INTO synapse_provider_profiles (provider_id, owner_id, display_name, status, created_at, updated_at)
SELECT
    sp.seller_id,
    oa.owner_id,
    sp.display_name,
    CASE
        WHEN sp.status = 'active' THEN 'active'
        WHEN sp.status = 'paused' THEN 'paused'
        ELSE 'archived'
    END,
    sp.created_at,
    sp.updated_at
FROM synapse_seller_profiles AS sp
JOIN synapse_owner_accounts AS oa ON oa.owner_wallet = sp.owner_wallet
ON CONFLICT (provider_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS synapse_provider_payout_accounts (
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

INSERT INTO synapse_provider_payout_accounts (
    payout_account_id,
    provider_id,
    payout_address,
    chain_id,
    settlement_currency,
    status,
    created_at,
    updated_at
)
SELECT
    pa.payout_account_id,
    pa.seller_id,
    pa.payout_address,
    pa.chain_id,
    pa.settlement_currency,
    pa.status,
    pa.created_at,
    pa.updated_at
FROM synapse_payout_accounts AS pa
ON CONFLICT (payout_account_id) DO NOTHING;

ALTER TABLE synapse_service_manifests
ADD COLUMN IF NOT EXISTS owner_id TEXT,
ADD COLUMN IF NOT EXISTS provider_id TEXT;

UPDATE synapse_service_manifests AS sm
SET owner_id = oa.owner_id,
    provider_id = spp.provider_id
FROM synapse_seller_profiles AS sp
JOIN synapse_owner_accounts AS oa ON oa.owner_wallet = sp.owner_wallet
JOIN synapse_provider_profiles AS spp ON spp.owner_id = oa.owner_id
WHERE sm.seller_id = sp.seller_id
  AND (sm.owner_id IS NULL OR sm.provider_id IS NULL);

ALTER TABLE synapse_service_manifests
    DROP CONSTRAINT IF EXISTS synapse_service_manifests_owner_id_fkey,
    DROP CONSTRAINT IF EXISTS synapse_service_manifests_provider_id_fkey,
    ADD CONSTRAINT synapse_service_manifests_owner_id_fkey
        FOREIGN KEY (owner_id) REFERENCES synapse_owner_accounts (owner_id) ON DELETE RESTRICT,
    ADD CONSTRAINT synapse_service_manifests_provider_id_fkey
        FOREIGN KEY (provider_id) REFERENCES synapse_provider_profiles (provider_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_synapse_service_manifests_owner_id
ON synapse_service_manifests (owner_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_service_manifests_provider_id
ON synapse_service_manifests (provider_id, updated_at DESC);

-- -----------------------------------------------------------------------------
-- 2. Ledger buckets must separate consumer funds and provider receivables.
-- -----------------------------------------------------------------------------

ALTER TABLE synapse_ledger_accounts
ADD COLUMN IF NOT EXISTS provider_id TEXT;

UPDATE synapse_ledger_accounts AS la
SET provider_id = spp.provider_id
FROM synapse_seller_profiles AS sp
JOIN synapse_owner_accounts AS oa ON oa.owner_wallet = sp.owner_wallet
JOIN synapse_provider_profiles AS spp ON spp.owner_id = oa.owner_id
WHERE la.seller_id = sp.seller_id
  AND la.provider_id IS NULL;

ALTER TABLE synapse_ledger_accounts
    DROP CONSTRAINT IF EXISTS synapse_ledger_accounts_provider_id_fkey,
    ADD CONSTRAINT synapse_ledger_accounts_provider_id_fkey
        FOREIGN KEY (provider_id) REFERENCES synapse_provider_profiles (provider_id) ON DELETE SET NULL;

UPDATE synapse_ledger_accounts
SET account_kind = CASE account_kind
    WHEN 'owner_vault' THEN 'consumer_wallet'
    WHEN 'seller_receivable' THEN 'provider_wallet'
    WHEN 'platform_revenue' THEN 'platform_revenue'
    WHEN 'budget_hold' THEN 'budget_hold'
    ELSE account_kind
END;

ALTER TABLE synapse_ledger_accounts
    DROP CONSTRAINT IF EXISTS synapse_ledger_accounts_account_kind_check,
    ADD CONSTRAINT synapse_ledger_accounts_account_kind_check
    CHECK (account_kind IN ('consumer_wallet', 'provider_wallet', 'platform_revenue', 'budget_hold'));

COMMENT ON COLUMN synapse_ledger_accounts.account_kind IS
'consumer_wallet/provider_wallet/platform_revenue/budget_hold; use synapse_account_balances.available/pending/frozen to express spendable, pending, locked sub-buckets.';

-- -----------------------------------------------------------------------------
-- 3. Withdrawals must distinguish consumer refund vs provider withdrawal.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'synapse_withdrawal_kind') THEN
        CREATE TYPE synapse_withdrawal_kind AS ENUM ('consumer_refund', 'provider_withdrawal', 'platform_distribution');
    END IF;
END $$;

ALTER TABLE synapse_vault_withdrawals
ADD COLUMN IF NOT EXISTS withdrawal_kind synapse_withdrawal_kind,
ADD COLUMN IF NOT EXISTS source_account_id TEXT,
ADD COLUMN IF NOT EXISTS provider_id TEXT;

ALTER TABLE synapse_vault_withdrawals
    DROP CONSTRAINT IF EXISTS synapse_vault_withdrawals_source_account_id_fkey,
    DROP CONSTRAINT IF EXISTS synapse_vault_withdrawals_provider_id_fkey,
    ADD CONSTRAINT synapse_vault_withdrawals_source_account_id_fkey
        FOREIGN KEY (source_account_id) REFERENCES synapse_ledger_accounts (account_id) ON DELETE RESTRICT,
    ADD CONSTRAINT synapse_vault_withdrawals_provider_id_fkey
        FOREIGN KEY (provider_id) REFERENCES synapse_provider_profiles (provider_id) ON DELETE SET NULL;

UPDATE synapse_vault_withdrawals
SET withdrawal_kind = COALESCE(withdrawal_kind, 'consumer_refund');

ALTER TABLE synapse_vault_withdrawals
ALTER COLUMN withdrawal_kind SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_synapse_vault_withdrawals_kind_owner
ON synapse_vault_withdrawals (withdrawal_kind, owner_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 4. Owner-scoped finance summary should not depend on legacy role tables.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW synapse_owner_finance_summary AS
SELECT
    oa.owner_id,
    oa.owner_wallet,
    COALESCE(consumer_bal.available_balance, 0) AS spendable_balance_usdc,
    COALESCE(consumer_bal.pending_balance, 0) AS consumer_pending_usdc,
    COALESCE(consumer_bal.frozen_balance, 0) AS consumer_locked_usdc,
    COALESCE(provider_bal.available_balance, 0) AS provider_receivable_usdc,
    COALESCE(provider_bal.pending_balance, 0) AS provider_pending_usdc,
    COALESCE(provider_bal.frozen_balance, 0) AS provider_locked_usdc,
    COALESCE(platform_bal.available_balance, 0) AS platform_fee_usdc,
    GREATEST(
        COALESCE(consumer_bal.updated_at, TIMESTAMPTZ 'epoch'),
        COALESCE(provider_bal.updated_at, TIMESTAMPTZ 'epoch'),
        COALESCE(platform_bal.updated_at, TIMESTAMPTZ 'epoch')
    ) AS updated_at
FROM synapse_owner_accounts AS oa
LEFT JOIN synapse_ledger_accounts AS consumer_acc
    ON consumer_acc.owner_id = oa.owner_id AND consumer_acc.account_kind = 'consumer_wallet'
LEFT JOIN synapse_account_balances AS consumer_bal
    ON consumer_bal.account_id = consumer_acc.account_id
LEFT JOIN synapse_ledger_accounts AS provider_acc
    ON provider_acc.owner_id = oa.owner_id AND provider_acc.account_kind = 'provider_wallet'
LEFT JOIN synapse_account_balances AS provider_bal
    ON provider_bal.account_id = provider_acc.account_id
LEFT JOIN synapse_ledger_accounts AS platform_acc
    ON platform_acc.account_kind = 'platform_revenue'
LEFT JOIN synapse_account_balances AS platform_bal
    ON platform_bal.account_id = platform_acc.account_id;

COMMENT ON VIEW synapse_owner_finance_summary IS
'Target-state owner finance summary: one Owner identity, separate consumer and provider buckets.';

-- -----------------------------------------------------------------------------
-- 5. Legacy table retirement plan.
-- -----------------------------------------------------------------------------
-- Apply the following DROP statements only after runtime code, admin views, and data
-- backfill jobs have switched to the target-state tables and view above.
--
-- DROP VIEW IF EXISTS synapse_admin_dashboard_projection CASCADE;
-- DROP VIEW IF EXISTS synapse_admin_dashboard_finance_projection CASCADE;
-- DROP VIEW IF EXISTS synapse_admin_dashboard_activity_trend_projection CASCADE;
-- DROP VIEW IF EXISTS synapse_admin_dashboard_operations_projection CASCADE;
--
-- DROP TABLE IF EXISTS synapse_usage_log CASCADE;
-- DROP TABLE IF EXISTS synapse_balances CASCADE;
-- DROP TABLE IF EXISTS synapse_deposit_intents CASCADE;
-- DROP TABLE IF EXISTS synapse_refund_intents CASCADE;
-- DROP TABLE IF EXISTS synapse_withdrawal_intents CASCADE;
-- DROP TABLE IF EXISTS synapse_service_registry CASCADE;
-- DROP TABLE IF EXISTS synapse_credentials CASCADE;
-- DROP TABLE IF EXISTS synapse_wallet_roles CASCADE;
-- DROP TABLE IF EXISTS synapse_auth_sessions CASCADE;
-- DROP TABLE IF EXISTS synapse_platform_fee_policy_default CASCADE;
-- DROP TABLE IF EXISTS synapse_platform_fee_policy_owner CASCADE;
-- DROP TABLE IF EXISTS synapse_finance_rate_limit CASCADE;
-- DROP TABLE IF EXISTS synapse_audit_log CASCADE;
-- DROP TABLE IF EXISTS synapse_deposit_dedup CASCADE;
-- DROP TABLE IF EXISTS synapse_withdraw_tx_dedup CASCADE;
--
-- DROP TABLE IF EXISTS synapse_payout_accounts CASCADE;
-- DROP TABLE IF EXISTS synapse_seller_profiles CASCADE;

COMMIT;