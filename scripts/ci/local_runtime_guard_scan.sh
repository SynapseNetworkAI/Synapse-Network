#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATEWAY_RESTART="$ROOT_DIR/scripts/local/restart_gateway.sh"

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

echo "[local-runtime-guard] Gateway restart script contains a DB role/schema probe"
