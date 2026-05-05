#!/usr/bin/env bash

if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# scripts/ is a symlink (→ tools/scripts); logical ".." traversal skips the symlink
# level, so repo root is two levels up from scripts/local, not three.
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PID_FILE="${ROOT_DIR}/.local_env.pids"
PYTHON_RESOLVER="${ROOT_DIR}/scripts/python/resolve_python_313.sh"
REQUIRED_NODE_VERSION="20.19.0"
REQUIRED_YARN_VERSION="1.22.22"
LOCAL_GATEWAY_POSTGRES_PORT="${SYNAPSE_POSTGRES_HOST_PORT:-15432}"
export HARDHAT_DISABLE_TELEMETRY_PROMPT="${HARDHAT_DISABLE_TELEMETRY_PROMPT:-true}"
export HARDHAT_DISABLE_TELEMETRY="${HARDHAT_DISABLE_TELEMETRY:-true}"

find_pid_by_port() {
	local port="$1"
	lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

resolve_compose_cmd() {
	if docker compose version >/dev/null 2>&1; then
		echo "docker compose"
		return 0
	fi
	if command -v docker-compose >/dev/null 2>&1; then
		echo "docker-compose"
		return 0
	fi
	return 1
}

ensure_docker_runtime() {
	local compose_cmd="$1"
	if ${compose_cmd} version >/dev/null 2>&1; then
		return 0
	fi
	if command -v colima >/dev/null 2>&1; then
		echo "Docker daemon is not available. Starting Colima..."
		colima start >/dev/null
		if ${compose_cmd} version >/dev/null 2>&1; then
			return 0
		fi
	fi
	echo "Error: Docker runtime is unavailable and local postgres cannot be started automatically."
	return 1
}

wait_for_postgres_ready() {
	local timeout_sec="${1:-30}"
	local postgres_port="${PGPORT:-${SYNAPSE_POSTGRES_HOST_PORT:-${LOCAL_GATEWAY_POSTGRES_PORT}}}"
	local elapsed=0
	while [[ "$elapsed" -lt "$timeout_sec" ]]; do
		if pg_isready -h 127.0.0.1 -p "$postgres_port" -U synapse >/dev/null 2>&1; then
			return 0
		fi
		sleep 1
		elapsed=$((elapsed + 1))
	done
	return 1
}

ensure_local_docker_infra() {
	local existing_postgres_pid
	existing_postgres_pid="$(lsof -t -nP -iTCP:5432 -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
	if [[ -n "$existing_postgres_pid" && "$LOCAL_GATEWAY_POSTGRES_PORT" != "5432" ]]; then
		echo "Port 5432 is already in use by PID ${existing_postgres_pid}; local setup will use Docker Postgres on 127.0.0.1:${LOCAL_GATEWAY_POSTGRES_PORT}."
	fi

	local compose_cmd
	if ! compose_cmd="$(resolve_compose_cmd)"; then
		echo "Error: neither 'docker compose' nor 'docker-compose' is available; cannot bootstrap local Postgres."
		return 1
	fi
	ensure_docker_runtime "$compose_cmd"

	echo "0) Starting Docker local infra via ${compose_cmd}..."
	echo "   postgres: 127.0.0.1:${LOCAL_GATEWAY_POSTGRES_PORT}, redis: 127.0.0.1:6379, minio: http://127.0.0.1:9001, otterscan: http://localhost:5100"
	SYNAPSE_POSTGRES_HOST_PORT="$LOCAL_GATEWAY_POSTGRES_PORT" ${compose_cmd} -f "${ROOT_DIR}/infra/docker/local/docker-compose.yml" up -d postgres redis minio otterscan >/dev/null
	if ! wait_for_postgres_ready 45; then
		echo "Error: local Postgres failed to become ready on 127.0.0.1:${PGPORT:-${SYNAPSE_POSTGRES_HOST_PORT:-${LOCAL_GATEWAY_POSTGRES_PORT}}}."
		return 1
	fi
}

ensure_local_postgres_database() {
	local postgres_port="${PGPORT:-${SYNAPSE_POSTGRES_HOST_PORT:-${LOCAL_GATEWAY_POSTGRES_PORT}}}"
	local bootstrap_user="${LOCAL_POSTGRES_BOOTSTRAP_USER:-${POSTGRES_USER:-synapse}}"
	local bootstrap_password="${LOCAL_POSTGRES_BOOTSTRAP_PASSWORD:-${POSTGRES_PASSWORD:-local-dev-postgres-password}}"
	local db_name="${POSTGRES_DB:-${SYNAPSE_GATEWAY_DB:-synapse_gateway}}"

	if [[ -z "$db_name" ]]; then
		echo "Error: local Gateway database name is empty."
		return 1
	fi

	PGPASSWORD="$bootstrap_password" psql \
		-h 127.0.0.1 \
		-p "$postgres_port" \
		-U "$bootstrap_user" \
		-d postgres \
		-X \
		-v ON_ERROR_STOP=1 \
		--set=db_name="$db_name" <<'SQL' >/dev/null
SELECT format('CREATE DATABASE %I', :'db_name')
WHERE NOT EXISTS (
	SELECT 1
	FROM pg_database
	WHERE datname = :'db_name'
) \gexec
SQL
}

bootstrap_local_postgres_schema() {
	local target_db="${POSTGRES_DB:-${SYNAPSE_GATEWAY_DB:-synapse_gateway}}"
	local migration_dsn="${MIGRATION_DSN:-postgresql://synapse:local-dev-postgres-password@127.0.0.1:${LOCAL_GATEWAY_POSTGRES_PORT}/${target_db}}"

	ensure_local_postgres_database
	echo "0.1) Applying local Gateway schema migration..."
	MIGRATION_DSN="$migration_dsn" \
		bash "${ROOT_DIR}/services/gateway/scripts/deploy/migrate_db.sh" local
}

ensure_node_runtime() {
	local needs_node20=0

	if ! command -v node >/dev/null 2>&1; then
		needs_node20=1
	elif ! node -e "const [major, minor, patch] = process.versions.node.split('.').map(Number); process.exit((major > 20 || (major === 20 && (minor > 19 || (minor === 19 && patch >= 0)))) ? 0 : 1)" >/dev/null 2>&1; then
		needs_node20=1
	fi

	if [[ "$needs_node20" -eq 1 ]]; then
		if [[ -f "${HOME}/.nvm/nvm.sh" ]]; then
			export NVM_DIR="${HOME}/.nvm"
			# shellcheck source=/dev/null
			source "${NVM_DIR}/nvm.sh"
			nvm install "${REQUIRED_NODE_VERSION}" >/dev/null
			nvm use "${REQUIRED_NODE_VERSION}" >/dev/null
		else
			echo "Error: Node.js >= ${REQUIRED_NODE_VERSION} is required. Install nvm or a newer Node.js runtime first."
			exit 1
		fi
	fi

	if ! command -v npm >/dev/null 2>&1; then
		echo "Error: npm is not installed after activating Node.js ${REQUIRED_NODE_VERSION}."
		exit 1
	fi
}

ensure_yarn_runtime() {
	local yarn_version=""

	yarn_version="$(command yarn --version 2>/dev/null || true)"
	if [[ ! "$yarn_version" =~ ^1\.22\.22$ ]]; then
		echo "Installing Yarn ${REQUIRED_YARN_VERSION} for the active Node.js runtime..."
		npm install -g "yarn@${REQUIRED_YARN_VERSION}" >/dev/null
		hash -r
	fi
}

ensure_node_runtime
ensure_yarn_runtime

if [[ -d "${HOME}/.foundry/bin" ]]; then
	export PATH="${HOME}/.foundry/bin:${PATH}"
fi

if [[ ! -f "$PYTHON_RESOLVER" ]]; then
	echo "Error: Python resolver script not found at ${PYTHON_RESOLVER}"
	exit 1
fi

if ! command -v anvil >/dev/null 2>&1; then
	echo "Error: anvil is not installed. Please install Foundry first."
	exit 1
fi

ensure_hardhat_local() {
	if [[ ! -f "${ROOT_DIR}/package.json" ]]; then
		echo "Error: package.json is missing in repo root; cannot run local Hardhat deploy scripts."
		exit 1
	fi

	if [[ ! -d "${ROOT_DIR}/node_modules/hardhat" ]]; then
		echo "Installing local contract toolchain dependencies..."
		(
			cd "${ROOT_DIR}"
			yarn install
		)
	fi
}

cd "${ROOT_DIR}"

echo "=== Synapse Local Environment Setup ==="
echo "Using Node.js: $(node -v)"
echo "Using npm    : $(npm -v)"
echo "Using yarn   : $(yarn --version)"

ensure_hardhat_local
ensure_local_docker_infra
bootstrap_local_postgres_schema

echo "1) Starting Anvil node in background..."
EXISTING_ANVIL_PID="$(find_pid_by_port 8545)"
if [[ -n "$EXISTING_ANVIL_PID" ]]; then
	echo "Port 8545 already in use by PID ${EXISTING_ANVIL_PID}. Reusing existing local RPC node."
	ANVIL_PID="$EXISTING_ANVIL_PID"
	ANVIL_OWNED_BY_SCRIPT=0
else
	nohup anvil > "${ROOT_DIR}/anvil_node.log" 2>&1 < /dev/null &
	ANVIL_PID=$!
	ANVIL_OWNED_BY_SCRIPT=1
	sleep 4

	if ! kill -0 "$ANVIL_PID" >/dev/null 2>&1; then
		echo "Error: Anvil node failed to start. Check anvil_node.log"
		exit 1
	fi
fi

echo "2) Deploying contracts to localhost..."
npx hardhat run scripts/chain/deploy_anvil.js --network localhost

echo "2.1) Funding test accounts..."
npx hardhat run scripts/chain/fund_eth.js --network localhost
npx hardhat run scripts/chain/fund_usdc.js --network localhost

CONFIG_FILE="${ROOT_DIR}/services/user-front/src/contract-config.json"
if [[ ! -f "$CONFIG_FILE" ]]; then
	echo "Error: contract-config.json not found after deployment."
	exit 1
fi

ROUTER_ADDRESS=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.SynapseCore)")
USDC_TOKEN_ADDRESS=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.MockUSDC)")
PROVIDER_ADDRESS=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.Treasury)")

