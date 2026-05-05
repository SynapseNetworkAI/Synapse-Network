# Staging Validation Runbook

This runbook verifies the deployed staging environment without treating old
local full-stack assumptions as production truth. MVP staging is Cloud Run,
Cloud SQL Postgres, Secret Manager, Cloud Monitoring/Lark, Gmail SMTP outbox,
and Arbitrum Sepolia. Kafka, ClickHouse, Redis, and self-hosted Prometheus are
not staging blockers.

Production remains `NO-GO` until staging evidence, backup restore evidence,
Lark alert evidence, and a small-value production rehearsal are all attached.

## Phase 1 Core Links

The first staging acceptance phase is not "the website opens". It is the four
money-path arteries working together:

| Core link                | What must pass                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deposit Flow             | Arbitrum Sepolia deposit transaction, Gateway indexer, Cloud SQL ledger credit, and owner balance update.                                          |
| Withdrawal State Machine | Consumer/provider withdrawal risk path, EIP-712 ticket signing, admin manual approval for large withdrawals, on-chain claim, and replay rejection. |
| Lark Alerts              | P0, prod-alerts style, and staging-drill routes deliver sanitized cards with business scenario and action.                                         |
| Reconciliation           | Internal ledger and on-chain vault reconcile with `ledgerDelta=0.000000` and `vaultDelta=0.000000`.                                                |

Phase 1 passes only when chain transactions, Gateway API, Cloud SQL ledger,
Admin approval, Lark notification, Gmail notification, and evidence gates are
all green.

## Required Secrets

Confirm each Secret Manager id exists and has an enabled version before running
the full validation. This command does not print secret values:

```bash
PROJECT_ID=fabled-archive-494108-k5
for s in \
  synapse-staging-postgres-dsn \
  synapse-staging-deployer-private-key \
  synapse-staging-gas-funder-private-key \
  synapse-staging-arbitrum-sepolia-rpc-url \
  synapse-staging-arbiscan-api-key \
  synapse-staging-lark-webhook-p0 \
  synapse-staging-lark-webhook-prod-alerts \
  synapse-staging-lark-webhook-staging-drill \
  synapse-staging-gmail-username \
  synapse-staging-gmail-app-password \
  synapse-staging-e2e-consumer-private-key \
  synapse-staging-e2e-provider-private-key \
  synapse-staging-admin-e2e-password \
  synapse-staging-admin-e2e-otp-secret
do
  latest="$(gcloud secrets versions list "$s" \
    --project="$PROJECT_ID" \
    --filter='state:ENABLED' \
    --sort-by='~createTime' \
    --limit=1 \
    --format='value(name)' 2>/dev/null || true)"
  if [ -n "$latest" ]; then
    printf '%-58s %s\n' "$s" "has-enabled-version"
  else
    printf '%-58s %s\n' "$s" "missing-enabled-version"
  fi
done
```

E2E-only boundaries:

| Secret id                                  | Purpose                                                     | Runtime injection                  |
| ------------------------------------------ | ----------------------------------------------------------- | ---------------------------------- |
| `synapse-staging-e2e-consumer-private-key` | Consumer wallet used only by full-chain staging automation. | Never inject into Gateway runtime. |
| `synapse-staging-e2e-provider-private-key` | Provider wallet used only by full-chain staging automation. | Never inject into Gateway runtime. |
| `synapse-staging-admin-e2e-password`       | Dedicated admin dogfood account password.                   | Never use a real operator account. |
| `synapse-staging-admin-e2e-otp-secret`     | Dedicated admin dogfood account TOTP seed.                  | Never use a real operator account. |

Write commands for these E2E-only values are maintained in
`docs/ops/17_Staging_Environment_Configuration.md`.

If the dedicated admin E2E password or Google Authenticator manual key is
unknown, rotate both values and reset the test account:

```bash
bash scripts/deploy/gcp_reset_staging_admin_e2e.sh fabled-archive-494108-k5
```

The script resets only `staging-admin-e2e@synapse-network.ai` by default. It
writes a new password and TOTP seed to Secret Manager, updates the staging
Gateway-admin DB, revokes old sessions, and revokes old active TOTP factors.
The TOTP seed itself does not expire; the six-digit OTP code generated from it
expires every 30 seconds.

For an existing staging admin account, reset by login email with an explicit
confirmation. This does not overwrite the shared E2E Secret Manager entries by
default:

```bash
STAGING_ADMIN_RESET_CONFIRM=I_UNDERSTAND_THIS_RESETS_A_STAGING_ADMIN_ACCOUNT \
PRINT_SECRETS_ONCE=true \
bash scripts/deploy/gcp_reset_staging_admin_e2e.sh fabled-archive-494108-k5 \
  --email operator@example.com
```

When running from a laptop, the staging admin DB secret may contain a Cloud Run
Unix socket DSN like `host=/cloudsql/...`. Start Cloud SQL Auth Proxy first,
then pass the proxy port to the reset script:

```bash
cloud-sql-proxy --address 127.0.0.1 --port 5433 \
  fabled-archive-494108-k5:us-central1:synapse-staging-postgres

STAGING_ADMIN_RESET_CONFIRM=I_UNDERSTAND_THIS_RESETS_A_STAGING_ADMIN_ACCOUNT \
STAGING_ADMIN_CLOUD_SQL_PROXY_PORT=5433 \
PRINT_SECRETS_ONCE=true \
bash scripts/deploy/gcp_reset_staging_admin_e2e.sh fabled-archive-494108-k5 \
  --email operator@example.com
```

