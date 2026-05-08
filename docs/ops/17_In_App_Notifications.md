---
title: In-App Notifications
status: active
owner: gateway
last_reviewed: 2026-04-22
---

# In-App Notifications

Synapse V1 uses a self-hosted Postgres inbox for user-facing notifications. It
does not use Novu, Knock, Courier, Firebase Cloud Messaging, or Google Pub/Sub
for persisted inbox state.

This is intentional. Deposit, withdrawal, refund, wallet, and security messages
contain financial context, so V1 keeps the notification payload inside our own
database boundary. The inbox is a user-experience channel, not a financial
source of truth.

## Architecture

- Gateway writes notification intents into `synapse_in_app_notifications`.
- Notification writes are best-effort side effects after the money state has
  committed.
- Notification insert failures must log `IN_APP_NOTIFICATION_WRITE_FAILED` and
  increment the future notification failure metric, but must not roll back
  deposit, withdrawal, refund, ledger, or bucket transitions.
- User-front reads the inbox through Gateway APIs and polls unread count only
  while the browser tab is visible and online.
- A lightweight cleanup task removes expired or old inbox rows in small batches.

The hard line is simple: ledger, audit log, chain events, and reconciliation
evidence are the truth. Inbox rows are only a convenient way to tell users what
happened.

## Data Model

The canonical table is `synapse_in_app_notifications`.

Core columns:

- `notification_id`
- `dedupe_key`
- `recipient_type`
- `recipient_owner_id`
- `recipient_admin_id`
- `event_type`
- `category`
- `severity`
- `priority`
- `title`
- `body`
- `action_url`
- `resource_type`
- `resource_id`
- `payload`
- `read_at`
- `archived_at`
- `expires_at`
- `created_at`

Indexes must support owner unread count, admin unread count, owner pagination,
dedupe, and expiry cleanup. Payloads must remain small and UI-focused. They must
not include raw signatures, JWTs, private keys, admin tokens, authorization
headers, or complete internal business objects.

Amounts must be serialized as strings. Do not introduce float values into
notification payloads.

Payloads must be metadata-only. Do not store localized full sentences in JSONB.
User-front i18n owns user-visible copy evolution; Gateway stores facts such as
`amount`, `currency`, `txHash`, `withdrawalId`, `resourceId`, and `status`.
Admin-front uses the same table for control-plane inbox rows. Those rows use
`recipient_type='admin'` and `recipient_admin_id=<admin_users.admin_id>`.

Timestamps returned by the API must be UTC ISO 8601 strings with `Z` suffix.
The frontend can render relative or local time, but backend storage and API
contracts must not depend on the server's local timezone.

## Write Semantics

Notification writes are independent from financial transactions.

Recommended sequence:

1. The deposit, withdrawal, refund, or ledger transition commits.
2. The request tail, after-commit hook, or lightweight background task builds an
   `InAppNotificationIntent`.
3. Gateway inserts it with `INSERT ... ON CONFLICT (dedupe_key) DO NOTHING`.
4. If insert fails, Gateway logs and emits notification failure telemetry.
5. The original financial operation remains successful.

This avoids the classic trap where an inbox formatting bug rolls back a funds
state machine. If an in-app notification is missed, the source-of-truth state is
still visible through dashboard, ledger, audit, and chain reconciliation.

## API

Owner-facing Gateway endpoints:

```text
GET  /api/v1/notifications?limit=20&cursor=&unreadOnly=false
GET  /api/v1/notifications/unread-count
POST /api/v1/notifications/{notificationId}/read
POST /api/v1/notifications/mark-all-read
POST /api/v1/notifications/{notificationId}/archive
```

Admin-facing Gateway-admin endpoints:

```text
GET  /api/admin/v1/notifications?limit=20&unreadOnly=false
GET  /api/admin/v1/notifications/unread-count
POST /api/admin/v1/notifications/{notificationId}/read
POST /api/admin/v1/notifications/mark-all-read
POST /api/admin/v1/notifications/{notificationId}/archive
```

Rules:

- `limit` defaults to `20` and is capped at `50`.
- Pagination is cursor-based.
- Archived notifications are hidden by default.
- A wallet can only read or mutate its own owner/provider notifications.
- An admin can only read or mutate rows where `recipient_admin_id` matches their
  current admin identity.
- Unread count must use indexed owner/admin lookups, not full-table scans.

## Cleanup

The cleanup task is intentionally boring.

Configuration:

```bash
IN_APP_NOTIFICATION_CLEANUP_ENABLED=true
IN_APP_NOTIFICATION_CLEANUP_INTERVAL_SEC=86400
IN_APP_NOTIFICATION_RETENTION_DAYS=90
IN_APP_NOTIFICATION_SECURITY_RETENTION_DAYS=180
IN_APP_NOTIFICATION_CLEANUP_BATCH_SIZE=1000
```

Behavior:

- Delete expired rows.
- Delete non-security rows older than the standard retention window.
- Keep security rows longer.
- Delete in batches so cleanup does not lock the hot inbox table.

Long-term audit must stay in audit logs, ledger rows, and chain evidence. Do not
extend inbox retention to compensate for missing audit data.

## User-Front Polling

User-front must avoid a polling storm.

Rules:

- Poll unread count every 30-60 seconds only while the tab is visible.
- Stop polling when `document.visibilityState === "hidden"`.
- Refresh immediately when the tab becomes visible again.
- Pause while the browser is offline.
- Fetch the full list only when the notification panel/page is opened.
- V1 does not need WebSocket, SSE, or BroadcastChannel.

This gives users a live-enough inbox without turning every hidden browser tab
into a background database load generator.

## Notification Scenarios

### Consumer / Owner

Send in-app notifications for:

- deposit confirmed
- deposit delayed
- insufficient balance blocks an invoke
- budget cap or spend limit triggered
- consumer withdrawal created
- consumer withdrawal enters manual review
- consumer withdrawal approved and ticket is ready
- consumer withdrawal completed on chain
- consumer withdrawal ticket expired and funds were returned
- consumer withdrawal soft revoke waiting for expiry
- refund completed
- refund rejected or failed
- new device login
- MFA/TOTP changed
- wallet binding changed
- email or security settings changed

### Provider

Send in-app notifications for:

- provider service approved
- provider service rejected
- provider health degraded, outage, or recovered
- provider withdrawal created
- provider withdrawal enters manual review
- provider withdrawal approved and ticket is ready
- provider withdrawal rejected
- provider withdrawal completed on chain
- provider withdrawal ticket expired and funds were returned
- provider withdrawal soft revoke waiting for expiry

Provider income credited summaries are intentionally not sent in V1. Provider
income is shown in dashboards. If product needs it later, add a daily digest
rather than real-time per-invoke inbox spam.

### Admin / Ops

Admin-front inbox is for operational items that need a human operator to notice
or follow up. V1 sends admin notifications for:

- Provider service lifecycle actions: pause, resume, suspend, and delete.
- Provider service force-probe results only when the service remains unhealthy,
  stale, or otherwise needs attention.
- Provider service lifecycle/delete failures that require the acting admin to
  refresh state or retry.

Do not send admin inbox notifications for search, pagination, filtering, detail
views, healthy force-probe success, or ordinary success toasts that do not need
follow-up.

Admin notification bodies must stay business-readable. Do not show table names,
SQL, raw gateway/RPC/backend errors, stack traces, or internal error-code
payloads in the admin inbox.

Admin Inbox provider-service regression evidence is local-only. It verifies the
full operator-facing loop:

1. Pause a recoverable Provider service from the admin API.
2. Confirm an unread admin notification exists in Postgres.
3. Open Admin-front `/provider-services`, open the top Admin Inbox, and capture
   screenshots.
4. Click the notification action and verify `read_at` is set.
5. Archive the notification and verify `archived_at` is set.
6. Resume the Provider service in `finally` so local state is restored.

Canonical SQL evidence:

```sql
SELECT notification_id, dedupe_key, recipient_type, recipient_admin_id,
       event_type, category, severity, title, body, action_url,
       resource_type, resource_id, read_at, archived_at, created_at
FROM synapse_in_app_notifications
WHERE recipient_type = 'admin'
  AND resource_type = 'provider_service'
  AND resource_id = :service_id
ORDER BY created_at DESC
LIMIT 20;
```

Expected evidence:

- `recipient_admin_id` is the logged-in admin.
- `event_type` is the provider-service lifecycle event, for example
  `admin.provider_service.pause`.
- `action_url` points to `/provider-services?serviceId=<serviceId>`.
- `read_at` is initially empty, then set after clicking the notification.
- `archived_at` is set after archive.
- The same `dedupe_key` appears at most once.
- Title and body do not contain table names, SQL, backend/RPC internals,
  `HTTPException`, or raw error-code payloads.

## Validation

Backend narrow checks:

```bash
cd services/gateway
python -m pytest tests/unit/test_notifications_outbox_unit.py tests/unit/test_in_app_notifications_router_unit.py

cd services/gateway-admin
.venv/bin/python -m pytest tests/test_app.py tests/test_admin_notifications.py -q
```

Frontend narrow check:

```bash
cd services/user-front
yarn test src/components/NotificationCenter.test.tsx
```

Admin-front narrow check:

```bash
cd services/admin-front
yarn test src/components/admin-notification-inbox.test.tsx src/services/admin-api-route-coverage.test.ts
```

Front-to-service dogfood with screenshots:

```bash
npm run e2e:in-app-notifications
npm run ci:in-app-notifications-evidence

npm run e2e:admin-inbox-provider-services
npm run ci:admin-inbox-provider-services-evidence
```

Before release-sensitive changes, also run:

```bash
npm run ci:gateway
npm run ci:frontend
npm run ci:agent-guardrails
npm run ci:financial-security
npm run ci:diff-coverage
npm run ci:docs
```

The tests must prove:

- `dedupe_key` prevents duplicate notifications.
- Notification insert failure does not break the financial request path.
- Owner scoping prevents cross-wallet reads and mutations.
- Unread count, mark read, mark all read, and archive work.
- Cleanup deletes in bounded batches.
- Sensitive payload fields are redacted.
- User-front pauses polling while hidden and refreshes when visible.
- Playwright evidence captures unread badge, dropdown, action URL, mark-all-read,
  archive, and empty state screenshots.
- The E2E report proves payloads are metadata-only and timestamps are UTC ISO.
