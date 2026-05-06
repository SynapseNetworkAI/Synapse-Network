# E2E Regression Runbook

- Status: canonical
- Code paths: `package.json`, `scripts/`, `services/gateway/tests/e2e/`, `services/gateway/migrations/postgres/001_synapse_schema.sql`, `docs/reference/Validation_Entry_Points.md`
- Verified with: `npm run ci:docs`
- Last verified against code: 2026-05-03

This runbook is the canonical local and staging regression entrypoint for the
Synapse money path. A regression is not green until the API or UI E2E passes and
the SQL evidence layer proves that Postgres state matches the business result.

The core product invariant is simple: provider registration, consumer funding,
agent invocation, withdrawal review, on-chain claim, ledger, balances, audit,
notifications, and evidence must all tell the same story.

## 1. Regression Levels

| Level               | When to run                                                   | Environment    | Required result                                                               |
| ------------------- | ------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------- |
| L0 smoke            | After local restart or staging deploy                         | local, staging | Health, readiness, CORS, service ports, and public pages are reachable.       |
| L1 core flow        | Before closing runtime, frontend, SDK, or docs behavior work  | local          | Provider registers, consumer logs in, deposits, invokes, and sees balances.   |
| L2 money flow       | Before release approval or finance-sensitive merge            | local, staging | Consumer and provider withdrawals pass risk, review, claim, and SQL evidence. |
| L3 release evidence | Before staging release sign-off                               | staging        | Full-chain trace, Cloud SQL evidence, notifications, and reconciliation pass. |
| L4 contract release | Before contract address, ABI, signer, or chain config changes | local, staging | Contract dry-run, deployment evidence, and Gateway config alignment pass.     |
| L5 resilience       | Before production readiness or reliability-sensitive release  | local, staging | Load, backup/restore, alerting, and chaos/recovery evidence pass.             |

Production is not a destructive E2E target. Production regression is limited to
read-only health, public asset, monitoring, and evidence review unless a separate
production go/no-go plan explicitly authorizes a small-value rehearsal.

## 2. Service Fixture Policy

Local/staging invoke, billing, UI, withdrawal, and release E2E must reuse the
Synapse-Network-Provider catalog instead of creating random provider services or
starting a script-owned mock HTTP service as the business provider. Default paid
settlement service: `GATEWAY_E2E_SERVICE_ID=svc_synapse_mock_cost_1usdc`.

Canonical services:

1. `svc_synapse_echo` for free smoke.
2. `svc_synapse_mock_cost_1usdc` for paid settlement and balance evidence.
3. `svc_web3_sentiment_index`.
4. `svc_protocol_fundamental_brief`.
5. `svc_oss_security_healthcheck`.
6. `svc_deepseek_chat` for LLM/token-metered coverage only.

Gateway local/staging E2E does not cover service registration by mutating the
environment. `POST /api/v1/services` validation stays in backend unit, router,
and service tests. Synapse-Network-Provider onboarding owns registration or
update of the catalog services, and Gateway E2E fails closed when the catalog is
missing.

Before local/staging Gateway E2E, run Synapse-Network-Provider onboarding
`check`/`ensure` against the target Gateway so the catalog exists. Staging must
use already-approved staging catalog services and must not create fallback random
services during ordinary regression.

Provider withdrawal approval and one-ticket evidence are ordinary catalog
consumers: they discover `GATEWAY_E2E_SERVICE_ID`, invoke it enough times to
generate receivable evidence, and must not register `awa_provider_withdraw_*`,
`wot_provider_*`, or script-owned mock provider services.

If local E2E reports too many active test services, inspect and clean with:

```bash
LOCAL_DEV_CLEANUP_DRY_RUN=1 LOCAL_DEV_CLEANUP_OUTPUT=json \
  bash scripts/local/cleanup_service_registry_dev.sh

LOCAL_DEV_CLEANUP_CONFIRM=I_UNDERSTAND_THIS_MUTATES_LOCAL_DB \
  bash scripts/local/cleanup_service_registry_dev.sh
```

## 3. SQL Evidence Rules

Each money-path E2E must record enough identifiers to run SQL evidence:

1. `owner_id` and wallet address.
2. `provider_id` when a provider is involved.
3. `service_id` and `endpoint_id` for provider registration.
4. `tx_hash` for deposits and withdrawals.
5. `quote_id` and `invocation_id` for service calls.
6. `withdrawal_id` for consumer or provider withdrawals.
7. `account_id` for balance buckets when the E2E exposes it.

SQL evidence is read-only:

1. Use `LOCAL_GATEWAY_POSTGRES_DSN` locally, or the default local DSN from the
   Gateway E2E helpers:
   `postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway`.
2. Use an approved staging read-only DSN or Cloud SQL Auth Proxy connection for
   staging.
3. Set `PGOPTIONS='-c default_transaction_read_only=on'` for manual checks when
   possible.
4. Do not repair staging data during regression. If SQL evidence fails, stop and
   triage the product bug.
5. SQL snippets in this runbook are evidence queries, not seed or cleanup
   scripts.

Example local shell:

```bash
export REGRESSION_DSN="${LOCAL_GATEWAY_POSTGRES_DSN:-postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway}"
PGOPTIONS='-c default_transaction_read_only=on' psql "$REGRESSION_DSN"
```

Every SQL evidence block must include:

1. The E2E command that produced the state.
2. The SQL query.
3. Expected rows and statuses.
4. What failure means.
5. The owner for triage.

## 4. Local Regression Matrix

Run the narrowest relevant lane first. Escalate to the next lane when a change
touches more surfaces or when release confidence is required.

