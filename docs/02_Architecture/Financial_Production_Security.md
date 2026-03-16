# Financial Production Security Baseline (资金生产安全基线)

## 1. Scope

This document defines production-grade security controls for Synapse financial paths:

1. `/api/v1/balance*`
2. `/api/v1/refund` and `/api/v1/refunds`
3. `/api/v1/usage/logs`
4. `/api/v1/router/config`
5. `/api/v1/finance/audit-logs`

## 2. Completed Controls

### 2.1 Authentication and Owner Isolation

1. Financial APIs are session-required by default.
2. Owner scope is enforced from token subject context.
3. Cross-owner read/write is blocked by server-side filtering and owner-bound persistence.

### 2.2 Idempotency and Replay Protection

1. `POST /api/v1/balance/deposit/intent` and `POST /api/v1/refund` require `X-Idempotency-Key`.
2. Idempotency key reuse with different payload returns `409`.
3. Duplicate deposit `txHash` within replay window returns `409`.
4. Idempotency key cache has both TTL and max-row pruning to prevent unbounded growth.

### 2.3 Input Validation and Guardrails

1. Strict Pydantic request models for deposit, refund, and router config.
2. Numeric boundaries:
   - deposit amount must be `> 0`
   - refund amount must be `>= 10`
   - router daily limit must be within `[0, 10_000]`
3. List endpoints enforce bounded query limits.

Router daily limit definition:

1. `dailyLimitUsdc` is the maximum USDC spend an owner can route in one day.
2. `0` means spend is blocked for the day.

### 2.4 Auditability

1. Financial mutations append audit events to `audit_log`.
2. Audit details now include request context metadata:
   - `requestId` (from `X-Request-Id`)
   - `clientIp`
   - `userAgent`
3. Added owner-scoped financial audit API: `GET /api/v1/finance/audit-logs`.
4. Audit persistence now follows **one protocol + two physical tables**:
   - finance domain -> `synapse_audit_log`
   - system domain -> `synapse_system_activity_log`
5. Credential/service/session operations are written as system-domain audits to avoid polluting financial risk signals.

### 2.5 Third-Round Runtime Hardening

1. Owner-scoped write rate limit for finance mutation actions (per minute).
2. Current mutation actions covered:
   - `deposit_intent`
   - `refund_intent`
   - `router_config`
3. Rate-limit hits are audited as `FINANCE_RATE_LIMIT_HIT`.

### 2.6 Fourth-Round Distributed Controls

1. Finance idempotency store now uses Redis as primary backend when `REDIS_URL` is configured.
2. Finance write rate-limit now uses Redis distributed counters when `REDIS_URL` is configured.
3. Primary runtime persistence remains PostgreSQL when Redis is unavailable.
4. Added anomaly audit actions:
   - `DEPOSIT_REPLAY_DETECTED`
   - `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`

### 2.7 Fifth-Round Atomic Controls and Integration Tests

1. Redis Lua scripts are used for atomic idempotency-claim and finance write-rate counters.
2. API integration tests now cover full auth/session flow (challenge -> sign -> verify -> protected finance APIs).
3. CI now executes both unit-style financial security tests and API integration tests.

### 2.8 Sixth-Round Financial Mutation Locking

1. Financial mutation paths now use Redis-first distributed locks (`finance:mutation-lock:*`) to prevent cross-instance race conditions.
2. Locking scope is owner+action level (deposit/refund/router-config/provider-withdraw), reducing contention while preserving consistency.
3. When Redis is temporarily unavailable, process-local lock fallback is used to preserve availability without dropping safety checks.
4. Provider withdrawal completion now rejects txHash replay across different withdrawal intents for the same owner.

### 2.9 API Behavior (Contract)

1. `POST /api/v1/balance/deposit/intent`
   - requires `X-Idempotency-Key`
   - enforces owner write rate limit for `deposit_intent`
2. `POST /api/v1/refund`
   - requires `X-Idempotency-Key`
   - enforces owner write rate limit for `refund_intent`
   - `amountUsdc >= 10`
3. `POST /api/v1/router/config`
   - enforces owner write rate limit for `router_config`
   - `dailyLimitUsdc` in `[0, 10000]`