## Contract Baseline

Current verified staging deployment:

| Field                           | Value                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Chain                           | Arbitrum Sepolia `421614`                                                      |
| SynapseCore / `ROUTER_ADDRESS`  | `0x0bA1dcE1Cc8d877052ab1C3CE2362830459D8FF4`                                   |
| MockUSDC / `USDC_TOKEN_ADDRESS` | `0xfad31daE42B0046aFA106BCf56ED0dDaCA4463B9`                                   |
| Contract owner                  | `0x1896285a84ED0aa7C654B2547b3dDF137B974cCE`                                   |
| Gateway withdraw signer         | `0x1Eb2A684B8B7160D947940b644be6f939C783963`                                   |
| Evidence                        | `docs/evidence/release/contracts/arbitrum-sepolia/20260424T062942120Z-deploy/` |

The deploy evidence proves MockUSDC and SynapseCore source verification, ABI and
bytecode hashes, owner-only MockUSDC, and pre-mint to the dedicated staging
consumer/provider wallets.

## Validation Layers

| Layer                          | Purpose                                                                                                                                                                                                | Command / Evidence                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| L0 Infra smoke                 | DNS, TLS, Cloud Run health/readiness, CORS, docs-front public docs endpoints                                                                                                                           | `npm run e2e:staging-smoke` and `npm run ci:staging-smoke-evidence`                                                                    |
| L1 Chain smoke                 | Arbitrum Sepolia RPC, chain id, deployed bytecode, wallet gas                                                                                                                                          | `npm run staging:arb-sepolia:wallets:status` and `npm run ci:contract-deployment-evidence`                                             |
| L2 Business E2E                | Gateway full-chain deposit, invoke, withdraw, reconciliation                                                                                                                                           | `GATEWAY_RELEASE_E2E_PROFILE=mvp-postgres npm run release:evidence:gateway-fullchain:staging`                                          |
| L2.5 Full regression           | Deployed User-front dashboard, billing, discovery, canonical provider invoke, LLM invoke, provider console, and admin read-only state must match Cloud SQL evidence without creating provider services | `npm run e2e:staging-full-regression` and `npm run ci:staging-full-regression-evidence`                                                |
| L3 UI dogfood                  | User-front/Admin-front/Docs-front browser render, CORS, screenshots, console/network errors                                                                                                            | `npm run e2e:staging-ui-dogfood`                                                                                                       |
| L3.5 Withdrawal review dogfood | Consumer large withdrawal and Provider withdrawal approve/reject review paths with screenshots, DB, and chain evidence                                                                                 | `npm run e2e:withdrawal-review-dogfood:staging`                                                                                        |
| L4 Notifications               | Lark delivery, local/staging GCP Monitoring receiver, and Gmail outbox delivery                                                                                                                        | `npm run e2e:lark-alerts`, `npm run e2e:gcp-alerts:local`, `npm run e2e:gcp-alerts:staging`, `npm run e2e:gmail-notifications:staging` |
| L5 Recovery/load               | Cloud SQL restore, light load, DB connection pressure                                                                                                                                                  | `npm run drill:backup-restore:staging`, `npm run perf:staging-load-suite`                                                              |
| L6 Chaos                       | Intentional failure and rollback drills                                                                                                                                                                | Run only after L0-L5 are green and manually approved                                                                                   |

## Step 0 - L0/L1 Preflight

Run immediately after a staging deploy:

```bash
npm run e2e:staging-smoke
npm run ci:staging-smoke-evidence

npm run staging:arb-sepolia:wallets:status

CONTRACT_DEPLOYMENT_EVIDENCE_DIR=docs/evidence/release/contracts/arbitrum-sepolia/20260424T062942120Z-deploy \
  npm run ci:contract-deployment-evidence
```

Success criteria:

- `https://api-staging.synapse-network.ai/health` returns JSON successfully.
- `https://api-staging.synapse-network.ai/readiness` returns ready monitors.
- `https://admin-api-staging.synapse-network.ai/health` returns JSON
  successfully.
- `https://staging.synapse-network.ai`,
  `https://docs-staging.synapse-network.ai`, and
  `https://admin-staging.synapse-network.ai/login` return browser-renderable
  pages.
- `https://docs-staging.synapse-network.ai/llms.txt`,
  `/llms-full.txt`, `/sitemap.xml`, `/openapi.json`, `/sdks`, and
  `/api-reference` return successfully.
- User-front origin can preflight Gateway, and Admin-front origin can preflight
  Gateway-admin.
- RPC returns `chainId=421614`.
- SynapseCore and MockUSDC bytecode exists at the configured addresses.
- Consumer/provider/deployer wallets have Arbitrum Sepolia ETH gas above the
  configured minimum.

Evidence is written to:

```text
docs/evidence/staging/smoke/<timestamp>-staging-smoke/
```

Do not commit failed smoke evidence.

## Step 1 - Deposit Flow

Manual UI path:

1. Open `https://staging.synapse-network.ai`.
2. Connect the `Synapse Staging Test Consumer` wallet.
3. Switch MetaMask/Rabby to Arbitrum Sepolia.
4. Confirm the wallet has MockUSDC and Arbitrum Sepolia ETH gas.
5. Submit a small MockUSDC deposit.
6. Wait 1-2 minutes for Cloud Scheduler, or manually trigger the indexer:

```bash
gcloud run jobs execute synapse-staging-deposit-indexer \
  --project fabled-archive-494108-k5 \
  --region us-central1 \
  --wait
```

Database verification:

- Connect through Cloud SQL Auth Proxy or an approved staging bastion.
- Query the deposit intent, ledger entries, and owner balance.
- Record `txHash`, `indexed_at`, `credited_at`, and delay seconds.

Success criteria:

- On-chain deposit transaction succeeds on Arbitrum Sepolia.
- Deposit indexer job exits successfully.
- Cloud SQL owner balance increases by the exact Decimal amount.
- No duplicate credit is created for the same on-chain event.
- Deposit credited delay is below 2 minutes for normal staging operation.
- Delay above 5 minutes is a P1 investigation trigger.

## Step 2 - Withdrawal State Machine

Small automatic path:

1. Consumer starts a small withdrawal from User-front.
2. Gateway risk check auto-approves.
3. Gateway signs the ticket through Cloud KMS
   `synapse-staging-withdraw-signer`; no raw signer `PRIVATE_KEY` is injected
   into Gateway.
4. Gateway returns an EIP-712 withdrawal ticket.
5. Consumer claims against SynapseCore.
6. Replaying the same ticket must fail.

Large manual path:

1. Consumer or provider starts a withdrawal above the manual threshold.
2. State becomes pending/manual review.
3. Admin logs in at `https://admin-staging.synapse-network.ai/login`.
4. Admin-front/Gateway-admin review queue shows both `Provider withdrawal` and
   `Consumer withdrawal` items. Consumer items are backed by Gateway
   `consumer_refund` rows and must use the Gateway refund review endpoint.
5. Admin approves or rejects in Admin-front.
6. Gateway releases or signs the ticket only after approval.
7. If Admin rejects a consumer manual withdrawal, Gateway must atomically move
   the exact amount from `consumer_frozen_balance` back to
   `consumer_available_balance` and mark the intent `REJECTED`.
8. If Admin approves, user claims successfully on-chain.

Success criteria:

- Small withdrawal can generate a valid ticket without manual approval.
- Large withdrawal cannot be claimed before approval.
- Approval writes an admin audit record.
- Consumer reject writes an admin audit record with
  `withdrawalKind=consumer_refund` and a financial audit
  `CONSUMER_WITHDRAW_REVIEW_REJECTED`.
- Consumer reject acceptance is: status `REJECTED`, frozen balance decreased by
  the exact amount, available balance increased by the exact amount, pending
  unchanged, and ledger/vault reconciliation remains `0.000000`.
- Ticket `chainId` is `421614`.
- Ticket `verifyingContract` is
  `0x0bA1dcE1Cc8d877052ab1C3CE2362830459D8FF4`.
- Replay is rejected on-chain or by Gateway idempotency controls.
- Final Cloud SQL withdrawal state is completed.

Automated dogfood gate:

```bash
export STAGING_WITHDRAWAL_REVIEW_DOGFOOD_CONFIRM=I_UNDERSTAND_THIS_MUTATES_STAGING
export PROJECT_ID=fabled-archive-494108-k5
export GATEWAY_E2E_GATEWAY_BASE=https://api-staging.synapse-network.ai
export STAGING_ADMIN_FRONT_URL=https://admin-staging.synapse-network.ai
export STAGING_ADMIN_API_URL=https://admin-api-staging.synapse-network.ai
export GATEWAY_E2E_RPC_URL="$(gcloud secrets versions access latest \
  --secret=synapse-staging-arbitrum-sepolia-rpc-url \
  --project="$PROJECT_ID")"
export GATEWAY_E2E_OWNER_KEY="$(gcloud secrets versions access latest \
  --secret=synapse-staging-e2e-consumer-private-key \
  --project="$PROJECT_ID")"
export GATEWAY_E2E_PROVIDER_KEY="$(gcloud secrets versions access latest \
  --secret=synapse-staging-e2e-provider-private-key \
  --project="$PROJECT_ID")"
export STAGING_ADMIN_E2E_PASSWORD="$(gcloud secrets versions access latest \
  --secret=synapse-staging-admin-e2e-password \
  --project="$PROJECT_ID")"
export STAGING_ADMIN_E2E_OTP_SECRET="$(gcloud secrets versions access latest \
  --secret=synapse-staging-admin-e2e-otp-secret \
  --project="$PROJECT_ID")"
export POSTGRES_DSN="<Cloud SQL Auth Proxy DSN>"
export WITHDRAWAL_REVIEW_DOGFOOD_FIXTURE="<staging provider fixture json>"

npm run e2e:withdrawal-review-dogfood:staging
npm run ci:withdrawal-review-dogfood-staging-evidence
```

The staging dogfood is a manual release gate, not a PR check. It mutates
staging chain and Cloud SQL state, captures Admin-front screenshots, records
API/DB/chain evidence, and writes failures to `bugfix-log.md`. Failed evidence
must not be committed as release evidence.