| Function point               | Local command                                                                                                                                                                                                                                                                                                  | SQL evidence                                                                                         | Pass criteria                                                                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment preflight        | `npm run dev:restart:all`, then `npm run dev:status`                                                                                                                                                                                                                                                           | None unless a service fails readiness                                                                | Gateway, Gateway-admin, user-front, admin-front, Postgres, and local chain are reachable.                                                                                         |
| Provider registration        | Gateway provider E2E files under `services/gateway/tests/e2e/test_05_provider_*.py`                                                                                                                                                                                                                            | Provider profile, payout account, service manifest, endpoint, health snapshot, search index          | Provider and service are active and discoverable.                                                                                                                                 |
| Consumer login               | `services/gateway/tests/e2e/test_02_wallet_auth.py` plus user-front full-chain when UI changed                                                                                                                                                                                                                 | Owner account, agent profile, credential, budget policy                                              | Owner is active, agent credential is active, budget policy exists.                                                                                                                |
| Consumer deposit             | `services/gateway/tests/e2e/test_03_fund_wallet.py`, `test_04_deposit.py`, and `npm run e2e:user-front-deposit-balance`                                                                                                                                                                                        | Deposit, balance, ledger/audit, Billing/Credits screenshots                                          | Pending deposits render `Pending`; only Gateway `CONFIRMED` deposits render `Completed`; available balance increased exactly once.                                                |
| Provider service invocation  | `SYNAPSE_AGENT_KEY=agt_xxx SERVICE_ID=svc_oss_security_healthcheck API_BASE=http://127.0.0.1:8000 python services/gateway/examples/agent_invoke_existing_service.py` or `cd services/gateway && GATEWAY_E2E_SERVICE_ID=svc_oss_security_healthcheck .venv/bin/python -m pytest tests/e2e/test_07_invoke.py -q` | Quote, invocation, budget event, ledger, audit, account balances                                     | Invocation is `SETTLED`; consumer debited; provider/platform credited; no random service is created.                                                                              |
| Invocation billing migration | `npm run e2e:invocation-billing-migration:local` and `npm run ci:invocation-billing-migration-local-evidence`                                                                                                                                                                                                  | Legacy `invocation_billing::%` KV, `synapse_invocation_billing`, ledger, audit, admin projection     | Legacy billing rows migrate without aggregate drift; new invokes dual-write typed and legacy billing during migration.                                                            |
| Analytics and admin views    | Gateway analytics E2E, `npm run e2e:admin-dashboard-projection-readmodel:local` plus `npm run ci:admin-dashboard-projection-readmodel-local-evidence`, and `npm run e2e:admin-front`                                                                                                                           | Analytics outbox, dashboard projection explicit-column SQL, Admin API, and admin-visible DB state    | Admin pages show the same state as Gateway DB, without `row_to_json` or dashboard projection `SELECT *` query paths.                                                              |
| Consumer withdrawal          | `services/gateway/tests/e2e/test_09_consumer_withdraw.py`, `npm run e2e:withdrawal-risk-policy`, and `npm run e2e:consumer-withdraw-claim-fullchain:local` with `npm run ci:consumer-withdraw-claim-fullchain-local-evidence` when manual review, claim-ready UI, or platform fee withdrawal evidence changed  | Withdrawal row, balance buckets, tx dedup, audit, wallet/vault/platform-fee chain evidence           | T+7 matured funds are required; active withdrawal locks funds; manual review approves into `REQUESTED + claimable=true`; user self-claim completes and fee-pool deltas reconcile. |
| Provider withdrawal          | `npm run dev:provider:onboard`, then `npm run e2e:admin-withdrawal-approval`, `npm run e2e:withdrawal-one-ticket-evidence`, `npm run e2e:withdrawal-idempotency-concurrency`, and `npm run e2e:provider-withdraw-mature:local`                                                                                 | Withdrawal row, provider account, tx dedup, audit, notifications, mature receivable formula          | T+7 matured receivable is required; review and ticket semantics are one-ticket safe; no `awa_provider_withdraw_*` or `wot_provider_*` service is created.                         |
| Unified money safety         | `npm run e2e:money-safety-concurrency:local` with `npm run ci:money-safety-concurrency-local-evidence`                                                                                                                                                                                                         | Aggregated deposit, consumer/provider withdraw, refund, invoke settlement, and platform fee evidence | All attack rows end in `blocked`, `idempotent-noop`, or `terminal-safe`; no duplicate ledger, no duplicate balance delta, no terminal rollback, and no unexplained vault drift.   |
| Notifications                | `npm run e2e:in-app-notifications`, transaction notification suites as needed                                                                                                                                                                                                                                  | Notification outbox, delivery log, in-app notifications                                              | Transactional notifications are present or deliberately suppressed.                                                                                                               |
| Load and reliability         | `npm run perf:local-production-load-rehearsal` and `npm run ci:local-production-load-evidence`                                                                                                                                                                                                                 | Reconciliation and no unexpected dead letters                                                        | Load evidence is green with no unexplained ledger/vault delta.                                                                                                                    |
| Contracts                    | `npm run ci:contracts`                                                                                                                                                                                                                                                                                         | Runtime state and config review only                                                                 | Solidity tests pass; Gateway contract config still matches expected local chain.                                                                                                  |

## 5. Staging Regression Matrix

Staging commands mutate Arbitrum Sepolia and Cloud SQL staging. Use only the
dedicated staging E2E wallets and confirmations documented in
`docs/ops/17_Staging_Environment_Configuration.md`.

The full-regression gate is the broad staging release smoke for the already
deployed app. It starts from
`https://staging.synapse-network.ai/dashboard/overview`, reuses the canonical
registered provider services, and refuses provider service creation. Every
screenshot must be captured after DOM/API/SQL checkpoints pass; screenshots
showing wallet gates, loading states, 401 overlays, or error pages are invalid
evidence.

