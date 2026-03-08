#!/bin/bash
# Helper script mapping the start sequence for the new infrastructure.

# Define directories
ROOT_DIR=$(pwd)

echo "=== A2A Phase 3 Environment Setup ==="
echo "1. Starting Hardhat Node in background..."
npx hardhat node > hardhat_node.log 2>&1 &
HARDHAT_PID=$!
sleep 3 # wait for node to start

echo "2. Deploying Contracts..."
npx hardhat run scripts/deploy.js --network localhost

echo "3. Starting Seller FastAPI Server in background..."
cd python_sdk
python3 seller_fastapi.py > seller_api.log 2>&1 &
SELLER_PID=$!
sleep 2

echo "=== System Running ==="
echo "Hardhat Node PID: $HARDHAT_PID"
echo "Seller API PID: $SELLER_PID"
echo ""
echo "To test the flow, run:"
echo "cd python_sdk && python3 buyer_client.py"
echo ""
echo "To shutdown, run:"
echo "kill $HARDHAT_PID $SELLER_PID"