`WITHDRAWAL_REVIEW_DOGFOOD_FIXTURE` is required for the Provider reject path. It
must contain staging-only authenticated consumer/provider data, a Provider
service id, and an agent credential token so the script can create real Provider
receivable before requesting a manual-review withdrawal. Do not use production
credentials or real customer accounts in this fixture.

Deployment ordering requirement:

1. Build and push Gateway/Gateway-admin/Admin-front images.
2. Run Gateway schema migration and Gateway-admin admin DB migration.
3. Deploy Gateway and Gateway-admin.
4. Run smoke checks.
5. Run withdrawal review dogfood.

Do not deploy Gateway-admin before its admin DB migration; otherwise login,
review queue, or review history can fail with 500 even when Gateway itself is
healthy.

## Step 3 - Lark Alerts

Use the standard E2E first. Do not start by breaking RPC or changing production
alert configuration:

```bash
npm run e2e:lark-alerts
npm run ci:lark-alert-e2e-evidence
```

The E2E validates:

- P0 war-room route.
- Prod-alerts style route.
- Staging drill route.
- 100-alert batch folding.
- Business scenario, impact, trigger, and action fields.
- `LARK_E2E_TEST` and `NO_ACTION_REQUIRED` markers.

Success criteria:

- All three Lark routes receive a card.
- P0 card describes a money/reconciliation class scenario.
- Staging drill clearly says it is not a production incident.
- Evidence does not leak webhook URLs, JWTs, private keys, raw signatures, or
  Lark signing secrets.

## Step 3.5 - GCP Monitoring Alert Closure

Staging uses the low-cost GCP path: GCP Monitoring webhook channel calls
gateway-admin, and gateway-admin forwards to Lark using Secret Manager. Do not
deploy a standalone Relay service and do not create a separate alert-probe job.

First prove the local receiver and Gateway drill semantics without GCP or real
Lark delivery:

```bash
npm run e2e:gcp-alerts:local
npm run ci:gcp-alerts-local-evidence
```

Local evidence is written to
`output/dogfood/gcp-alerts/<timestamp>-local-gcp-alerts/`. The checker requires
`report.json`, `report.md`, `trace.jsonl`, and `bugfix-log.md`; the bugfix log
must have no open bug before staging is deployed.

Configure the webhook channel, alert policies, and GCP uptime checks:

```bash
export PROJECT_ID=fabled-archive-494108-k5
export GCP_ALERT_RECEIVER_URL=https://admin-api-staging.synapse-network.ai/api/v1/ops/webhooks/gcp-alert-receiver
export GCP_ALERT_RECEIVER_TOKEN="$(gcloud secrets versions access latest \
  --secret=synapse-staging-gcp-alert-receiver-token \
  --project="$PROJECT_ID")"

bash scripts/deploy/gcp_configure_staging_alerts.sh \
  "$PROJECT_ID" \
  "$GCP_ALERT_RECEIVER_URL"
```

Validate the receiver immediately with a synthetic GCP payload:

```bash
export GCP_ALERTS_STAGING_E2E_CONFIRM=I_UNDERSTAND_THIS_SENDS_STAGING_ALERTS
export GCP_ALERT_RECEIVER_TOKEN="$(gcloud secrets versions access latest \
  --secret=synapse-staging-gcp-alert-receiver-token \
  --project="$PROJECT_ID")"
export GATEWAY_STAGING_URL=https://api-staging.synapse-network.ai
export STAGING_ALERT_DRILL_TOKEN="$(gcloud secrets versions access latest \
  --secret=synapse-staging-alert-drill-token \
  --project="$PROJECT_ID")"

npm run e2e:gcp-alerts:staging
npm run ci:gcp-alerts-staging-evidence
```

For release-candidate validation, also prove that GCP Monitoring itself called
gateway-admin after the 500 drill:

```bash
export GCP_ALERTS_REQUIRE_MONITORING_DELIVERY=true
export GCP_ALERTS_MONITORING_WAIT_SECONDS=600

npm run e2e:gcp-alerts:staging
npm run ci:gcp-alerts-staging-evidence
```

The real Gateway 5xx policy validates by calling the controlled drill endpoint
multiple times:

```bash
for i in {1..20}; do
  curl -sS -o /dev/null -w "%{http_code}\n" \
    -H "X-Synapse-Drill-Token: $STAGING_ALERT_DRILL_TOKEN" \
    https://api-staging.synapse-network.ai/api/v1/ops/drills/http-500 || true
done
```

Success criteria:

- GCP has one webhook channel named `Synapse Staging Lark Gateway-admin Receiver`.
- GCP has uptime checks for Gateway `/health`, Gateway `/readiness`, user-front `/`, and admin API `/health`.
- GCP has policies for Gateway uptime, user-front uptime, admin API uptime, Gateway 5xx rate, Gateway low-traffic 5xx count, Gateway-admin 5xx rate, Cloud Run Job failure, every-minute Job freshness, `WITHDRAWAL_TIMEOUT`, `RECONCILIATION_DRIFT`, `PROVIDER_UPSTREAM_UNAVAILABLE`, and `CHAIN_RPC_UNAVAILABLE`.
- Cloud Scheduler has enabled triggers for deposit-indexer, consumer-withdraw-processor, provider-withdraw-reaper, notification-outbox-drain, and in-app-notification-cleanup.
- Lark receives a staging drill card with `NO_ACTION_REQUIRED`.
- In full callback mode, gateway-admin logs contain
  `alert_trigger=GCP_ALERT_RECEIVED` for
  `synapse_staging_gateway_5xx_rate_high` or
  `synapse_staging_gateway_5xx_count_high`.