| Function point               | Staging command                                                                                                   | SQL evidence                                                                                                          | Pass criteria                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Infra smoke                  | `npm run e2e:staging-smoke` and `npm run ci:staging-smoke-evidence`                                               | Optional health snapshot review                                                                                       | Public domains, Gateway, Gateway-admin, CORS, RPC, and contract bytecode pass.                                                                                     |
| Full regression              | `npm run e2e:staging-full-regression` and `npm run ci:staging-full-regression-evidence`                           | User-front DOM, Gateway API, Cloud SQL, chain config, invocation ledger                                               | Dashboard, billing, discovery, fixed invoke, LLM invoke, provider console, and admin read-only pages match staging DB evidence without creating provider services. |
| Invocation billing migration | `npm run e2e:invocation-billing-migration:staging` and `npm run ci:invocation-billing-migration-staging-evidence` | Legacy `invocation_billing::%` KV, `synapse_invocation_billing`, Admin finance/activity projection, invocation ledger | Staging billing projection migrates without total drift; fixed and LLM invokes dual-write typed + legacy billing and reconcile to zero.                            |
| Core money path              | `npm run e2e:staging-core-dogfood` and `npm run ci:staging-core-dogfood-evidence`                                 | Owner, provider, service, deposit, invocation, ledger, audit                                                          | Deposit, invoke, and balance state are correct in Cloud SQL.                                                                                                       |
| Gateway release chain        | `GATEWAY_RELEASE_E2E_PROFILE=mvp-postgres npm run release:evidence:gateway-fullchain:staging`                     | Full SQL evidence for deposit, invoke, withdrawal, reconciliation                                                     | Trace and report are non-empty and match Cloud SQL state.                                                                                                          |
| Withdrawal review            | `npm run e2e:withdrawal-review-dogfood:staging`                                                                   | Withdrawal rows, audit, admin notifications, tx dedup                                                                 | Consumer and provider review states are visible, actionable, and finalizable.                                                                                      |
| Notifications                | Staging Gmail, transaction, Lark, and GCP alert E2E suites as relevant                                            | Outbox, delivery log, in-app notifications                                                                            | Real staging notifications are delivered and evidence is sanitized.                                                                                                |
| Load/recovery                | `npm run perf:staging-load-suite`, `npm run drill:backup-restore:staging`                                         | Reconciliation evidence and restore report                                                                            | No unexplained Postgres ledger/vault delta; restore status is successful.                                                                                          |
| Contracts                    | `npm run deploy:contracts:arbitrum-sepolia:dry-run`, then release-approved deploy/evidence commands               | Runtime state/config plus contract evidence manifest                                                                  | Chain id, contract addresses, owner, signer, bytecode, and Gateway env agree.                                                                                      |

## 6. SQL Evidence Templates

Replace every `:placeholder` with identifiers from the E2E report. Do not guess
IDs from unrelated rows.

### 6.1 Owner, Agent, and Credential

Run after consumer login, agent creation, or SDK/MCP credential flows.

```sql
SELECT owner_id, owner_wallet, status, email_verified, created_at, updated_at
FROM synapse_owner_accounts
WHERE lower(owner_wallet) = lower(:owner_wallet);

SELECT agent_id, owner_id, name, status, runtime_label, created_at
FROM synapse_agent_profiles
WHERE owner_id = :owner_id
ORDER BY created_at DESC;

SELECT credential_id, agent_id, secret_prefix, status, issued_at, last_used_at
FROM synapse_agent_credentials
WHERE agent_id = :agent_id
ORDER BY issued_at DESC;

SELECT policy_id, credential_id, lifetime_cap_usdc, daily_cap_usdc,
       per_invocation_cap_usdc, rpm_limit, qps_limit
FROM synapse_budget_policies
WHERE credential_id = :credential_id;
```

Expected:

1. Owner row exists with `status='active'`.
2. Agent row exists with `status='active'`.
3. Credential row exists with `status='active'`.
4. Budget policy exists for the credential.

Failure usually means auth, owner bootstrap, credential issuance, or budget
bootstrap drift. Triage owner: Gateway runtime.

### 6.2 Provider Registration and Service Discovery

Run after provider onboarding and service registration.

```sql
SELECT provider_id, owner_id, display_name, status, created_at, updated_at
FROM synapse_provider_profiles
WHERE owner_id = :owner_id;

SELECT payout_account_id, provider_id, payout_address, chain_id,
       settlement_currency, status
FROM synapse_provider_payout_accounts
WHERE provider_id = :provider_id;

SELECT service_id, owner_id, provider_id, service_name, status, price_model,
       base_price_usdc, quote_required, settlement_currency
FROM synapse_service_manifests
WHERE provider_id = :provider_id
ORDER BY created_at DESC;

SELECT endpoint_id, service_id, endpoint_url, auth_mode, timeout_ms,
       is_primary, status
FROM synapse_service_endpoints
WHERE service_id = :service_id
ORDER BY is_primary DESC, updated_at DESC;

SELECT service_id, endpoint_id, health_score, p95_latency_ms,
       success_rate_24h, last_checked_at
FROM synapse_service_health_snapshots
WHERE service_id = :service_id;

SELECT service_id, tags_json, reliability_tier, health_score, updated_at
FROM synapse_service_search_index
WHERE service_id = :service_id;
```

Expected:

1. Provider profile exists with `status='active'`.
2. Payout account exists and is active when payout setup is part of the flow.
3. Service manifest exists with `status='active'`.
4. At least one endpoint is active.
5. Health score is present and high enough for the invoke router.
6. Search index row exists so discovery can find the service.

Failure usually means provider onboarding wrote only part of the service graph,
or health/search indexing drifted. Triage owner: Gateway runtime and provider
service.

