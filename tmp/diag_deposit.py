#!/usr/bin/env python3
"""Quick diagnostic: why deposit not confirmed."""
import os, sys, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "services", "gateway"))
from src.core.config import settings

# 1. ABI file resolution
base = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "services", "gateway",
    "src/services/platform/tasks/deposit_indexer/chain.py"
))
candidates = [
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(base))), "SynapseCoreABI.json"),
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(base)))))), "SynapseCoreABI.json"),
]
print("=== ABI Resolution ===")
for p in candidates:
    print(f"  {p}\n    exists={os.path.exists(p)}")

# 2. Check on-chain receipt
print("\n=== On-chain Receipt ===")
from web3 import Web3
w3 = Web3(Web3.HTTPProvider(settings.rpc_url))
tx_hash = "0x08a51f97b499ec7da9b6e25bf898424ea4c16dbc12e601ad00661022993d49f1"
try:
    receipt = w3.eth.get_transaction_receipt(tx_hash)
    print(f"status={receipt.status} blockNumber={receipt.blockNumber}")
    print(f"logs count={len(receipt.logs)}")
    for i, log in enumerate(receipt.logs):
        print(f"  Log {i}: addr={log.address} topics={[t.hex() for t in log.topics]}")
except Exception as e:
    print(f"Error: {e}")

# 3. Check router address
print(f"\n=== Config ===")
print(f"router_address={settings.router_address}")
print(f"rpc_url={settings.rpc_url}")
print(f"v2_deposit_confirmations={settings.v2_deposit_confirmations}")

# 4. Test fallback ERC20 Transfer decoding
print("\n=== ERC20 Transfer Fallback ===")
router = settings.router_address.lower()
TRANSFER_TOPIC = w3.keccak(text="Transfer(address,address,uint256)").hex().lower()
try:
    receipt2 = w3.eth.get_transaction_receipt(tx_hash)
    for log in receipt2.logs:
        topics = log.topics
        if len(topics) >= 3:
            t0 = topics[0].hex().lower()
            if t0 == TRANSFER_TOPIC:
                from_addr = "0x" + topics[1].hex()[-40:]
                to_addr = "0x" + topics[2].hex()[-40:]
                amount_raw = int.from_bytes(log.data, "big") if isinstance(log.data, bytes) else int(log.data, 16)
                print(f"  Transfer: from={from_addr} to={to_addr} amount_raw={amount_raw}")
                print(f"    to_is_router: {to_addr.lower() == router}")
except Exception as e:
    print(f"  Error: {e}")