4. `GET /api/v1/finance/audit-logs`
   - returns owner-scoped finance actions only
   - supports `limit` in `1..500`

### 2.10 Seventh-Round Domain Service Decomposition

1. Financial service orchestration is split into explicit domains:
   - `BuyerFinanceService` (`src/services/buyer/finance_service.py`): deposit intent + refund intent paths.
   - `PlatformFinanceService` (`src/services/platform/finance_service.py`): owner-scoped balance read + router config paths.
   - `SellerWithdrawService` (`src/services/seller/withdraw_service.py`): provider withdrawal intent/completion paths.
2. `BalanceService` is now a thin orchestrator that delegates domain flows while retaining existing API contract.
3. Both domain services share the same Redis-first mutation lock manager and financial guard mixins, preserving cross-instance safety and idempotency guarantees.
4. Withdrawal signing hooks remain patchable via orchestrator delegation, keeping testability and operational override capability intact.

### 2.11 Eighth-Round Physical Service Isolation (Buyer / Platform / Seller)

1. Services are physically isolated by domain folders under `src/services/`:
   - `buyer/`: forwarding flow and buyer-side charging entry (`forwarding_service`, `forwarding_billing`, `forwarding_upstream`, `forwarding_validation`, `finance_service`).
   - `platform/`: platform orchestration and infrastructure service set (`balance_service`, `finance_service`, `credential_service`, `service_health_service`, `v2_indexer`).
   - `seller/`: seller onboarding, analytics, secret and withdrawal service set (`registry_service`, `manifest_parser_service`, `provider_analytics_service`, `secret_service`, `withdraw_service`).
2. API contracts are unchanged; only service-layer implementation paths are refactored for stronger maintainability and ownership boundaries.
3. Dependency direction follows domain boundaries:
   - buyer modules depend on platform primitives only when required (e.g., credential checks, health status).
   - seller modules depend on platform primitives only when required (e.g., health probes, shared credential helpers).
   - platform modules do not depend on buyer/seller business internals beyond explicit orchestration seams.
4. Unit and integration suites are updated to import domain paths directly, eliminating implicit root-level coupling.

### 2.12 Ninth-Round Balance Stratification and Withdrawal State Machine

1. PostgreSQL balance schema now uses stratified columns per account type (`available_balance`, `pending_balance`, `frozen_balance`) instead of a single amount bucket model.
2. Finance domain enum types are introduced at schema level:
   - `synapse_business_type`: `deposit|charge|refund|withdraw|freeze|unfreeze`
   - `synapse_risk_level`: `green|yellow|red`
   - `synapse_withdraw_status`: `REQUESTED|APPROVED_AUTO|PENDING_MANUAL_REVIEW|REJECTED|COMPLETED`
3. Provider withdrawal path now emits risk-aligned statuses:
   - auto-approved intents: `APPROVED_AUTO`
   - high-amount intents requiring manual review: `PENDING_MANUAL_REVIEW`
4. Legacy `PENDING` withdrawal rows are normalized to `REQUESTED` in repository compatibility layer.
5. Provider withdrawal intent creation is now executed in one PostgreSQL transaction with row-level lock:
   - lock seller balance row via `SELECT ... FOR UPDATE`
   - calculate rolling withdrawal amount in configured time window
   - calculate historical net income from successful usage settlements
   - evaluate high-risk seller tag (DB risk flag + env override)
   - apply red/yellow/green decision and write balance + withdrawal row + audit row atomically
6. Risk decision outcomes:
   - `red`: status persisted as `REJECTED`, API returns `403` + reason code
   - `yellow`: move `available -> frozen`, status `PENDING_MANUAL_REVIEW`
   - `green`: move `available -> pending`, status `APPROVED_AUTO`, sign and return EIP-712 ticket

### 2.13 Tenth-Round Deposit/Charge Transaction Hardening

1. Deposit registration now follows `PENDING_CONFIRMATION -> CONFIRMED`:
   - register intent: insert intent with DB-level txHash dedup and move buyer amount into `pending_balance`
   - confirm intent: move buyer `pending_balance -> available_balance` atomically and persist `CONFIRMED`
2. Deposit replay handling is dual-layer:
   - app layer replay window check (`txHash + owner`)
   - DB physical uniqueness (`synapse_deposit_dedup.tx_hash`) with integrity-error fallback to stable existing result