### 6.3 Consumer Deposit

Run after on-chain deposit and Gateway deposit sync.

For User-front deposit/balance regressions, run
`npm run e2e:user-front-deposit-balance` followed by
`npm run ci:user-front-deposit-balance-evidence`. This gate captures
`billing-deposit-pending.png`, `credits-before-confirm.png`,
`deposit-input-ready.png`, `deposit-review.png`,
`deposit-review-preapproved.png`, `billing-deposit-completed.png`, and
`credits-after-confirm.png`; each screenshot is bound to DOM text plus SQL rows
in `screenshot-evidence.json`. Gateway `PENDING_CONFIRMATION` must display as
`Pending`, not `Completed`.

When changing the wallet transaction request UX, also run
`USER_FRONT_BASE_URL=http://localhost:3000 npm run ci:user-front-deposit-request-browser`.
This mock-wallet browser gate records screenshots under
`output/playwright/user-front-deposit-request/<timestamp>/` and verifies EN/ZH
copy, insufficient USDC/gas states, network switch/add-chain behavior,
allowance-first preapproval, Approve fallback, 4001 user rejection, and the
compact Review Deposit modal. Permit timeout is covered by the focused hook DOM
test because browser-level timer acceleration can interfere with wallet
connection fixtures. The review modal must show amount, wallet source, Synapse
Vault target, and Gateway confirmation copy; it must not expose token addresses
or long wallet/RPC internals by default.

### Copyable identifiers DOM regression

For User-front identifier-copy regressions, run
`USER_FRONT_BASE_URL=http://127.0.0.1:3000 npm run e2e:user-front-copyable-identifiers`
followed by `npm run ci:user-front-copyable-identifiers-evidence`. This
local-only gate uses deterministic Playwright route fixtures, does not create
provider services, and does not write Gateway DB state. It proves visible short
IDs, hashes, addresses, withdrawal IDs, nonce/ticket fields, and endpoint URLs
copy the full canonical value. It also fails if ordinary user-facing
invocation pages expose `agent:agent:*`, counterparty labels, provider wallet
addresses, auth blockers, loading pages, or unbound screenshots.

This gate is a DOM/clipboard/privacy regression. It does not replace
money-path SQL, ledger, audit, or chain evidence gates such as deposit balance,
invocation billing, or staging full regression.

### Payments Gateway-truth DOM/API/SQL regression

For User-front Billing / Payments history regressions, run
`USER_FRONT_BASE_URL=http://127.0.0.1:3000 npm run e2e:user-front-payments-gateway-truth:local`
followed by `npm run ci:user-front-payments-gateway-truth-local-evidence`.
This local-only gate seeds a dedicated local wallet, reads real Gateway deposit
intent, consumer withdrawal, and refund APIs with `limit=100`, queries
Postgres for the same owner, and verifies `/dashboard/billing` renders the
merged top 50 records after DOM/API/SQL checkpoints pass.

The gate exists to lock the hybrid Web3 boundary: Payments rows are Gateway
DB/API truth. Frontend chain logs such as `DepositInfo` and `WithdrawInfo` may
only support transient wallet feedback and must not create persistent Billing
rows or completed money states. It also fails if the historical
`WithdrawInfo.ticketHash`-as-amount regression reappears as a huge scientific
notation amount.

```sql
SELECT deposit_id, owner_id, owner_address, target_account_id, tx_hash,
       amount_usdc, status, block_number, request_id, updated_at
FROM synapse_vault_deposits
WHERE tx_hash = :tx_hash;

SELECT account_id, available_balance, pending_balance, frozen_balance, updated_at
FROM synapse_account_balances
WHERE account_id = :consumer_account_id;

SELECT reference_type, reference_id, business_type, debit_account_id,
       credit_account_id, amount_usdc, status, request_id, created_at
FROM synapse_ledger_entries
WHERE reference_id = :deposit_id
ORDER BY created_at;

SELECT event_type, business_type, owner_id, amount_delta, result_status,
       error_code, detail_json, created_at
FROM synapse_audit_events
WHERE owner_id = :owner_id
ORDER BY created_at DESC
LIMIT 20;

SELECT dedup_key, updated_at
FROM synapse_processed_deposit_events
WHERE dedup_key LIKE '%' || :tx_hash || '%'
ORDER BY updated_at DESC;
```

Expected:

1. Deposit row exists with `status='CONFIRMED'`.
2. `block_number` is present for chain-confirmed deposit evidence.
3. Consumer `available_balance` increased by the confirmed amount, minus any
   later spend in the same E2E.
4. Ledger entry exists for the deposit reference.
5. Audit event exists for the owner and references the deposit details.
6. Processed event dedup exists when the indexer path processed the receipt.
7. Before Gateway confirmation, `synapse_vault_deposits.status` is
   `PENDING_CONFIRMATION`, `pending_balance` increases, `available_balance`
   does not increase, and Billing shows `Pending`.
8. Replaying the same `tx_hash` or confirm callback does not create a second
   effective deposit row and does not increase `available_balance` twice.

Failure usually means deposit indexing, idempotency, ledger write, or audit
write drift. Triage owner: Gateway finance backend.

### 6.4 Invoke Settlement

Run after `discover_services -> invoke_and_pay -> get_receipt` or SDK invoke.

