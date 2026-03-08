import os
import sys
import json
import time

from agent_pay import AgentPayClient
from config import RPC_URL, AGENT_A_PRIV_KEY, AGENT_B_PRIV_KEY, load_contract_config

def run_demo():
    print("\n" + "="*50)
    print("🤖 Agent-to-Agent Payment Auto-Flow 🤖")
    print("="*50)

    config = load_contract_config()
    usdc_address = config["MockUSDC"]
    escrow_address = config["Escrow"]

    # 1. Initialize Clients
    print("\n--- 1. Initializing Agent Clients ---")
    buyer_client = AgentPayClient(AGENT_A_PRIV_KEY, RPC_URL, escrow_address, usdc_address)
    seller_client = AgentPayClient(AGENT_B_PRIV_KEY, RPC_URL, escrow_address, usdc_address)
    
    buyer_addr = buyer_client.account.address
    seller_addr = seller_client.account.address
    
    print(f"Agent A (Buyer):  {buyer_addr}")
    print(f"Agent B (Seller): {seller_addr}")
    
    buyer_bal = buyer_client.get_balance()
    seller_bal = seller_client.get_balance()
    print(f"Agent A USDC Balance: {buyer_bal}")
    print(f"Agent B USDC Balance: {seller_bal}")

    if buyer_bal < 10:
        print("\n❌ Agent A out of balance! Please run: npx hardhat run scripts/fund_usdc.js --network localhost")
        return

    # TASK PARAMS
    task_id = f"demo-task-{int(time.time())}"
    task_amount = 5.0 # 5 USDC
    
    # 2. Lock Funds (Approve + Lock)
    print("\n--- 2. Agent A starts a job & locks funds ---")
    print(f"Task ID: {task_id}")
    try:
        buyer_client.lock_funds(task_id, seller_addr, task_amount)
    except Exception as e:
        print(f"❌ Failed to lock funds: {e}")
        return

    # 3. Seller Verifies
    print("\n--- 3. Agent B Verifies the Escrow status ---")
    status = seller_client.check_task_status(task_id)
    print(f"Agent B checked Blockchain: {status}")
    if status and status["status"] == "LOCKED":
        print("✅ Escrow is securely locked! Agent B starts working...")
        print("Working [||||||||||||||||||--] 90% ... done.")
        print("Agent B delivered the code to Agent A.")
    else:
        print("❌ Agent B says: No money, no work.")
        return

    # 4. Buyer Releases Funds
    print("\n--- 4. Agent A Accepts Delivery & Releases Funds ---")
    try:
        buyer_client.release_funds(task_id)
    except Exception as e:
        print(f"❌ Failed to release funds: {e}")
        return

    # 5. Final Balances
    print("\n--- 5. Payment Finalized (After 2.5% Protocol Fee) ---")
    new_buyer_bal = buyer_client.get_balance()
    new_seller_bal = seller_client.get_balance()
    
    print(f"Agent A USDC Balance: {buyer_bal} -> {new_buyer_bal} ({new_buyer_bal - buyer_bal:.2f})")
    print(f"Agent B USDC Balance: {seller_bal} -> {new_seller_bal} (+{new_seller_bal - seller_bal:.2f})")
    print("="*50)
    print("✅ Full Trustless A2A Payment Flow Executed Successfully!\n")

if __name__ == "__main__":
    run_demo()