- Evidence under `docs/evidence/staging/gcp-alerts/` passes digest and secret-scan checks.
- No real DB rows, balances, or chain state are mutated by the alert drill.

Gateway outage triage:

```bash
curl -fsS https://api-staging.synapse-network.ai/health
curl -fsS https://api-staging.synapse-network.ai/readiness
curl -fsS https://api-staging.synapse-network.ai/api/v1/services/discover

gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="synapse-staging-gateway"' \
  --project fabled-archive-494108-k5 \
  --freshness=30m \
  --limit=50 \
  --format='table(timestamp,severity,textPayload)'

gcloud monitoring uptime list-configs \
  --project fabled-archive-494108-k5 \
  --filter='displayName:"Synapse Staging"'

gcloud scheduler jobs list \
  --project fabled-archive-494108-k5 \
  --location us-central1 \
  --format='table(name.basename(),schedule,state,httpTarget.uri)'

gcloud logging read \
  'resource.type="cloud_run_job"' \
  --project fabled-archive-494108-k5 \
  --freshness=30m \
  --limit=30 \
  --format='table(timestamp,resource.labels.job_name,severity,textPayload)'
```

Use this interpretation before calling Gateway "down":

| Signal                                                    | Meaning                                                                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `/health` fails                                           | L0 outage: DNS, TLS, Cloud Run routing, IAM, or process down.                                              |
| `/health` passes but `/readiness` fails                   | Dependency/readiness fault, not necessarily a dead process.                                                |
| `/readiness` passes but `/api/v1/services/discover` fails | Business API, CORS, registry, or discovery fault.                                                          |
| Provider invoke returns 503 with no healthy target        | Provider upstream health issue, not Gateway process outage.                                                |
| `CHAIN_RPC_UNAVAILABLE` appears in logs                   | Arbitrum Sepolia RPC dependency outage or wrong RPC config.                                                |
| Cloud Run Job failure/freshness alert fires               | Scheduled worker failed or stopped succeeding; inspect `resource.type="cloud_run_job"` logs by `job_name`. |

The `/readiness` monitor block describes in-process Gateway monitors only. In
staging, `deposit_indexer.enabled=false`,
`provider_withdraw_expiry_reaper.enabled=false`,
`consumer_withdraw_processor.enabled=false`, and
`in_app_notification_cleanup.enabled=false` are expected because those workers
run as Cloud Run Jobs through Cloud Scheduler. Use the Scheduler/Job commands
above to verify whether they are actually enabled and succeeding.

Gateway and Gateway-admin stdout/stderr logs are both collected by Google Cloud
Logging. Use `resource.type="cloud_run_revision"` plus `service_name` for API
services, and `resource.type="cloud_run_job"` plus `job_name` for scheduled
workers. They live in the same project logging system but are easy to split by
resource labels.

## Step 4 - Gmail Staging E2E

Gmail staging sends a real staging email and therefore requires explicit
confirmation:

```bash
export PROJECT_ID=fabled-archive-494108-k5
export REGION=us-central1
export GMAIL_STAGING_E2E_CONFIRM=I_UNDERSTAND_THIS_SENDS_STAGING_EMAIL
export GMAIL_STAGING_E2E_RECIPIENT=<staging-recipient-email>
export STAGING_GMAIL_POSTGRES_DSN=<locally-reachable-staging-gateway-postgres-dsn>

npm run e2e:gmail-notifications:staging
npm run ci:gmail-notifications-staging-evidence
```

When the Secret Manager DSN uses the Cloud Run socket path
`host=/cloudsql/<project>:<region>:<instance>`, local `psql` cannot use it
unless a matching socket exists on the laptop. Prefer Cloud SQL Auth Proxy and
convert the DSN to localhost for the E2E run:

```bash
curl -fsSL -o /tmp/cloud-sql-proxy \
  https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.18.3/cloud-sql-proxy.darwin.arm64
chmod +x /tmp/cloud-sql-proxy

/tmp/cloud-sql-proxy --address 127.0.0.1 --port 5433 \
  fabled-archive-494108-k5:us-central1:synapse-staging-postgres
```

In another terminal, read the real DSN from Secret Manager and rewrite only the
host for the local proxy. Do not print or commit the resulting DSN.

```bash
export PROJECT_ID=fabled-archive-494108-k5
export RAW_STAGING_DSN="$(gcloud secrets versions access latest \
  --secret=synapse-staging-postgres-dsn \
  --project="$PROJECT_ID")"
export STAGING_GMAIL_POSTGRES_DSN="$(python3 - <<'PY'
import os
from urllib.parse import quote, unquote, urlparse

raw = os.environ["RAW_STAGING_DSN"]
parsed = urlparse(raw)
user = quote(unquote(parsed.username or ""), safe="")
password = quote(unquote(parsed.password or ""), safe="")
database = (parsed.path or "/synapse_gateway_staging").lstrip("/")
print(f"postgresql://{user}:{password}@127.0.0.1:5433/{database}")
PY
)"
```

