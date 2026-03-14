# Financial Production Security Baseline (资金生产安全基线)

## 1. Scope

This document defines production-grade security controls for Synapse financial paths:

1. `/api/v2/balance*`
2. `/api/v2/refund` and `/api/v2/refunds`
3. `/api/v2/usage/logs`
4. `/api/v2/router/config`
5. `/api/v2/finance/audit-logs`

## 2. Completed Controls

### 2.1 Authentication and Owner Isolation

1. Financial APIs are session-required by default.
2. Owner scope is enforced from token subject context.
3. Cross-owner read/write is blocked by server-side filtering and owner-bound persistence.

### 2.2 Idempotency and Replay Protection

1. `POST /api/v2/balance/deposit/intent` and `POST /api/v2/refund` require `X-Idempotency-Key`.
2. Idempotency key reuse with different payload returns `409`.
3. Duplicate deposit `txHash` within replay window returns `409`.
4. Idempotency key cache has both TTL and max-row pruning to prevent unbounded growth.

### 2.3 Input Validation and Guardrails

1. Strict Pydantic request models for deposit, refund, and router config.
2. Numeric boundaries:
   - deposit amount must be `> 0`
   - refund amount must be `>= 0`
   - router daily limit must be within `[0, 1_000_000_000]`
3. List endpoints enforce bounded query limits.

### 2.4 Auditability

1. Financial mutations append audit events to `audit_log`.
2. Audit details now include request context metadata:
   - `requestId` (from `X-Request-Id`)
   - `clientIp`
   - `userAgent`
3. Added owner-scoped financial audit API: `GET /api/v2/finance/audit-logs`.

### 2.5 Third-Round Runtime Hardening

1. Owner-scoped write rate limit for finance mutation actions (per minute).
2. Current mutation actions covered:
   - `deposit_intent`
   - `refund_intent`
   - `router_config`
3. Rate-limit hits are audited as `FINANCE_RATE_LIMIT_HIT`.

### 2.6 Third-Round API Behavior (Contract)

1. `POST /api/v2/balance/deposit/intent`
   - requires `X-Idempotency-Key`
   - enforces owner write rate limit for `deposit_intent`
2. `POST /api/v2/refund`
   - requires `X-Idempotency-Key`
   - enforces owner write rate limit for `refund_intent`
3. `POST /api/v2/router/config`
   - enforces owner write rate limit for `router_config`
4. `GET /api/v2/finance/audit-logs`
   - returns owner-scoped finance actions only
   - supports `limit` in `1..500`

## 3. Configuration Contract

Key runtime knobs in `python_sdk/seller_api/src/core/config.py`:

1. `FINANCE_IDEMPOTENCY_TTL_SEC`
2. `FINANCE_IDEMPOTENCY_MAX_ROWS`
3. `FINANCE_REPLAY_WINDOW_SEC`
4. `FINANCE_WRITE_RATE_LIMIT_PER_MIN`

Default examples live in `python_sdk/.env.example`.

## 4. Remaining Work (Production TODO)

### 4.1 Stronger Distributed Guarantees

1. Replace JSON-based local write-rate counters with Redis-backed distributed counters.
2. Move idempotency key store to Redis/Postgres with unique constraints and atomic upserts.
3. Add crash-safe transaction boundaries for multi-step financial mutations.

### 4.2 Security Verification and Tests

1. Add automated tests for:
   - idempotency replay consistency
   - key reuse with payload mismatch
   - owner isolation bypass attempts
   - rate-limit saturation under concurrent writes
2. Add CI gate for financial security regression tests.

### 4.3 Operational Controls

1. Add alerting on:
   - repeated `FINANCE_RATE_LIMIT_HIT`
   - replay rejections spike
   - refund-intent anomaly patterns
2. Add runbook for incident response on financial API abuse.

### 4.4 Token and Session Hardening

1. Add token revocation path for compromised sessions.
2. Add optional short-lifetime session mode for high-risk operations.
3. Add stronger anti-automation controls on auth challenge endpoints when exposed publicly.

## 5. Non-Negotiable Rule

If release speed conflicts with fund safety, fund safety wins.