3. Charge settlement remains one atomic transaction:
   - debit buyer available
   - credit seller available
   - credit platform fee pool
   - persist usage ledger row + audit
4. Charge risk pre-check is enforced before balance mutation:
   - if buyer/seller `frozen_balance > 0` and account status is `restricted/suspended/blocked`, block with `403`

### 2.14 Eleventh-Round Refund Risk-Control Hardening

1. Refund creation now enforces strict origin traceability:
   - request must provide at least one of `originRequestId` or `originTxHash`
   - optional destination address must equal owner wallet (route-back only)
2. Refund amount is bounded by origin-settlement remaining capacity:
   - scan successful usage rows (`status in succeeded/success/completed/accepted`) for matching origin
   - compute `remaining = refundable_total - already_refunded_non_rejected`
   - reject when requested amount exceeds remaining
3. Refund intents now run a built-in risk classifier:
   - `green`: default `PENDING`
   - `yellow`: large amount (`>= 500 USDC`) or `MANUAL_APPEAL`, status `PENDING_MANUAL_REVIEW`
   - `red`: abnormal split pattern over same origin in 24h window, status `PENDING_MANUAL_REVIEW` + risk reason code
4. One-active-refund guard is upgraded to owner-level active statuses set:
   - active statuses include `PENDING` and `PENDING_MANUAL_REVIEW`
5. Manual-review completion contract:
   - `APPROVE`: allow completion and consume locked buyer funds
   - `REJECT`: release locked funds back to available and persist `REJECTED`
   - require reviewer metadata (`reviewerAddress`, optional `reviewerNote`) for manual-review rows
6. Auditing is expanded with refund risk and review attributes:
   - create logs include origin keys, risk level/reason, and remaining ceiling snapshot
   - complete/reject logs include reviewer decision metadata

### 2.15 Twelfth-Round Runtime State Typing and Legacy Channel Removal

1. Legacy collection passthrough channel (`get_collection/save_collection/append_to_collection`) is removed from production storage facade.
2. Indexer/backfill/reconciliation runtime checkpoints are moved to typed PostgreSQL state table:
   - `synapse_runtime_state(state_key, payload, updated_at)`
3. `GatewayStateRepository` becomes the single persistence entry for runtime scheduler state keys such as:
   - `deposit_backfill_state`
   - `deposit_reconciliation_state`
4. Error handling remains safe-surface:
   - API payload exposes standardized error codes only
   - detailed stack traces stay in server logs
5. Deposit consistency no longer relies on full-table snapshot rewrite:
   - `synapse_deposit_intents` must be written by row-level upsert / atomic mutation only, never `DELETE + INSERT` the full table
   - this prevents concurrent deposit registrations from being erased by indexer/backfill flushes
6. The consistency contract for `3 x 10 USDC = 30 USDC` is:
   - register phase: each on-chain `txHash` creates exactly one deposit intent and moves buyer amount into `pending_balance` atomically
   - confirm phase: each confirmed intent moves the exact same amount from `pending_balance -> available_balance` atomically
   - checkpoint phase: `deposit_backfill_state` / `deposit_reconciliation_state` only store scanner progress and alert state; they are not the source of fund truth
   - reconciliation phase: `chain vault balance` must equal `buyer available + buyer pending` within configured delta, otherwise emit reconciliation alert and run replay/backfill recovery
7. PostgreSQL schema contract is bootstrap-only, not runtime-self-healed:
   - repositories and domain rows assume the final `001_synapse_schema.sql` shape for `synapse_audit_log`, `synapse_system_activity_log`, `synapse_runtime_state`, and `synapse_service_registry`
   - startup code must validate schema presence only; it must not execute `ALTER TABLE` / `CREATE TABLE IF NOT EXISTS` as a compatibility patch path
   - when schema changes, update `domain + repositories + bootstrap SQL + tests` in the same iteration and recreate the database instead of carrying legacy fallback branches
8. Atomic deposit confirmation and indexer replay must have single-writer semantics for balances:
   - if `confirm_deposit_intent_atomic()` has already moved buyer funds from `pending_balance -> available_balance` inside PostgreSQL, indexer/backfill code must not persist an older in-memory `BalanceLedger` snapshot afterward