```sql
SELECT quote_id, service_id, credential_id, agent_id, quoted_price_usdc,
       price_model, status, expires_at, created_at
FROM synapse_service_quotes
WHERE quote_id = :quote_id;

SELECT invocation_id, quote_id, service_id, endpoint_id, credential_id,
       agent_id, idempotency_key, status, charged_usdc, error_code,
       upstream_status, started_at, finished_at, created_at
FROM synapse_invocations
WHERE invocation_id = :invocation_id;

SELECT event_id, policy_id, credential_id, quote_id, invocation_id,
       event_kind, amount_usdc, remaining_lifetime_usdc, remaining_daily_usdc
FROM synapse_budget_events
WHERE invocation_id = :invocation_id
ORDER BY created_at;

SELECT reference_type, reference_id, business_type, debit_account_id,
       credit_account_id, amount_usdc, status
FROM synapse_ledger_entries
WHERE reference_id = :invocation_id
ORDER BY created_at;

SELECT event_type, business_type, invocation_id, amount_delta, result_status,
       error_code, detail_json
FROM synapse_audit_events
WHERE invocation_id = :invocation_id
ORDER BY created_at;
```

Expected:

1. Quote exists and is `CONSUMED` when the flow uses quote rows.
2. Invocation exists with `status='SETTLED'` and `charged_usdc > 0` for a paid
   successful call.
3. Budget events prove reserve/capture/release behavior for the credential.
4. Ledger entries exist for consumer debit, provider credit, and platform fee
   when applicable.
5. Audit events exist and bind the invocation id.

Failure usually means idempotency, budget hold, settlement, or receipt drift.
Triage owner: Gateway runtime and finance backend.

### 6.5 Provider Revenue Balance

Run after a paid invocation that should credit the provider.

```sql
SELECT la.account_id, la.account_kind, la.owner_id, la.provider_id,
       ab.available_balance, ab.pending_balance, ab.frozen_balance, ab.updated_at
FROM synapse_ledger_accounts la
JOIN synapse_account_balances ab ON ab.account_id = la.account_id
WHERE la.provider_id = :provider_id
  AND la.account_kind = 'provider_wallet';

SELECT reference_type, reference_id, business_type, debit_account_id,
       credit_account_id, amount_usdc, status, created_at
FROM synapse_ledger_entries
WHERE reference_id = :invocation_id
  AND credit_account_id = :provider_account_id
ORDER BY created_at;
```

Expected:

1. Provider wallet account exists.
2. Provider available balance or receivable bucket reflects the provider net
   amount from the paid invocation.
3. Ledger reference points back to the invocation.

Failure usually means provider revenue split or ledger account routing drift.
Triage owner: Gateway finance backend.

### 6.6 Consumer Withdrawal

Run after consumer withdrawal creation, manual review, or completion. Consumer
withdrawals require T+7 matured funds. Available balance alone is not enough.
Local app startup disables maturity enforcement by default for development
speed; run policy E2E with `CONSUMER_WITHDRAW_MATURITY_ENFORCEMENT_ENABLED=true`
when validating this safety gate.

For the full local self-claim story, run:

```bash
npm run e2e:consumer-withdraw-claim-fullchain:local
npm run ci:consumer-withdraw-claim-fullchain-local-evidence
```

This lane proves the whole consumer path end to end:

1. deposit enters Gateway balance
2. withdrawal enters `PENDING_MANUAL_REVIEW`
3. admin approval transitions the row to `REQUESTED + claimable=true`
4. User-front changes from `审核中` to `待领取`
5. the consumer wallet executes `SynapseCore.withdraw(...)`
6. Gateway completes the row as `COMPLETED`
7. `platformFeePool` increases by the signed fee
8. local owner-only `withdrawPlatformFees(amount)` moves only the accrued fee to the platform wallet

```sql
SELECT withdrawal_id, owner_id, provider_id, source_account_id,
       withdrawal_kind, tx_hash, amount_usdc, status, request_id,
       ticket_id, ticket_hash, nonce, deadline, created_at, updated_at
FROM synapse_vault_withdrawals
WHERE withdrawal_id = :withdrawal_id
  AND withdrawal_kind = 'consumer_refund';

SELECT account_id, available_balance, pending_balance, frozen_balance, updated_at
FROM synapse_account_balances
WHERE account_id = :consumer_account_id;

SELECT owner_address, tx_hash, kind, created_at
FROM synapse_withdraw_tx_dedup
WHERE tx_hash = :tx_hash;

SELECT event_type, business_type, owner_id, amount_delta, result_status,
       error_code, detail_json, created_at
FROM synapse_audit_events
WHERE owner_id = :owner_id
  AND detail_json::text LIKE '%' || :withdrawal_id || '%'
ORDER BY created_at DESC;
```

Expected:

1. Before chain claim, active status is one of `REQUESTED`, `SIGNED`,
   `APPROVED_AUTO`, or `PENDING_MANUAL_REVIEW`.
2. Manual review paths move funds into `frozen_balance` or `pending_balance`
   according to the active state machine.
3. Completed withdrawal has `status='COMPLETED'` and a non-empty `tx_hash`.
4. `synapse_withdraw_tx_dedup` has exactly one row for the completion tx.
5. Audit events describe the withdrawal transition.

Failure usually means T+7 maturity, active withdrawal lock, ticket signing,
completion callback, or balance bucket drift. Triage owner: Gateway finance
backend and admin finance control plane.

### 6.7 Provider Withdrawal and Admin Review

Run after provider withdrawal request, admin approve/reject, and chain claim.
Provider earnings require T+7 matured receivables. Earned receivable is not
automatically withdrawable.

