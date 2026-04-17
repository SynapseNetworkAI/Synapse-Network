---
id: admin-analytics-clickhouse-fullchain-regression
title: Admin Analytics ClickHouse Full-Chain Regression
status: ready
created_at: 2026-04-17
updated_at: 2026-04-17
owner: gateway-admin
---

# Admin Analytics ClickHouse Full-Chain Regression

This runbook verifies that Admin Analytics reads real ClickHouse data across all
seven Analytics pages and that the page-level API values match raw ClickHouse
aggregates.

The regression covers:

- `/dashboard/analytics`
- `/dashboard/analytics/consumer-funnel`
- `/dashboard/analytics/invocation-revenue`
- `/dashboard/analytics/provider-revenue`
- `/dashboard/analytics/money-flow`
- `/dashboard/analytics/risk-health`
- `/dashboard/analytics/data-quality`

## Service Preconditions

Start the local infrastructure and apps:

```bash
bash scripts/local/setup_local_env.sh
```

For analytics events to reach ClickHouse, the Gateway must emit to Kafka. Local
file-only mode is not enough for this regression. Start Gateway with staging
analytics settings:

```bash
cd services/gateway
set -a
source .env.local
set +a

ENVIRONMENT=staging \
ENV_FILE=.env.local \
GATEWAY_RELOAD=false \
POSTGRES_DSN="${POSTGRES_DSN/@postgres:/@127.0.0.1:}" \
RPC_URL=http://127.0.0.1:8545 \
ANALYTICS_KAFKA_BOOTSTRAP_SERVERS=localhost:9092 \
ANALYTICS_KAFKA_TOPIC=synapse.analytics.events \
./.venv/bin/python gateway_fastapi.py
```

Start the admin services:

```bash
cd services/gateway-admin
./.venv/bin/uvicorn src.app:app --host 0.0.0.0 --port 8300

cd ../admin-front
yarn dev
```

## Generate Real Business Events

Preferred full-chain path:

```bash
node scripts/provider_fullchain_e2e.js
```

This performs provider auth, service registration, consumer deposit, agent
credential creation, service invocation, and provider revenue verification. It
creates the event sequence that Admin Analytics should aggregate:

- `service_registered`
- `deposit_completed`
- `quote_generated`
- `invoke_started`
- `invoke_completed`
- `provider_revenue_received`

If the Python gateway ordered E2E chain is available, this longer path also
writes `output/analytics-fullchain/report.json`:

```bash
cd services/gateway
ANALYTICS_FULLCHAIN_E2E=true \
ANALYTICS_CLICKHOUSE_URL=http://localhost:8123 \
PYTHONPATH=. pytest tests/e2e/test_01_infrastructure.py \
  tests/e2e/test_02_wallet_auth.py \
  tests/e2e/test_03_fund_wallet.py \
  tests/e2e/test_04_deposit.py \
  tests/e2e/test_05_provider_register.py \
  tests/e2e/test_06_agent_credential.py \
  tests/e2e/test_07_invoke.py \
  tests/e2e/test_08_analytics_fullchain.py -q
```

## Verify Admin APIs Against ClickHouse

Run the stdlib-only regression script:

```bash
/usr/bin/python3 scripts/admin_analytics_clickhouse_regression.py
```

For CI or non-local environments, pass an existing admin session token:

```bash
ADMIN_SESSION_TOKEN="<synapse_admin_session cookie value>" \
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
ANALYTICS_CLICKHOUSE_URL=http://127.0.0.1:8123 \
/usr/bin/python3 scripts/admin_analytics_clickhouse_regression.py
```

For local development only, the script can seed a short-lived Super Admin
session directly into local admin Postgres when no token is supplied:

```bash
ADMIN_ANALYTICS_E2E_SEED_SESSION=true \
/usr/bin/python3 scripts/admin_analytics_clickhouse_regression.py
```

The script validates:

- overview cards versus raw ClickHouse counts and sums
- consumer funnel users, events, and conversion rates
- invocation quote/start/complete/fail counts, GMV, fees, and latency
- provider revenue counts and revenue sums
- money-flow deposit, failed deposit, withdrawal, and refund totals
- risk-health critical risk, provider degraded, and budget gap totals
- data-quality event count, duplicate rate, privacy violations, missing fields,
  XOR violations, and source coverage
- screenshot artifact presence for all seven pages

Output report:

```text
output/analytics-fullchain/admin-clickhouse-regression.json
```

## Screenshot Verification

When Node and Playwright are healthy, run the browser screenshot verifier:

```bash
ADMIN_FRONT_URL=http://127.0.0.1:4000 \
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
ADMIN_SESSION_TOKEN="<synapse_admin_session cookie value>" \
node scripts/admin_analytics_fullchain_e2e.js
```

Screenshot output:

```text
output/analytics-fullchain/screens/
├── 01-analytics-overview.png
├── 02-consumer-funnel.png
├── 03-invocation-revenue.png
├── 04-provider-revenue.png
├── 05-money-flow.png
├── 06-risk-health.png
└── 07-data-quality.png
```

## Known Local Machine Caveat

On April 17, 2026, one local Codex desktop session could not launch new
Homebrew Python, Node, Chrome, or `agent-browser` child processes reliably. The
processes stalled in macOS `dyld` before user code executed. The stdlib-only
regression still completed API and ClickHouse verification, but live screenshot
recapture required the previously generated Playwright screenshot artifacts.

If this happens:

- Kill stale child processes stuck in `_dyld_start`.
- Restart `gateway-admin` outside the stuck Codex process group.
- Re-run `scripts/admin_analytics_clickhouse_regression.py`.
- Re-run `scripts/admin_analytics_fullchain_e2e.js` to refresh screenshots.

## Bugfix Policy

If any assertion fails:

- Record the failure under `docs/reference/bugfix/gateway/analytics/`.
- Fix the code or query semantics.
- Restart the affected service.
- Re-run this regression until the report status is `success`.
