#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PID_FILE="${ROOT_DIR}/.local_env.pids"

find_pid_by_port() {
	local port="$1"
	lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

if ! command -v npx >/dev/null 2>&1; then
	echo "Error: npx is not installed. Please install Node.js first."
	exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
	echo "Error: python3 is not installed."
	exit 1
fi

cd "${ROOT_DIR}"

echo "=== Synapse Local Environment Setup ==="

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

CONFIG_FILE="${ROOT_DIR}/frontend/src/contract-config.json"
if [[ ! -f "$CONFIG_FILE" ]]; then
	echo "Error: contract-config.json not found after deployment."
	exit 1
fi

ROUTER_ADDRESS=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.A2APaySyncRouter)")
SELLER_ADDRESS=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.Treasury)")

echo "3) Starting seller_api/seller_fastapi.py in background (local profile)..."
cd "${ROOT_DIR}/python_sdk"

if [[ -x "${ROOT_DIR}/python_sdk/venv/bin/python" ]]; then
	PYTHON_BIN="${ROOT_DIR}/python_sdk/venv/bin/python"
else
	PYTHON_BIN="python3"
fi

echo "Using Python interpreter: ${PYTHON_BIN}"
if ! "$PYTHON_BIN" -c "import uvicorn, fastapi, web3" >/dev/null 2>&1; then
	echo "Python dependencies missing. Installing from python_sdk/requirements.txt ..."
	"$PYTHON_BIN" -m pip install -r "${ROOT_DIR}/python_sdk/requirements.txt"
fi

EXISTING_SELLER_PID="$(find_pid_by_port 8000)"
if [[ -n "$EXISTING_SELLER_PID" ]]; then
	echo "Port 8000 already in use by PID ${EXISTING_SELLER_PID}. Stopping stale API process..."
	kill "$EXISTING_SELLER_PID" >/dev/null 2>&1 || true
	sleep 1
	if kill -0 "$EXISTING_SELLER_PID" >/dev/null 2>&1; then
		kill -9 "$EXISTING_SELLER_PID" >/dev/null 2>&1 || true
	fi
fi

LOCAL_ENV_FILE="${ROOT_DIR}/python_sdk/.env.local"
if [[ -f "$LOCAL_ENV_FILE" ]]; then
	ENVIRONMENT=local \
	ENV_FILE=.env.local \
	RPC_URL="http://127.0.0.1:8545" \
	ROUTER_ADDRESS="$ROUTER_ADDRESS" \
	SELLER_ADDRESS="$SELLER_ADDRESS" \
	EXPECTED_PRICE="1000000000000000000" \
	"$PYTHON_BIN" seller_api/seller_fastapi.py > "${ROOT_DIR}/python_sdk/seller_api.log" 2>&1 &
else
	ENVIRONMENT=local \
	RPC_URL="http://127.0.0.1:8545" \
	ROUTER_ADDRESS="$ROUTER_ADDRESS" \
	SELLER_ADDRESS="$SELLER_ADDRESS" \
	EXPECTED_PRICE="1000000000000000000" \
	"$PYTHON_BIN" seller_api/seller_fastapi.py > "${ROOT_DIR}/python_sdk/seller_api.log" 2>&1 &
fi
SELLER_PID=$!
sleep 3

if ! kill -0 "$SELLER_PID" >/dev/null 2>&1; then
	echo "Error: Seller API failed to start. Check python_sdk/seller_api.log"
	if [[ "$ANVIL_OWNED_BY_SCRIPT" -eq 1 ]]; then
		kill "$ANVIL_PID" >/dev/null 2>&1 || true
	fi
	exit 1
fi

echo "4) Starting frontend Next.js in background..."
cd "${ROOT_DIR}/frontend"

EXISTING_FRONTEND_PID="$(find_pid_by_port 3000)"
if [[ -n "$EXISTING_FRONTEND_PID" ]]; then
	echo "Port 3000 already in use by PID ${EXISTING_FRONTEND_PID}. Reusing existing frontend process."
	FRONTEND_PID="$EXISTING_FRONTEND_PID"
	FRONTEND_OWNED_BY_SCRIPT=0
else
	if [[ ! -d "${ROOT_DIR}/frontend/node_modules" ]]; then
		echo "frontend/node_modules not found. Installing npm dependencies..."
		npm install
	fi

	npm run dev > "${ROOT_DIR}/frontend/frontend_dev.log" 2>&1 &
	FRONTEND_PID=$!
	FRONTEND_OWNED_BY_SCRIPT=1
	sleep 5

	if ! kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
		echo "Error: Frontend failed to start. Check frontend/frontend_dev.log"
		kill "$SELLER_PID" >/dev/null 2>&1 || true
		if [[ "$ANVIL_OWNED_BY_SCRIPT" -eq 1 ]]; then
			kill "$ANVIL_PID" >/dev/null 2>&1 || true
		fi
		exit 1
	fi
fi

cat > "$PID_FILE" <<EOF
ANVIL_PID=$ANVIL_PID
ANVIL_OWNED_BY_SCRIPT=$ANVIL_OWNED_BY_SCRIPT
SELLER_PID=$SELLER_PID
FRONTEND_PID=$FRONTEND_PID
FRONTEND_OWNED_BY_SCRIPT=$FRONTEND_OWNED_BY_SCRIPT
EOF

echo ""
echo "=== Local system running ==="
echo "Anvil PID    : $ANVIL_PID"
echo "Seller PID   : $SELLER_PID"
echo "Frontend PID : $FRONTEND_PID"
echo "Router       : $ROUTER_ADDRESS"
echo "Seller       : $SELLER_ADDRESS"
echo "PID file     : $PID_FILE"
echo "Frontend URL : http://127.0.0.1:3000"
echo ""
echo "E2E test command:"
echo "  cd ${ROOT_DIR}"
echo "  npx hardhat run scripts/e2e_sync_payment.js --network localhost"
echo ""
echo "Shutdown command:"
echo "  bash scripts/local/stop_local_env.sh"
