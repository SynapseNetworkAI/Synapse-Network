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
3. JSON storage remains as fallback when Redis is unavailable.
4. Added anomaly audit actions:
   - `DEPOSIT_REPLAY_DETECTED`
   - `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`

### 2.7 Fifth-Round Atomic Controls and Integration Tests

1. Redis Lua scripts are used for atomic idempotency-claim and finance write-rate counters.
2. API integration tests now cover full auth/session flow (challenge -> sign -> verify -> protected finance APIs).
3. CI now executes both unit-style financial security tests and API integration tests.

### 2.8 API Behavior (Contract)

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

## 3. Configuration Contract

Key runtime knobs in `python_sdk/seller_api/src/core/config.py`:

1. `FINANCE_IDEMPOTENCY_TTL_SEC`
2. `FINANCE_IDEMPOTENCY_MAX_ROWS`
3. `FINANCE_REPLAY_WINDOW_SEC`
4. `FINANCE_WRITE_RATE_LIMIT_PER_MIN`
5. `JWT_SECRET` / `AUTH_SECRET` should be 32+ bytes for HS256 production safety.

Default examples live in `python_sdk/.env.example`.

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