```sql
SELECT withdrawal_id, owner_id, provider_id, source_account_id,
       withdrawal_kind, tx_hash, amount_usdc, status, request_id,
       ticket_id, ticket_hash, nonce, deadline, created_at, updated_at
FROM synapse_vault_withdrawals
WHERE withdrawal_id = :withdrawal_id
  AND withdrawal_kind = 'provider_withdrawal';

SELECT account_id, available_balance, pending_balance, frozen_balance, updated_at
FROM synapse_account_balances
WHERE account_id = :provider_account_id;

SELECT owner_address, tx_hash, kind, created_at
FROM synapse_withdraw_tx_dedup
WHERE tx_hash = :tx_hash;

SELECT event_type, business_type, owner_id, provider_id, amount_delta,
       result_status, error_code, detail_json, created_at
FROM synapse_audit_events
WHERE provider_id = :provider_id
  AND detail_json::text LIKE '%' || :withdrawal_id || '%'
ORDER BY created_at DESC;

SELECT notification_id, recipient_type, recipient_owner_id, event_type,
       category, severity, priority, resource_type, resource_id, created_at
FROM synapse_in_app_notifications
WHERE resource_id = :withdrawal_id
ORDER BY created_at DESC;
```

Expected:

1. Withdrawal row exists with `withdrawal_kind='provider_withdrawal'`.
2. Large or risky withdrawals enter `PENDING_MANUAL_REVIEW` before approval.
3. Approved rows carry a ticket id/hash/signature when ticket issuance is part
   of the path.
4. Completed row has `status='COMPLETED'` and non-empty `tx_hash`.
5. Duplicate approval, duplicate complete, replay, and amount tampering do not
   create extra active withdrawal rows or duplicate tx dedup rows.
6. Admin notification and audit rows exist for reviewable paths.

Failure usually means T+7 maturity, admin review, one-ticket, idempotency, or
completion drift. Triage owner: Gateway finance backend, Gateway-admin, and
admin-front.

### 6.7.1 Provider Mature Receivable UX Evidence

Run when changing Provider withdraw balances, mature receivable formulas,
localized withdrawal copy, MAX behavior, or minimum-withdrawal UX.

DOM and screenshot evidence:

```bash
cd services/user-front && yarn test src/components/provider-workspace/ProviderWithdrawPage.test.tsx
USER_FRONT_BASE_URL=http://localhost:3000 npm run ci:provider-withdraw-mature-browser
```

Expected browser evidence:

1. `providerMatureReceivable=5.00` and `providerReceivable=50.00` renders
   `Withdrawable receivable 5.00 USDC`, `Receivable balance 50.00 USDC`, T+7
   notice, and a disabled `Generate & Claim` CTA with the localized minimum
   title.
2. `providerMatureReceivable=12.60` and `providerReceivable=50.00` renders an
   enabled CTA; the confirm button is disabled while the amount input is empty;
   clicking `MAX` fills `12.60` and enables confirm.
3. English and Chinese screenshots are saved under
   `output/playwright/provider-withdraw-mature/<timestamp>/`.
4. The page does not contain stale copy such as `Blank = full withdrawal`,
   `留空=全额`, `最多 2 位小数`, or `Max 2 decimals`.

Real local API plus SQL evidence:

```bash
PROVIDER_WITHDRAW_PROVIDER_WALLET=0x... \
PROVIDER_WITHDRAW_GATEWAY_BASE_URL=http://127.0.0.1:8000 \
LOCAL_GATEWAY_POSTGRES_DSN=postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway \
npm run e2e:provider-withdraw-mature:local
```

Start or restart local Gateway with
`PROVIDER_WITHDRAW_MATURITY_ENFORCEMENT_ENABLED=true` before this focused
maturity evidence gate; the ordinary local Gateway default is false.

Staging evidence is opt-in only and must use a read-only DSN or Cloud SQL Auth
Proxy connection:

```bash
SYNAPSE_E2E_ENV=staging \
PROVIDER_WITHDRAW_MATURE_CONFIRM=I_UNDERSTAND_THIS_MUTATES_STAGING \
PROVIDER_WITHDRAW_PROVIDER_WALLET=0x... \
PROVIDER_WITHDRAW_OWNER_JWT=<fresh owner JWT or equivalent test token> \
PROVIDER_WITHDRAW_POSTGRES_DSN=<read-only staging DSN via Cloud SQL Auth Proxy> \
npm run e2e:provider-withdraw-mature:staging
```

The evidence runner executes only read-only `SELECT` queries and forces
`default_transaction_read_only=on`. It writes `report.json` under
`output/e2e/provider-withdraw-mature/<timestamp>-<env>/`.

Resolve provider account:

```sql
SELECT owner_id, owner_wallet
FROM synapse_owner_accounts
WHERE lower(owner_wallet) = lower(:provider_wallet);

SELECT account_id, account_kind, owner_id
FROM synapse_ledger_accounts
WHERE account_id = 'provider_wallet::' || lower(:provider_wallet);
```

Expected:

1. One owner row exists.
2. Provider account id is `provider_wallet::<lower wallet>`.

Account bucket state:

```sql
SELECT account_id, available_balance, pending_balance, frozen_balance, updated_at
FROM synapse_account_balances
WHERE account_id = 'provider_wallet::' || lower(:provider_wallet);
```

Expected:

1. `available_balance` equals the UI secondary `Receivable balance` /
   `应收余额`.
2. `pending_balance` and `frozen_balance` are not negative.
3. The dust-disabled browser case does not create or mutate withdrawal rows.

Matured withdrawable formula:

```sql
WITH params AS (
  SELECT
    lower(:provider_wallet) AS provider_wallet,
    'provider_wallet::' || lower(:provider_wallet) AS provider_account_id,
    :maturity_seconds::integer AS maturity_seconds
),
matured_income AS (
  SELECT COALESCE(SUM(amount_usdc), 0) AS amount
  FROM synapse_ledger_entries, params
  WHERE credit_account_id = params.provider_account_id
    AND business_type = 'charge'
    AND status = 'posted'
    AND created_at <= NOW() - (params.maturity_seconds * INTERVAL '1 second')
),
active_withdrawals AS (
  SELECT COALESCE(SUM(amount_usdc), 0) AS amount
  FROM synapse_vault_withdrawals vw
  JOIN synapse_owner_accounts oa ON oa.owner_id = vw.owner_id
  JOIN params ON lower(oa.owner_wallet) = params.provider_wallet
  WHERE vw.withdrawal_kind = 'provider_withdrawal'
    AND vw.status NOT IN ('FAILED', 'FAILED_EXPIRED', 'REJECTED', 'CANCELLED')
)
SELECT
  matured_income.amount AS matured_income_usdc,
  active_withdrawals.amount AS active_withdraw_or_locked_usdc,
  GREATEST(matured_income.amount - active_withdrawals.amount, 0) AS provider_mature_receivable
FROM matured_income, active_withdrawals;
```

Expected:

1. `provider_mature_receivable` equals API
   `summary.providerMatureReceivable`.
2. UI `Withdrawable receivable` / `可提现额度` equals this value formatted to
   two decimals.

Withdrawal row after successful create:

```sql
SELECT withdrawal_id, owner_id, provider_id, source_account_id,
       withdrawal_kind, amount_usdc, status, ticket_id, ticket_hash,
       tx_hash, created_at, updated_at
FROM synapse_vault_withdrawals
WHERE withdrawal_kind = 'provider_withdrawal'
  AND owner_id = :owner_id
ORDER BY created_at DESC
LIMIT 5;
```

Expected:

1. Dust-disabled browser evidence creates no new row.
2. Matured-enough real E2E creates one latest row with
   `amount_usdc = MAX input amount` when `PROVIDER_WITHDRAW_EXPECT_AMOUNT_USDC`
   is provided.
3. Status is explainable: `APPROVED_AUTO`, `PENDING_MANUAL_REVIEW`, or final
   `COMPLETED`, depending on the path.

Audit evidence:

```sql
SELECT event_type, business_type, owner_id, provider_id,
       amount_delta, result_status, error_code, detail_json, created_at
FROM synapse_audit_events
WHERE owner_id = :owner_id
  AND detail_json::text LIKE '%' || :withdrawal_id || '%'
ORDER BY created_at DESC;
```

Expected:

1. Successful withdrawal intent has an audit row.
2. Rejected mature/dust server tests produce a structured error code, not raw
   exception text.
3. No evidence query mutates data.

### 6.8 Notifications and Outboxes

Run after deposit, invoke, withdrawal, support, Lark, Gmail, or in-app
notification E2E.

```sql
SELECT notification_id, dedupe_key, event_type, recipient_email,
       recipient_owner_id, priority, template_key, status, attempt_count,
       last_error, created_at, updated_at
FROM synapse_notification_outbox
WHERE created_at >= NOW() - INTERVAL '2 hours'
ORDER BY created_at DESC
LIMIT 50;

SELECT notification_id, dedupe_key, event_type, recipient_email,
       recipient_owner_id, priority, message_id, sent_at
FROM synapse_notification_delivery_log
WHERE sent_at >= NOW() - INTERVAL '2 hours'
ORDER BY sent_at DESC
LIMIT 50;

SELECT notification_id, recipient_type, recipient_owner_id, event_type,
       category, severity, priority, title, resource_type, resource_id,
       created_at, read_at
FROM synapse_in_app_notifications
WHERE created_at >= NOW() - INTERVAL '2 hours'
ORDER BY created_at DESC
LIMIT 50;
```

Expected:

1. Transactional events produce in-app rows or documented suppressed events.
2. Email outbox rows are delivered, retrying, or deliberately suppressed.
3. There are no unexplained `dead_letter` rows for the test window.

Failure usually means after-commit notification write drift, outbox delivery
failure, template drift, or unsafe blocking notification behavior. Triage owner:
Gateway notifications and frontend.

### 6.9 Analytics Outbox

Run after analytics, admin dashboard, or release full-chain flows.

```sql
SELECT event_id, event_name, event_key, status, attempt_count,
       last_error, created_at, updated_at
FROM synapse_analytics_outbox
WHERE created_at >= NOW() - INTERVAL '2 hours'
ORDER BY created_at DESC
LIMIT 100;

SELECT status, COUNT(*) AS rows
FROM synapse_analytics_outbox
WHERE created_at >= NOW() - INTERVAL '2 hours'
GROUP BY status
ORDER BY status;
```

Expected:

1. Expected business events appear for deposit, invoke, provider revenue, and
   withdrawal paths.
2. `dead_letter` count is zero unless the E2E explicitly tests failure routing.
3. `retry` rows have explainable transient errors.

Failure usually means analytics outbox drift or ClickHouse transport drift.
Triage owner: Gateway analytics and admin analytics.

### 6.9.1 Admin Dashboard Projection Read Models

Run after Gateway-admin dashboard projection repositories, Admin-front
overview/finance/runtime pages, or dashboard projection views change.

```bash
SYNAPSE_E2E_ENV=local ALLOW_GCP_SECRET_MANAGER=0 \
  npm run e2e:admin-dashboard-projection-readmodel:local

npm run ci:admin-dashboard-projection-readmodel-local-evidence
```

The evidence bundle must include Admin API responses, explicit Postgres
projection column SQL evidence, DOM checkpoints, and screenshots for
`/dashboard/overview`, `/finance`, and `/dashboard/runtime`.

Expected:

1. Admin API dashboard endpoints return `2xx` and no projection type errors.
2. SQL evidence does not contain `row_to_json` or dashboard projection
   `SELECT *`.
3. Money, count, date, status, and timestamp values match across SQL, Admin API,
   and Admin-front DOM.
4. Screenshots are captured only after DOM/API/SQL checkpoints pass and are not
   login, loading, blank, or error pages.