9. Long-running platform schedulers must live under `gateway/src/services/platform/tasks/`:
   - concrete task implementations (such as deposit indexer) should be拆分为 `chain / processing / backfill / reconciliation / runner` 等模块，避免单文件堆积 1000+ 行
   - `gateway/src/services/platform/v2_indexer.py` 仅保留兼容导出层，避免影响现有调用方
10. 运维日志必须覆盖充值索引关键动作:
   - 启动/停止日志要包含 listener 地址与轮询周期
   - backfill 日志要明确 `start_block / end_block / scanned / candidate_txs / recovered`
   - 入账日志要明确 `owner / tx_hash / event_key / amount_usdc / balance_after`
   - reconciliation 日志要明确 `chain_vault / ledger_obligation / delta / alert`
   - replay/backfill may update intent state and processed event keys, but must not overwrite fresh atomic balance mutations with stale cache snapshots
9. Confirmed deposit repair must be idempotent:
   - if a historical bug leaves an intent in `CONFIRMED` while buyer funds are still sitting in `pending_balance`, the atomic confirm path must repair `pending_balance -> available_balance` instead of short-circuiting forever
   - indexer periodic scan may re-enter `confirm_deposit_intent_atomic()` for `CONFIRMED` intents as a repair path, but it must not write any stale in-memory balance snapshot afterward
10. Block scan progress must be persisted in PostgreSQL, not memory only:
   - `deposit_backfill_state.lastScannedBlock` is the durable backfill cursor and is written into `synapse_runtime_state`
   - after service restart, `v2_indexer` must resume from `lastScannedBlock + 1`; if no cursor exists yet, it uses `V2_BACKFILL_START_BLOCK`, otherwise falls back to the latest confirmed window derived from `V2_BACKFILL_BLOCK_BATCH`
   - `get_indexer_status()` may expose the in-memory status snapshot, but the source of truth for restart recovery is still the database runtime state

## 3. Configuration Contract

Key runtime knobs in `gateway/src/core/config.py`:

1. `FINANCE_IDEMPOTENCY_TTL_SEC`
2. `FINANCE_IDEMPOTENCY_MAX_ROWS`
3. `FINANCE_REPLAY_WINDOW_SEC`
4. `FINANCE_WRITE_RATE_LIMIT_PER_MIN`
5. `JWT_SECRET` / `AUTH_SECRET` should be 32+ bytes for HS256 production safety.
6. `WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC`
7. `WITHDRAWAL_AUTO_24H_LIMIT_USDC`
8. `WITHDRAWAL_WINDOW_HOURS`
9. `WITHDRAWAL_HIGH_RISK_SELLER_ADDRESSES`

Default examples live in `gateway/.env.example`.

## 4. Remaining Work (Production TODO)

### 4.1 Stronger Distributed Guarantees

1. Add Postgres-backed durable idempotency records for long-term reconciliation.
2. Add crash-safe transaction boundaries for multi-step financial mutations.
3. Add cross-region cache consistency strategy for multi-dc deployments.

### 4.2 Security Verification and Tests

1. Financial security tests are added for replay, owner isolation, concurrency, and idempotency consistency.
2. API integration tests are added for real auth/session + protected finance endpoints.
3. CI blocking workflow is added on push/PR for the financial test suite.
4. Next: expand to storage-mode matrix tests (Redis on/off, failure injection).

### 4.3 Operational Controls

1. Alert rule baseline is defined for:
   - repeated `FINANCE_RATE_LIMIT_HIT`
   - replay rejection spikes (`DEPOSIT_REPLAY_DETECTED`)
   - idempotency mismatch spikes (`IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`)
2. Incident runbook is published at `doc/06_Developer_Guides/Financial_Security_Incident_Runbook.md`.
3. Next: connect alerts to production monitoring stack (Prometheus/Grafana or cloud APM).

### 4.4 Token and Session Hardening

1. Add token revocation path for compromised sessions.
2. Add optional short-lifetime session mode for high-risk operations.
3. Add stronger anti-automation controls on auth challenge endpoints when exposed publicly.

## 5. Non-Negotiable Rule

If release speed conflicts with fund safety, fund safety wins.
