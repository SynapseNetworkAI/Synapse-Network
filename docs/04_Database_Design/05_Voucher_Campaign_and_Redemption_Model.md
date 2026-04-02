# Voucher Campaign and Redemption Model

- Status: redeem core path live; admin issuance/history still pending
- Live code paths: `gateway/src/services/platform/finance_service.py`, `gateway/src/api/routers/balance.py`, `gateway/src/storage/postgres/repositories/finance_atomic_repository.py`, `docker-compose/postgres/init/gateway/001_synapse_schema.sql`
- Verified against current SQL baseline: 2026-04-02

This document defines how Synapse should model owner-level voucher redemption without breaking ledger truth, auditability, or idempotency.

## 1. Design Goals

We need a voucher model that guarantees:

1. one voucher code cannot be redeemed twice
2. redeemed credits flow into the existing owner balance model
3. every free-credit grant is auditable like real money movement
4. campaign-level finance exposure can be capped and reconciled

## 2. Core Design Decision

Voucher redemption is a ledger event, not a UI-only balance patch.

That means the redemption path must:

1. create a durable redemption record
2. produce a double-entry ledger movement
3. update `synapse_account_balances` in the same transaction

If we skip the ledger and mutate `available_balance` directly, the system loses financial truth immediately.

## 3. Required Schema Changes

### 3.1 Extend `synapse_ledger_accounts`

Current `account_kind` values do not include a promo funding source.

Add:

1. `platform_promo`

Why:

1. voucher grants need a debit-side funding account
2. `platform_revenue` cannot be reused because it models earned fees, not promo liability
3. `budget_hold` is runtime reservation state, not marketing funding

Live rule:

1. Gateway materializes one promo ledger account per campaign using `platform_promo::<campaign_id>`
2. redemption rows still keep `campaign_id` explicitly for audit and reconciliation

### 3.2 New table: `synapse_credit_voucher_campaigns`

Purpose:

1. defines issuance policy and finance guardrails for a batch of codes

Suggested columns:

```sql
CREATE TABLE synapse_credit_voucher_campaigns (
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
    CHECK (status IN ('draft', 'active', 'paused', 'expired', 'archived')),
    CHECK (allowlist_mode IN ('open', 'owner_allowlist'))
);
```

### 3.3 New table: `synapse_credit_voucher_codes`

Purpose:

1. stores individual code inventory
2. enforces one-time redeem semantics

Suggested columns:

```sql
CREATE TABLE synapse_credit_voucher_codes (
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
```

Storage rule:

1. never persist the raw voucher code after issuance/import
2. compare by normalized uppercase hash
3. keep `code_last4` only for support tooling and audit readability

### 3.4 New table: `synapse_credit_voucher_redemptions`

Purpose:

1. immutable business record for one redemption attempt/result

Suggested columns:

```sql
CREATE TABLE synapse_credit_voucher_redemptions (
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
    CHECK (status IN ('PENDING', 'COMPLETED', 'REVERSED', 'FAILED'))
);
```

### 3.5 New table: `synapse_credit_voucher_owner_allowlist`

Purpose:

1. restrict owner eligibility when a campaign runs in gated mode

```sql
CREATE TABLE synapse_credit_voucher_owner_allowlist (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    campaign_id TEXT NOT NULL REFERENCES synapse_credit_voucher_campaigns (campaign_id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL REFERENCES synapse_owner_accounts (owner_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id, owner_id)
);
```

## 4. Redemption Transaction Flow

Inside one database transaction:

1. normalize incoming voucher code to uppercase compact form
2. locate `synapse_credit_voucher_codes` by `code_hash`
3. `SELECT ... FOR UPDATE` on the code row
4. verify campaign is active and not expired
5. verify owner has not exceeded `max_redemptions_per_owner`
6. create `synapse_credit_voucher_redemptions`
7. create `synapse_ledger_entries` with:
   - `reference_type = 'voucher_redemption'`
   - `business_type = 'voucher_redeem'`
   - `debit_account_id = platform_promo::<campaign_id>`
   - `credit_account_id = owner consumer_wallet`
8. update `synapse_account_balances`
9. mark code row as `redeemed`
10. append finance audit row
11. commit

Anything less is not finance-grade.

## 5. Idempotency and Concurrency

The redemption path needs five guards:

1. `code_hash UNIQUE`
2. `voucher_code_id` locked `FOR UPDATE` during redeem
3. partial unique index on live redemption rows for `voucher_code_id`
4. partial unique index on `(owner_id, client_request_id)` for durable API replay
5. `request_hash` payload fingerprint to reject idempotency-key reuse with a different voucher payload

## 6. Recommended Indexes

```sql
CREATE INDEX idx_voucher_campaign_status_window
ON synapse_credit_voucher_campaigns (status, starts_at, expires_at);

CREATE INDEX idx_voucher_codes_campaign_status
ON synapse_credit_voucher_codes (campaign_id, status, redeemed_at DESC);

CREATE INDEX idx_voucher_redemptions_owner_created
ON synapse_credit_voucher_redemptions (owner_id, created_at DESC);

CREATE INDEX idx_voucher_redemptions_campaign_created
ON synapse_credit_voucher_redemptions (campaign_id, created_at DESC);

CREATE UNIQUE INDEX uq_voucher_redemptions_code_live
ON synapse_credit_voucher_redemptions (voucher_code_id)
WHERE status IN ('PENDING', 'COMPLETED', 'REVERSED');

CREATE UNIQUE INDEX uq_voucher_redemptions_owner_client_request
ON synapse_credit_voucher_redemptions (owner_id, client_request_id)
WHERE client_request_id IS NOT NULL
  AND status IN ('PENDING', 'COMPLETED', 'REVERSED');
```

## 7. Why Not Agent-Scoped

Voucher redemption must **not** attach to `agent_id` or `credential_id`.

Reasons:

1. the user expectation is account-level free credits
2. owner balance is the canonical spend surface in Credits
3. agent-scoped voucher rows would fragment balance truth across runtime identities
4. billing-cycle spend cap already operates at owner level, so voucher credit should land in the same scope

## 8. API Surface

Live today:

1. `POST /api/v1/balance/vouchers/redeem`

Still pending:

1. `GET /api/v1/balance/vouchers/redemptions`
2. admin-side campaign management

## 9. Reversal Strategy

If a voucher grant must be revoked:

1. create a reversal ledger entry
2. mark redemption status `REVERSED`
3. never directly edit the original ledger entry
4. never patch `available_balance` without a corresponding ledger reversal

That keeps audit and reconciliation intact.