echo "3) Starting gateway/gateway_fastapi.py in background (local profile)..."
bash "${ROOT_DIR}/scripts/local/restart_gateway.sh"

PROVIDER_PID=""
ANALYTICS_OUTBOX_PID=""
NOTIFICATION_OUTBOX_PID=""
if [[ -f "$PID_FILE" ]]; then
	source "$PID_FILE"
fi

if [[ -z "${PROVIDER_PID:-}" ]]; then
	echo "Error: Gateway restart did not record PROVIDER_PID in ${PID_FILE}."
	if [[ "$ANVIL_OWNED_BY_SCRIPT" -eq 1 ]]; then
		kill "$ANVIL_PID" >/dev/null 2>&1 || true
	fi
	exit 1
fi

echo "4) Starting frontend Next.js in background..."
cd "${ROOT_DIR}/services/user-front"

EXISTING_FRONTEND_PID="$(find_pid_by_port 3000)"
if [[ -n "$EXISTING_FRONTEND_PID" ]]; then
	echo "Port 3000 already in use by PID ${EXISTING_FRONTEND_PID}. Reusing existing frontend process."
	FRONTEND_PID="$EXISTING_FRONTEND_PID"
	FRONTEND_OWNED_BY_SCRIPT=0
else
	if [[ ! -d "${ROOT_DIR}/services/user-front/node_modules" ]]; then
		echo "services/user-front/node_modules not found. Installing npm dependencies..."
		yarn install
	fi

	NEXT_PUBLIC_APP_ENV="${NEXT_PUBLIC_APP_ENV:-local}" \
	NEXT_PUBLIC_GATEWAY_BASE_URL="${NEXT_PUBLIC_GATEWAY_BASE_URL:-http://127.0.0.1:8000}" \
	NEXT_PUBLIC_ANALYTICS_ENDPOINT="${NEXT_PUBLIC_ANALYTICS_ENDPOINT:-http://127.0.0.1:8000/api/v1/events}" \
	NEXT_PUBLIC_DOCS_BASE_URL="${NEXT_PUBLIC_DOCS_BASE_URL:-http://localhost:3100}" \
	NEXT_PUBLIC_TX_EXPLORER_BASE_URL="${NEXT_PUBLIC_TX_EXPLORER_BASE_URL:-http://localhost:5100}" \
	NEXT_PUBLIC_RPC_URL="${NEXT_PUBLIC_RPC_URL:-http://127.0.0.1:8545}" \
	NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS="${NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS:-20000}" \
	NEXT_PUBLIC_SUPPORT_EMAIL="${NEXT_PUBLIC_SUPPORT_EMAIL:-support@synapse-network.ai}" \
	nohup yarn dev --hostname 0.0.0.0 > "${ROOT_DIR}/services/user-front/frontend_dev.log" 2>&1 < /dev/null &
	FRONTEND_PID=$!
	FRONTEND_OWNED_BY_SCRIPT=1
	sleep 5

	if ! kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
		echo "Error: Frontend failed to start. Check services/user-front/frontend_dev.log"
		kill "$PROVIDER_PID" >/dev/null 2>&1 || true
		if [[ "$ANVIL_OWNED_BY_SCRIPT" -eq 1 ]]; then
			kill "$ANVIL_PID" >/dev/null 2>&1 || true
		fi
		exit 1
	fi
