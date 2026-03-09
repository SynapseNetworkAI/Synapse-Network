#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
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

echo "=== A2A Local Environment Setup (Provider Mode) ==="

echo "1) Starting Hardhat Node in background..."
EXISTING_HARDHAT_PID="$(find_pid_by_port 8545)"
if [[ -n "$EXISTING_HARDHAT_PID" ]]; then
	echo "Port 8545 already in use by PID ${EXISTING_HARDHAT_PID}. Reusing existing local RPC node."
	HARDHAT_PID="$EXISTING_HARDHAT_PID"
	HARDHAT_OWNED_BY_SCRIPT=0
else
	npx hardhat node > "${ROOT_DIR}/hardhat_node.log" 2>&1 &
	HARDHAT_PID=$!
	HARDHAT_OWNED_BY_SCRIPT=1
	sleep 4

	if ! kill -0 "$HARDHAT_PID" >/dev/null 2>&1; then
		echo "Error: Hardhat node failed to start. Check hardhat_node.log"
		exit 1
	fi
fi

echo "2) Deploying contracts to localhost..."
npx hardhat run scripts/deploy.js --network localhost

CONFIG_FILE="${ROOT_DIR}/frontend/src/contract-config.json"
if [[ ! -f "$CONFIG_FILE" ]]; then
	echo "Error: contract-config.json not found after deployment."
	exit 1
fi

ROUTER_ADDRESS=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.A2APaySyncRouter)")
SELLER_ADDRESS=$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.Treasury)")

echo "3) Starting Seller FastAPI in background..."
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

RPC_URL="http://127.0.0.1:8545" \
ROUTER_ADDRESS="$ROUTER_ADDRESS" \
SELLER_ADDRESS="$SELLER_ADDRESS" \
EXPECTED_PRICE="1000000000000000000" \
"$PYTHON_BIN" seller_fastapi.py > "${ROOT_DIR}/python_sdk/seller_api.log" 2>&1 &
SELLER_PID=$!
sleep 3

if ! kill -0 "$SELLER_PID" >/dev/null 2>&1; then
	echo "Error: Seller API failed to start. Check python_sdk/seller_api.log"
	if [[ "$HARDHAT_OWNED_BY_SCRIPT" -eq 1 ]]; then
		kill "$HARDHAT_PID" >/dev/null 2>&1 || true
	fi
	exit 1
fi

echo "4) Starting Frontend Next.js in background..."
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
		if [[ "$HARDHAT_OWNED_BY_SCRIPT" -eq 1 ]]; then
			kill "$HARDHAT_PID" >/dev/null 2>&1 || true
		fi
		exit 1
	fi
fi

cat > "$PID_FILE" <<EOF
HARDHAT_PID=$HARDHAT_PID
HARDHAT_OWNED_BY_SCRIPT=$HARDHAT_OWNED_BY_SCRIPT
SELLER_PID=$SELLER_PID
FRONTEND_PID=$FRONTEND_PID
FRONTEND_OWNED_BY_SCRIPT=$FRONTEND_OWNED_BY_SCRIPT
EOF

echo ""
echo "=== System Running ==="
echo "Hardhat PID : $HARDHAT_PID"
echo "Seller PID  : $SELLER_PID"
echo "Frontend PID: $FRONTEND_PID"
echo "Router      : $ROUTER_ADDRESS"
echo "Seller      : $SELLER_ADDRESS"
echo "PID file    : $PID_FILE"
echo "Frontend    : http://127.0.0.1:3000"
echo ""
echo "Next (E2E test):"
echo "  cd ${ROOT_DIR}"
echo "  npx hardhat run scripts/e2e_sync_payment.js --network localhost"
echo "  # Then use printed TX_HASH to call FastAPI (see Python-Dev-Guide.md)"
echo ""
echo "Shutdown command:"
echo "  kill $HARDHAT_PID $SELLER_PID $FRONTEND_PID"