The Gmail runner inserts one `deposit_confirmed` notification outbox row,
executes the staging notification outbox Cloud Run Job, and verifies the row
was moved into `synapse_notification_delivery_log`. It records only a recipient
email hash, never the email password, SMTP secret, or full DSN.

### Transaction Notification Acceptance

Staging transaction notifications are intentionally split by audience:

- User-front inbox receives product-visible money events.
- Gmail receives transactional receipts only when the owner has a verified
  email address.
- Lark receives staging transaction watch cards marked
  `STAGING_TRANSACTION_EVENT` and `NO_ACTION_REQUIRED`; these are for early
  staging visibility, not production user notifications.

Covered business events:

| Event                              | User inbox | Gmail template                       | Lark staging transaction card |
| ---------------------------------- | ---------- | ------------------------------------ | ----------------------------- |
| Deposit confirmed                  | Yes        | `deposit_confirmed`                  | Yes                           |
| Refund completed                   | Yes        | `refund_completed`                   | Yes                           |
| Consumer withdrawal ticket ready   | Yes        | `consumer_withdrawal_ticket_ready`   | Yes                           |
| Consumer withdrawal completed      | Yes        | `consumer_withdrawal_completed`      | Yes                           |
| Consumer withdrawal expired/failed | Yes        | `consumer_withdrawal_failed_expired` | Yes                           |
| Provider withdrawal ticket ready   | Yes        | `provider_withdrawal_ticket_ready`   | Yes                           |
| Provider withdrawal completed      | Yes        | `provider_withdrawal_completed`      | Yes                           |
| Provider withdrawal rejected       | Yes        | `provider_withdrawal_rejected`       | Yes                           |

The email template is receipt-style: black page background, white rounded
cards, amount/status/reference details, CTA, and support footer. It must remain
readable without remote images. Email save does not send a “saved” notification;
new or changed email addresses are staged as `pending_email` and receive an
`email_verification` message with a 6-digit code instead. The code expires after
10 minutes, and each wallet can send at most 5 verification emails per UTC day.
Only verified emails receive funding receipts.

Validate transaction notifications in phases. Default local proof never sends
real Gmail or Lark; it uses a fake Lark sink and fake email sender while
writing to the local Gateway Postgres notification tables:

```bash
export TRANSACTION_NOTIFICATIONS_POSTGRES_DSN=postgresql://synapse_gateway_app:local-dev-gateway-app-password@localhost:5432/synapse_gateway
export TRANSACTION_NOTIFICATIONS_TEST_EMAIL=transaction-e2e@synapse.test

npm run e2e:transaction-notifications:local
npm run ci:transaction-notifications-local-evidence
```

When validating the real local sender path, keep private values out of Git and
put them in `services/gateway/.env.local.private` or shell exports:

```bash
export TRANSACTION_NOTIFICATIONS_TEST_EMAIL=<real-recipient@example.com>
export TRANSACTION_NOTIFICATIONS_LOCAL_REAL_CONFIRM=I_UNDERSTAND_THIS_SENDS_REAL_LOCAL_EMAIL_AND_LARK
export PUBLIC_APP_BASE_URL=http://127.0.0.1:3000

npm run e2e:transaction-notifications:local-real
npm run ci:transaction-notifications-local-real-evidence
```

`local-real` sends real Gmail SMTP messages and real Lark cards, but still uses
local Gateway Postgres. It is useful before staging deploy because it proves the
receipt template and Lark transaction card work with real external transports.
Receipt CTA links use `PUBLIC_APP_BASE_URL`, not `PUBLIC_GATEWAY_BASE_URL`, so
local links should point to User-front on `http://127.0.0.1:3000`.

After deploying the new Gateway image to staging, run the live gate. This sends
real staging Gmail and Lark cards, so it requires explicit confirmation and a
Cloud SQL Auth Proxy DSN:

```bash
export PROJECT_ID=fabled-archive-494108-k5
export REGION=us-central1
export TRANSACTION_NOTIFICATIONS_STAGING_CONFIRM=I_UNDERSTAND_THIS_SENDS_STAGING_EMAIL_AND_LARK
export STAGING_TRANSACTION_POSTGRES_DSN=<Cloud-SQL-Auth-Proxy-localhost-DSN>
export STAGING_TRANSACTION_TEST_EMAIL=<verified-staging-test-email>

npm run e2e:gmail-notifications:staging
npm run ci:gmail-notifications-staging-evidence

npm run e2e:transaction-notifications:staging
npm run ci:transaction-notifications-staging-evidence
```

The transaction notification runner seeds or reuses a verified staging owner
email, writes deposit/refund/withdrawal notification fixtures through Gateway's
transaction notification code, executes `synapse-staging-notification-outbox-drain`,
and verifies:

- `synapse_in_app_notifications` contains product inbox rows.
- `synapse_notification_delivery_log` contains `deposit_confirmed`,
  `refund_completed`, and at least one withdrawal template.
- Lark delivery evidence includes `STAGING_TRANSACTION_EVENT` and
  `NO_ACTION_REQUIRED`.
- Receipt HTML contains `Receipt from Synapse Network`, amount, status,
  reference, and CTA.
- The run has no `dead_letter` rows and no secret-like values in evidence.

## Step 5 - Reconciliation

After at least one deposit and withdrawal path has run, execute the MVP
Postgres release evidence profile:

