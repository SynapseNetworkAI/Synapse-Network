---
title: Gmail Async Email Notifications
status: active
owner: gateway
last_reviewed: 2026-04-22
---

# Gmail Async Email Notifications

Gateway email is an asynchronous notification side effect. It must never block
`invoke`, balance, deposit, withdrawal, approval, or reconciliation request
paths.

## Architecture

- Request handlers and finance services enqueue notification intents into
  `synapse_notification_outbox`.
- The standalone worker sends email through Gmail SMTP:

  ```bash
  python -m src.worker notification-outbox
  python -m src.worker notification-outbox --once
  ```

- Sent rows are inserted into `synapse_notification_delivery_log` and deleted
  from the hot outbox table in the same DB transaction.
- Delivery is **at least once**. If Gmail accepts a message and the worker
  crashes before the DB commit, the same notification may be sent again after
  restart. This is accepted in V1 because email is not a financial source of
  truth.

## Gmail Configuration

```bash
EMAIL_TRANSPORT=gmail_smtp
GMAIL_SMTP_HOST=smtp.gmail.com
GMAIL_SMTP_PORT=587
GMAIL_SMTP_USERNAME=alerts@synapse.example
GMAIL_SMTP_APP_PASSWORD=...
EMAIL_FROM="Synapse Network <alerts@synapse.example>"
EMAIL_REPLY_TO=support@synapse.example
EMAIL_SEND_TIMEOUT_SEC=10
EMAIL_MAX_PER_MINUTE=60
EMAIL_GMAIL_DAILY_SOFT_LIMIT=1500
EMAIL_GMAIL_DAILY_HARD_LIMIT=1900
EMAIL_WORKER_BATCH_SIZE=50
EMAIL_OUTBOX_MAX_ATTEMPTS=8
EMAIL_OUTBOX_RETRY_BASE_SEC=30
```

Use a Google Workspace mailbox with 2FA and an app password or SMTP relay.
Configure SPF, DKIM, and DMARC before production sending. Gmail has physical
daily limits; when the hard limit is reached, low priority `digest` and `ops`
mail must wait while `security` and `transactional_high` notifications remain
eligible for sending.

## Email Scenarios

V1 sends transactional and security notifications only. **Provider income
credited summaries are intentionally not emailed**; provider revenue reporting
should stay in dashboards or explicit digest work introduced later.

Send email for:

- email verification or email change confirmation
- login/MFA/password reset security events
- deposit confirmed or delayed
- consumer withdrawal created, ticket ready, completed, expired, or soft-revoked
- provider withdrawal review pending, ticket ready, rejected, completed, or expired
- refund completed or failed
- provider service health degraded, outage, or recovered
- admin withdrawal/refund review pending or approval failure
- finance reconciliation delta and long-lived pending/frozen funds

Do not use email as the first response channel for P0 funds incidents. P0
continues to route through Lark/Prometheus; email can be a post-incident digest.

## Security Rules

- Never email raw withdrawal tickets, signatures, JWTs, private keys, or admin
  tokens.
- Email links must take users back to authenticated app pages, not grant access
  by themselves.
- `notify_marketing=false` only suppresses marketing messages. Transactional and
  security mail are operational controls.
- Logs and delivery evidence must store masked recipients and safe provider
  response summaries only.

## Operational Signals

Monitor:

- `email_gmail_daily_quota_used`
- `email_gmail_quota_exceeded_total`
- `email_outbox_pending_total`
- `email_outbox_oldest_pending_age_seconds`
- `email_outbox_dead_letter_total`
- `email_send_failure_total`

Alert when:

- Gmail authentication fails
- daily quota exceeds the soft limit
- outbox oldest pending age exceeds 10 minutes
- dead-letter count grows
- Gmail returns quota errors

## Validation

Run the notification unit tests:

```bash
cd services/gateway
python -m pytest tests/unit/test_notifications_outbox_unit.py
```

The test must prove:

- outbox claiming uses `FOR UPDATE SKIP LOCKED`
- sent rows move to delivery log and are deleted from the hot outbox
- quota errors retry instead of breaking Gateway request paths
- low-priority email is deferred after the hard daily limit
- security email remains eligible after the hard daily limit
- sensitive payload fields are redacted from email bodies
