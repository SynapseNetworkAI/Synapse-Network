#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATEWAY_RESTART="$ROOT_DIR/scripts/local/restart_gateway.sh"
LOCAL_SETUP="$ROOT_DIR/scripts/local/setup_local_env.sh"

if [[ ! -f "$GATEWAY_RESTART" ]]; then
  echo "FATAL LOCAL-RUNTIME-001: restart_gateway.sh was not found at $GATEWAY_RESTART" >&2
  exit 1
fi

if ! grep -q '15432' "$GATEWAY_RESTART"; then
  cat >&2 <<'EOF'
FATAL LOCAL-RUNTIME-002: local Gateway restart must default to Docker Postgres on 127.0.0.1:15432.
Why dangerous: defaulting to 5432 can silently reuse a host Postgres or SSH tunnel.
Agent fix: keep local Gateway Docker-only by default and require LOCAL_GATEWAY_POSTGRES_DSN for intentional overrides.
EOF
  exit 1
fi

if grep -q 'Reusing existing local Postgres' "$GATEWAY_RESTART"; then
  cat >&2 <<'EOF'
FATAL LOCAL-RUNTIME-003: local Gateway restart must not reuse an arbitrary host Postgres listener.
Why dangerous: reusing 5432 can connect to stale local business data instead of the Docker volume.
Agent fix: start Docker Postgres explicitly and use its configured host port.
EOF
  exit 1
fi

if grep -Eq '(nc -z|find_pid_by_port 5432)' "$GATEWAY_RESTART" \
  && ! grep -Eq '(SELECT current_user|to_regclass|psql .*-c)' "$GATEWAY_RESTART"; then
  cat >&2 <<'EOF'
FATAL LOCAL-RUNTIME-001: local Gateway restart script only probes the Postgres port.
Why dangerous: a random local process can occupy 5432 while lacking the Synapse role/schema,
causing false local dogfood failures or hidden production-readiness regressions.
Agent fix: add a real Postgres probe such as `SELECT current_user` plus a required
`to_regclass(...)` schema/table check before starting Gateway.
EOF
  exit 1
fi

required_defaults=(
  'V2_INDEXER_ENABLED.*:-true'
  'V2_BACKFILL_ENABLED.*:-true'
  'V2_RECONCILIATION_ENABLED.*:-true'
  'SERVICE_HEALTH_MONITOR_ENABLED.*:-true'
  'PROVIDER_WITHDRAW_EXPIRY_REAPER_ENABLED.*:-true'
  'CONSUMER_WITHDRAW_PROCESSOR_ENABLED.*:-true'
  'IN_APP_NOTIFICATION_CLEANUP_ENABLED.*:-true'
  'SERVICE_HEALTH_EVENT_CLEANUP_ENABLED.*:-true'
)

for default_pattern in "${required_defaults[@]}"; do
  if ! grep -Eq "$default_pattern" "$GATEWAY_RESTART"; then
    cat >&2 <<EOF
FATAL LOCAL-RUNTIME-004: local Gateway restart must default all in-process background monitors to enabled.
Missing default pattern: ${default_pattern}
Why dangerous: disabled local monitors leave deposits, withdrawals, health probes, or cleanup rows stuck until a manual worker is run.
Agent fix: keep local restart defaults at true unless the operator explicitly overrides the env var.
EOF
    exit 1
  fi
done

if ! grep -q 'start_gateway_worker "analytics-outbox"' "$GATEWAY_RESTART" \
  || ! grep -q 'start_gateway_worker "notification-outbox"' "$GATEWAY_RESTART" \
  || ! grep -q -- '-m src.worker' "$GATEWAY_RESTART" \
  || ! grep -q -- '--poll-interval-sec 1' "$GATEWAY_RESTART"; then
  cat >&2 <<'EOF'
FATAL LOCAL-RUNTIME-005: local Gateway restart must start analytics and notification outbox workers.
Why dangerous: local end-to-end notification and analytics evidence can pass API enqueue checks while no worker drains outbox rows.
Agent fix: start `python -m src.worker analytics-outbox --poll-interval-sec 1` and
`python -m src.worker notification-outbox --poll-interval-sec 1` from restart_gateway.sh.
EOF
  exit 1
fi

if ! grep -q '/readiness' "$GATEWAY_RESTART" \
  || ! grep -q 'provider_withdraw_expiry_reaper' "$GATEWAY_RESTART" \
  || ! grep -q 'consumer_withdraw_processor' "$GATEWAY_RESTART"; then
  cat >&2 <<'EOF'
FATAL LOCAL-RUNTIME-006: local Gateway restart must assert readiness monitors after startup.
Why dangerous: /health can pass while required local background monitors are disabled or uninitialized.
Agent fix: query /readiness and fail startup unless the required monitors are enabled and initialized.
EOF
  exit 1
fi

if [[ -f "$LOCAL_SETUP" ]] && ! grep -q 'scripts/local/restart_gateway.sh' "$LOCAL_SETUP"; then
  cat >&2 <<'EOF'
FATAL LOCAL-RUNTIME-007: setup_local_env.sh must reuse restart_gateway.sh for Gateway startup.
Why dangerous: full local setup and Gateway-only restart drift into different worker/env defaults.
Agent fix: call scripts/local/restart_gateway.sh from setup_local_env.sh after contracts are deployed.
EOF
  exit 1
fi

echo "[local-runtime-guard] Gateway restart script contains a DB role/schema probe"
echo "[local-runtime-guard] local Gateway defaults enable required monitors and outbox workers"