```bash
export PROJECT_ID=fabled-archive-494108-k5
export GATEWAY_E2E_GATEWAY_BASE=https://api-staging.synapse-network.ai
export GATEWAY_E2E_PROVIDER_BASE=<public-staging-provider-fixture-url>
export GATEWAY_E2E_PROVIDER_INVOKE_URL=<public-staging-provider-fixture-invoke-url>
export GATEWAY_E2E_RPC_URL="$(gcloud secrets versions access latest \
  --secret=synapse-staging-arbitrum-sepolia-rpc-url \
  --project="$PROJECT_ID")"
export GATEWAY_E2E_CONTRACT_CONFIG_PATH=services/user-front/src/contract-config.arbitrum-sepolia.example.json
export GATEWAY_E2E_DEPLOYER_KEY="$(gcloud secrets versions access latest \
  --secret=synapse-staging-deployer-private-key \
  --project="$PROJECT_ID")"
export GATEWAY_E2E_OWNER_KEY="$(gcloud secrets versions access latest \
  --secret=synapse-staging-e2e-consumer-private-key \
  --project="$PROJECT_ID")"
export GATEWAY_E2E_PROVIDER_KEY="$(gcloud secrets versions access latest \
  --secret=synapse-staging-e2e-provider-private-key \
  --project="$PROJECT_ID")"
export POSTGRES_DSN=<locally-reachable-staging-gateway-postgres-dsn>

GATEWAY_RELEASE_E2E_PROFILE=mvp-postgres \
  npm run release:evidence:gateway-fullchain:staging

GATEWAY_RELEASE_E2E_REQUIRED_ENV=staging \
  npm run ci:gateway-release-e2e-evidence
```

The historical staging full-chain runner used Kafka and ClickHouse as hard
requirements. MVP staging intentionally does not deploy those components. The
`mvp-postgres` profile must not require:

```text
ANALYTICS_CLICKHOUSE_URL
ANALYTICS_KAFKA_BOOTSTRAP_SERVERS
```

For staging release E2E, `GATEWAY_E2E_PROVIDER_BASE` is used for the provider
health preflight and `GATEWAY_E2E_PROVIDER_INVOKE_URL` is the public endpoint
registered as the service target. Do not use `localhost` for either value in
staging; Cloud Run cannot call a laptop-local mock provider.

Success criteria:

- `ledgerDelta=0.000000`.
- `vaultDelta=0.000000`.
- `reconciliationStatus=passed`.
- `trace.jsonl` exists.
- `report.json.traceDigest` equals `sha256(trace.jsonl)`.
- No duplicate debit, duplicate credit, or unexplained delta.

## UI Dogfood

Run browser-level staging verification after L0/L1 are green:

```bash
npm run e2e:staging-full-regression
npm run ci:staging-full-regression-evidence

npm run e2e:staging-ui-dogfood
```

The full-regression runner starts at
`https://staging.synapse-network.ai/dashboard/overview`, reuses only the
canonical staging provider services, and compares DOM/API/Cloud SQL/chain
checkpoints before writing screenshots. The UI-only dogfood runner remains a
lighter browser render sweep after the full regression passes.

Screenshot evidence is not accepted as a raw page photo. Any dashboard,
provider-console, or admin-console dogfood screenshot must be captured only
after the runner proves the target UI state is visible and auth blockers are
absent. Evidence bundles should include `screenshot-evidence.json` entries with
expected text/selectors, forbidden text absence, DOM checkpoints, and API/DB
checkpoints. Screenshots showing `Connect Wallet`, AuthMask, loading skeletons,
error modals, or unrelated overlays are failed evidence and must be rerun.

Evidence is written to:

```text
docs/evidence/staging/ui-dogfood/<timestamp>-staging-ui-dogfood/
```

Admin login lockout uses the dedicated admin E2E account only. Do not use
production or real operator accounts for dogfood. If the password or TOTP key
is unknown, run:

```bash
bash scripts/deploy/gcp_reset_staging_admin_e2e.sh fabled-archive-494108-k5
```

If a staging operator account itself must be reset, use the custom email mode
from the credentials section above and do not use that operator account for
dogfood automation.

## Core Dogfood E2E

For the first-phase staging money-path sign-off, run the combined UI + API +
DB + chain evidence gate. This is the preferred V1 path because Playwright only
proves the pages and operator surfaces are usable; ethers, Gateway API, Cloud
SQL, and SynapseCore prove the money state.

```bash
export STAGING_CORE_DOGFOOD_CONFIRM=I_UNDERSTAND_THIS_MUTATES_STAGING
export PROJECT_ID=fabled-archive-494108-k5
export GATEWAY_E2E_GATEWAY_BASE=https://api-staging.synapse-network.ai
export STAGING_USER_FRONT_URL=https://staging.synapse-network.ai
export STAGING_ADMIN_FRONT_URL=https://admin-staging.synapse-network.ai
export STAGING_ADMIN_API_URL=https://admin-api-staging.synapse-network.ai
export POSTGRES_DSN=<locally-reachable-staging-gateway-postgres-dsn>
export GATEWAY_E2E_RPC_URL="$(gcloud secrets versions access latest \
  --secret=synapse-staging-arbitrum-sepolia-rpc-url \
  --project="$PROJECT_ID")"
export GATEWAY_E2E_OWNER_KEY="$(gcloud secrets versions access latest \
  --secret=synapse-staging-e2e-consumer-private-key \
  --project="$PROJECT_ID")"
export GATEWAY_E2E_PROVIDER_KEY="$(gcloud secrets versions access latest \
  --secret=synapse-staging-e2e-provider-private-key \
  --project="$PROJECT_ID")"
export STAGING_ADMIN_E2E_PASSWORD="$(gcloud secrets versions access latest \
  --secret=synapse-staging-admin-e2e-password \
  --project="$PROJECT_ID")"
export STAGING_ADMIN_E2E_OTP_SECRET="$(gcloud secrets versions access latest \
  --secret=synapse-staging-admin-e2e-otp-secret \
  --project="$PROJECT_ID")"

npm run e2e:staging-core-dogfood
npm run ci:staging-core-dogfood-evidence
```