fi

cat > "$PID_FILE" <<EOF
ANVIL_PID=$ANVIL_PID
ANVIL_OWNED_BY_SCRIPT=$ANVIL_OWNED_BY_SCRIPT
PROVIDER_PID=$PROVIDER_PID
ANALYTICS_OUTBOX_PID=${ANALYTICS_OUTBOX_PID:-}
NOTIFICATION_OUTBOX_PID=${NOTIFICATION_OUTBOX_PID:-}
FRONTEND_PID=$FRONTEND_PID
FRONTEND_OWNED_BY_SCRIPT=$FRONTEND_OWNED_BY_SCRIPT
EOF

echo ""
echo "=== Local system running ==="
echo "Anvil PID    : $ANVIL_PID"
echo "Provider PID : $PROVIDER_PID"
echo "Analytics outbox worker PID  : ${ANALYTICS_OUTBOX_PID:-screen:synapse-gateway-analytics-outbox}"
echo "Notification outbox worker PID: ${NOTIFICATION_OUTBOX_PID:-screen:synapse-gateway-notification-outbox}"
echo "Frontend PID : $FRONTEND_PID"
echo "Router       : $ROUTER_ADDRESS"
echo "USDC Token   : $USDC_TOKEN_ADDRESS"
echo "Provider     : $PROVIDER_ADDRESS"
echo "PID file     : $PID_FILE"
echo "Frontend URL : http://127.0.0.1:3000"
echo "Docs URL     : http://127.0.0.1:3100 (started by scripts/local/start_all_services.sh)"
echo "Admin URL    : http://127.0.0.1:3200/login (started by scripts/local/start_all_services.sh)"
echo ""
echo "E2E test command:"
echo "  cd ${ROOT_DIR}"
echo "  npx hardhat run scripts/e2e_sync_payment.js --network localhost"
echo ""
echo "Shutdown command:"
echo "  bash scripts/local/stop_local_env.sh"
