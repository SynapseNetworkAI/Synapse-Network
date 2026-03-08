import json
import os
import random

from agent_pay import AgentPayClient

def main():
    print("AgentPay Python SDK - Live Test")
    
    # We load ABIs and contract info from the artifact
    config_path = "../frontend/src/contract-config.json"
    
    if not os.path.exists(config_path):
        print(f"Error: Could not find config at {config_path}")
        return

    with open(config_path, "r") as f:
        config = json.load(f)
        
    usdc_addr = config.get("MockUSDC")
    escrow_addr = config.get("Escrow")
    
    # Hardhat pre-funded account #0 (Agent/Buyer)
    buyer_pk = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    
    # Hardhat pre-funded account #1 (Seller/Task Executing AI)
    seller_addr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
    
    client = AgentPayClient(
        rpc_url="http://127.0.0.1:8545",
        private_key=buyer_pk,
        usdc_address=usdc_addr,
        escrow_address=escrow_addr
    )

    amount_to_lock = 15.0
    task_id = f"python-sdk-test-{random.randint(1000, 9999)}"

    print(f"Agent Balance Before: {client.get_balance()} USDC")
    
    print(f"\n[1] Locking {amount_to_lock} USDC for {task_id} to Seller {seller_addr}...")
    tx_hash = client.lock_funds(task_id, seller_addr, amount_to_lock)
    print(f"Lock Tx successful! Hash: {tx_hash}")
    
    print("\n[2] Releasing funds...")
    tx_hash_2 = client.release_funds(task_id)
    print(f"Release Tx successful! Hash: {tx_hash_2}")
    
    print(f"\nAgent Balance After: {client.get_balance()} USDC")

if __name__ == "__main__":
    main()
