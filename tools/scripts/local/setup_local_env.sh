#!/usr/bin/env bash

if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
PID_FILE="${ROOT_DIR}/.local_env.pids"
PYTHON_RESOLVER="${ROOT_DIR}/scripts/python/resolve_python_311.sh"
REQUIRED_NODE_VERSION="20.19.0"
REQUIRED_YARN_VERSION="1.22.22"
export HARDHAT_DISABLE_TELEMETRY_PROMPT="${HARDHAT_DISABLE_TELEMETRY_PROMPT:-true}"
export HARDHAT_DISABLE_TELEMETRY="${HARDHAT_DISABLE_TELEMETRY:-true}"

find_pid_by_port() {
	local port="$1"
	lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
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

echo "1) Starting Anvil node in background..."
EXISTING_ANVIL_PID="$(find_pid_by_port 8545)"
if [[ -n "$EXISTING_ANVIL_PID" ]]; then
	echo "Port 8545 already in use by PID ${EXISTING_ANVIL_PID}. Reusing existing local RPC node."
	ANVIL_PID="$EXISTING_ANVIL_PID"
	ANVIL_OWNED_BY_SCRIPT=0
else
	anvil > "${ROOT_DIR}/anvil_node.log" 2>&1 &
	ANVIL_PID=$!
	ANVIL_OWNED_BY_SCRIPT=1
	sleep 4

	if ! kill -0 "$ANVIL_PID" >/dev/null 2>&1; then
		echo "Error: Anvil node failed to start. Check anvil_node.log"
		exit 1
	fi
fi

echo "2) Deploying contracts to localhost..."
npx hardhat run scripts/deploy_anvil.js --network localhost

echo "2.1) Funding test accounts..."
npx hardhat run scripts/fund_eth.js --network localhost
npx hardhat run scripts/fund_usdc.js --network localhost

CONFIG_FILE="${ROOT_DIR}/services/user-front/src/contract-config.json"
if [[ ! -f "$CONFIG_FILE" ]]; then
	echo "Error: contract-config.json not found after deployment."
	exit 1
fi

ROUTER_ADDRESS=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.SynapseCore)")
PROVIDER_ADDRESS=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.Treasury)")

echo "3) Starting gateway/gateway_fastapi.py in background (local profile)..."
cd "${ROOT_DIR}/services/gateway"

if [[ -x "${ROOT_DIR}/services/gateway/.venv/bin/python" ]]; then
	PYTHON_BIN="${ROOT_DIR}/services/gateway/.venv/bin/python"
elif [[ -x "${ROOT_DIR}/services/gateway/venv/bin/python" ]]; then
	PYTHON_BIN="${ROOT_DIR}/services/gateway/venv/bin/python"
else
	PYTHON_BIN="$(bash "$PYTHON_RESOLVER")"
fi

echo "Using Python interpreter: ${PYTHON_BIN}"
if ! "$PYTHON_BIN" -c "import uvicorn, fastapi, web3" >/dev/null 2>&1; then
	echo "Python dependencies missing. Installing from gateway/requirements.txt ..."
	"$PYTHON_BIN" -m pip install -r "${ROOT_DIR}/services/gateway/requirements.txt"
fi

EXISTING_PROVIDER_PID="$(find_pid_by_port 8000)"
if [[ -n "$EXISTING_PROVIDER_PID" ]]; then
	echo "Port 8000 already in use by PID ${EXISTING_PROVIDER_PID}. Stopping stale API process..."
	kill "$EXISTING_PROVIDER_PID" >/dev/null 2>&1 || true
	sleep 1
	if kill -0 "$EXISTING_PROVIDER_PID" >/dev/null 2>&1; then
		kill -9 "$EXISTING_PROVIDER_PID" >/dev/null 2>&1 || true
	fi
fi

LOCAL_ENV_FILE="${ROOT_DIR}/services/gateway/.env.local"
DEFAULT_LOCAL_POSTGRES_DSN="postgresql://synapse:12345678@127.0.0.1:5432/synapse_gateway"
LOCAL_POSTGRES_DSN="${POSTGRES_DSN:-$DEFAULT_LOCAL_POSTGRES_DSN}"
# Normalize docker-network hostname for host-run local mode.
LOCAL_POSTGRES_DSN="${LOCAL_POSTGRES_DSN/@postgres:/@127.0.0.1:}"

if [[ -f "$LOCAL_ENV_FILE" ]]; then
	ENVIRONMENT=local \
	ENV_FILE=.env.local \
	GATEWAY_RELOAD=false \
	POSTGRES_DSN="$LOCAL_POSTGRES_DSN" \
	RPC_URL="http://127.0.0.1:8545" \
	ROUTER_ADDRESS="$ROUTER_ADDRESS" \
	PROVIDER_ADDRESS="$PROVIDER_ADDRESS" \
	EXPECTED_PRICE="1000000000000000000" \
	"$PYTHON_BIN" gateway_fastapi.py > "${ROOT_DIR}/services/gateway/logs/provider_api.log" 2>&1 &
else
	ENVIRONMENT=local \
	GATEWAY_RELOAD=false \
	POSTGRES_DSN="$LOCAL_POSTGRES_DSN" \
	RPC_URL="http://127.0.0.1:8545" \
	ROUTER_ADDRESS="$ROUTER_ADDRESS" \
	PROVIDER_ADDRESS="$PROVIDER_ADDRESS" \
	EXPECTED_PRICE="1000000000000000000" \
	"$PYTHON_BIN" gateway_fastapi.py > "${ROOT_DIR}/services/gateway/logs/provider_api.log" 2>&1 &
fi
PROVIDER_PID=$!
sleep 3

if ! kill -0 "$PROVIDER_PID" >/dev/null 2>&1; then
	echo "Error: Provider API failed to start. Check gateway/logs/provider_api.log"
	if [[ "$ANVIL_OWNED_BY_SCRIPT" -eq 1 ]]; then
		kill "$ANVIL_PID" >/dev/null 2>&1 || true
	fi
	exit 1
fi

echo "4) Starting frontend Next.js in background..."
cd "${ROOT_DIR}/apps/frontend"

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

	yarn dev > "${ROOT_DIR}/services/user-front/frontend_dev.log" 2>&1 &
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
FRONTEND_PID=$FRONTEND_PID
FRONTEND_OWNED_BY_SCRIPT=$FRONTEND_OWNED_BY_SCRIPT
EOF

echo ""
echo "=== Local system running ==="
echo "Anvil PID    : $ANVIL_PID"
echo "Provider PID : $PROVIDER_PID"
echo "Frontend PID : $FRONTEND_PID"
echo "Router       : $ROUTER_ADDRESS"
echo "Provider     : $PROVIDER_ADDRESS"
echo "PID file     : $PID_FILE"
echo "Frontend URL : http://127.0.0.1:3000"
echo ""
echo "E2E test command:"
echo "  cd ${ROOT_DIR}"
echo "  npx hardhat run scripts/e2e_sync_payment.js --network localhost"
echo ""
echo "Shutdown command:"
echo "  bash scripts/local/stop_local_env.sh"