Failure usually means the dashboard read-model repository is flattening native
Postgres types, a projection view is missing canonical columns, or Admin-front
is rendering stale API fields. Triage owner: Gateway-admin dashboard analytics.

### 6.10 Contract Deployment and Runtime Config

Run after contract deployment dry-run, staging deployment, or signer/ABI/address
changes.

```sql
SELECT state_key, payload, updated_at
FROM synapse_runtime_state
WHERE state_key ILIKE '%contract%'
   OR state_key ILIKE '%chain%'
   OR state_key ILIKE '%signer%'
ORDER BY updated_at DESC;

SELECT singleton_id, default_rate, updated_at, updated_by
FROM synapse_platform_fee_policy_default
WHERE singleton_id = 1;

SELECT owner_address, fee_rate, updated_at
FROM synapse_platform_fee_policy_owner
ORDER BY updated_at DESC
LIMIT 20;
```

Expected:

1. Runtime state and deployment evidence agree on chain id, SynapseCore address,
   USDC address, owner, and withdrawal signer when those values are mirrored in
   DB or evidence.
2. Fee policy rows remain valid and non-negative.
3. Any contract modification is followed by deposit, invoke, consumer
   withdrawal, and provider withdrawal regression.

Failure usually means chain config drift, signer mismatch, ABI/address drift, or
fee policy drift. Triage owner: contracts and Gateway deployment.

## 7. Cross-Flow Invariant Queries

Run these after any full money-path regression.

```sql
SELECT account_id, available_balance, pending_balance, frozen_balance
FROM synapse_account_balances
WHERE available_balance < 0
   OR pending_balance < 0
   OR frozen_balance < 0;
```

Expected: zero rows. Any row is a stop-the-line finance bug.

```sql
SELECT owner_id, withdrawal_kind, COUNT(*) AS active_rows
FROM synapse_vault_withdrawals
WHERE status IN ('REQUESTED', 'SIGNED', 'APPROVED_AUTO', 'PENDING_MANUAL_REVIEW')
GROUP BY owner_id, withdrawal_kind
HAVING COUNT(*) > 1;
```

Expected: zero rows unless a future product policy explicitly supports multiple
active withdrawals per owner and kind.

```sql
SELECT reference_type, reference_id, debit_account_id, credit_account_id,
       COUNT(*) AS duplicate_rows
FROM synapse_ledger_entries
GROUP BY reference_type, reference_id, debit_account_id, credit_account_id
HAVING COUNT(*) > 1;
```

Expected: zero rows. Duplicate rows mean ledger idempotency drift.

```sql
SELECT status, COUNT(*) AS rows
FROM synapse_vault_withdrawals
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY status
ORDER BY status;
```

Expected: active and terminal status counts match the E2E run report. Unknown
growth in `FAILED`, `FAILED_EXPIRED`, or `PENDING_MANUAL_REVIEW` requires
triage.

## 8. Contract Regression

### 8.1 Local

Run:

```bash
npm run ci:contracts
```

SQL evidence is limited to Gateway runtime/config review unless the local E2E
also mutates Postgres. The contract gate must prove:

1. SynapseCore deploys.
2. USDC custody and withdrawal ticket semantics hold.
3. Tickets are single-use.
4. Platform fee withdrawal is bounded by accrued fees.
5. ABI changes do not silently break Gateway or frontend assumptions.

### 8.2 Staging Dry-Run and Deploy

Dry-run before any staging contract change:

```bash
npm run staging:arb-sepolia:wallets:status
npm run deploy:contracts:arbitrum-sepolia:dry-run
```

Deploy only after explicit release approval:

```bash
npm run deploy:contracts:arbitrum-sepolia
npm run verify:contracts:arbitrum-sepolia:evidence
npm run ci:contract-deployment-evidence
```

After any deployed contract address, ABI, chain id, owner, USDC, or withdrawal
signer change, rerun:

1. Deposit regression.
2. Invoke settlement regression.
3. Consumer withdrawal regression.
4. Provider withdrawal and admin review regression.
5. Staging smoke and release evidence gates.

### 8.3 Hardware Wallet Migration Readiness

Hardware wallet migration is a manual gated release path until the signer
integration exists. The regression evidence must include:

1. Signer address derivation proof.
2. Device or policy owner approval.
3. Dry-run evidence using the intended signer path.
4. Contract deployment manifest and verification output.
5. Post-deploy deposit, invoke, and withdrawal SQL evidence.

Do not put hardware wallet seeds, private keys, screenshots with secrets, or
raw signing material into the repository.

## 9. Release Acceptance

A full regression is green only when:

1. API and UI E2E commands pass.
2. SQL evidence queries return expected rows.
3. `synapse_account_balances` has no negative buckets.
4. Deposits have deposit, balance, ledger, audit, and processed-event evidence.
5. Invocations have quote, invocation, budget, ledger, and audit evidence.
6. Withdrawals have one active/ticket lifecycle, terminal status, tx dedup, and
   audit evidence.
7. Provider earnings and consumer funds respect T+7 maturity windows.
8. Notification and analytics outboxes have no unexplained dead letters.
9. Contract evidence agrees with Gateway runtime configuration.
10. Staging failures are triaged as product bugs, not repaired by ad hoc SQL.

## 10. Validation for This Runbook

When changing this runbook:

```bash
npm run ci:docs
npm run ci:agent-lessons
npm run ci:format-check
```

Manual review checklist:

1. Every table named here exists in
   `services/gateway/migrations/postgres/001_synapse_schema.sql`.
2. SQL snippets are read-only evidence queries.
3. New E2E commands exist in `package.json` or are explicit Gateway pytest
   files.
4. Local and staging instructions do not share secrets or wallet keys.
5. Any behavior change in money flow also updates the finance and database
   reference docs.