The runner intentionally does not automate MetaMask popups. It captures
User-front/Admin-front screenshots, then performs the actual staging money
movements through ethers and Gateway API:

- MockUSDC deposit from the dedicated E2E consumer wallet.
- Gateway deposit intent/confirmation and Cloud SQL deposit/ledger evidence.
- Small consumer withdrawal ticket creation, on-chain claim, and replay
  rejection.
- Large withdrawal manual-review probe with Admin-front review/audit screenshots.
- Final DB/chain reconciliation with `ledgerDelta=0.000000` and
  `vaultDelta=0.000000`.

Evidence is written to:

```text
docs/evidence/staging/core-dogfood/<timestamp>-staging-core-dogfood/
  report.json
  report.md
  trace.jsonl
  bugfix-log.md
  screenshots/
  api-evidence.json
  db-evidence.json
  chain-evidence.json
```

Failure policy:

- Do not commit failed core-dogfood evidence as release proof.
- Keep the local `bugfix-log.md` while fixing.
- Rerun `npm run e2e:staging-core-dogfood` and
  `npm run ci:staging-core-dogfood-evidence` until `failed.length === 0`.
- If the large withdrawal enters `PENDING_MANUAL_REVIEW` but is not visible in
  Admin-front/Gateway-admin review APIs, treat it as a staging release blocker
  unless `STAGING_CORE_DOGFOOD_REQUIRE_MANUAL_REVIEW=false` is explicitly set
  for a scoped diagnostic run.

## Evidence Output

Expected evidence locations:

```text
docs/evidence/staging/smoke/<timestamp>/
docs/evidence/staging/ui-dogfood/<timestamp>/
docs/evidence/staging/core-dogfood/<timestamp>/
docs/evidence/staging/gmail/<timestamp>/
docs/evidence/alerts/lark/<timestamp>/
docs/evidence/release/gateway-fullchain/<timestamp>-staging/
docs/evidence/release/contracts/arbitrum-sepolia/20260424T062942120Z-deploy/
```

Commit only successful release evidence. Failed evidence may remain local for
debugging or be copied into an explicit bugfix log, but it must not be presented
as release evidence.

## Final Phase 1 PASS Standard

Staging Phase 1 is `PASS` only when all of these are true:

- L0 smoke passes.
- Contract deployment evidence checker passes.
- Deposit manual chain path passes.
- Withdrawal small automatic path passes.
- Withdrawal large manual approval path passes.
- Lark E2E passes.
- Gmail staging E2E passes.
- Reconciliation deltas are `0.000000`.
- Gateway full-chain staging MVP profile evidence checker passes.
- All test wallets, test admin accounts, and test emails are staging-only.

## Recovery and Load

Run only after L0-L4 are green:

```bash
SYNAPSE_DRILL_ENV=staging \
SYNAPSE_DRILL_CONFIRM=I_UNDERSTAND_THIS_CHANGES_STAGING \
PROJECT_ID=fabled-archive-494108-k5 \
  bash scripts/drills/gcp_staging_backup_restore_drill.sh

npm run ci:backup-restore-evidence
```

The wrapper restores the latest Cloud SQL backup into a temporary isolated
instance and injects `RESTORE_POSTGRES_DSN` in memory. Do not use
`synapse-staging-postgres-dsn` as `RESTORE_POSTGRES_DSN`; that secret points at
the live staging database.

Light load is optional for a release candidate:

```bash
SYNAPSE_PERF_ENV=staging \
SYNAPSE_PERF_CONFIRM=I_UNDERSTAND_THIS_HITS_STAGING \
  npm run perf:staging-load-suite
```

The default staging load suite is a light-load profile: read-heavy Gateway,
finance balance, admin read-only, and provider health. It automatically logs in
with the dedicated staging admin E2E account to obtain cookie/CSRF auth. Money
write concurrency is skipped unless `SYNAPSE_PERF_ENABLE_MONEY_WRITE_LOAD=1` is
explicitly set.

Do not run chaos drills during first-pass staging acceptance. Chaos requires a
separate operator confirmation and a rollback owner present.

## Assumptions

- Current validation targets staging only; production is untouched.
- Provider fixture must be a public staging URL reachable by Gateway, not
  `localhost`.
- Cloud Scheduler's minimum one-minute interval means deposit crediting within
  1-2 minutes is acceptable for MVP staging.
- Any real P0 drill must include `NO_ACTION_REQUIRED` to prevent accidental
  production incident response.
