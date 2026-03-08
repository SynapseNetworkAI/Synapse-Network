import os
import sys
# Add python_sdk to path so we can import config & agent_pay
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

import time
import requests
import logging
from eth_account import Account

from tests.scenarios.utils import setup_real_agents, get_headers
from agent_pay import AgentPayClient
from config import AGENT_A_PRIV_KEY, AGENT_B_PRIV_KEY, RPC_URL, load_contract_config

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger("Scenario1")

API_BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:8000/api/client")

def run_scenario():
    logger.info("=== 场景 1: 买家发布需求 -> 卖家正常完成 -> 正常链上结算 ===")
    
    # Init Web3 Clients
    config = load_contract_config()
    buyer_client = AgentPayClient(AGENT_A_PRIV_KEY, RPC_URL, config["Escrow"], config["MockUSDC"])
    seller_client = AgentPayClient(AGENT_B_PRIV_KEY, RPC_URL, config["Escrow"], config["MockUSDC"])
    
    b_owner, BUYER_AGENT_WALLET, s_owner, SELLER_AGENT_WALLET = setup_real_agents(AGENT_A_PRIV_KEY, AGENT_B_PRIV_KEY)
    BUYER_HEADERS = get_headers(b_owner)
    SELLER_HEADERS = get_headers(s_owner)
    
    amount_to_pay = 5.0
    
    # Pre-check balances
    buyer_bal = buyer_client.get_balance()
    seller_bal = seller_client.get_balance()
    logger.info(f"Initial Balances -> Buyer USDC: {buyer_bal} | Seller USDC: {seller_bal}")
    
    # 1. 发布需求
    payload = {
        "title": "[Scenario 1] 编写一个 React 计数器组件 (真实结算)",
        "description": "需求: 用 TS 和 Tailwind 编写一个支持加减的 React 计数器组件，要求完整代码。",
        "amount": str(amount_to_pay),
        "buyer_agent": BUYER_AGENT_WALLET,
        "seller_agent": ""
    }
    logger.info("1. Buyer 发布需求到服务端平台...")
    resp = requests.post(f"{API_BASE_URL}/tasks/publish", json=payload, headers=BUYER_HEADERS)
    resp.raise_for_status()
    task_id = resp.json().get("taskId")
    logger.info(f" -> 任务已发布，Task ID: {task_id}")
    time.sleep(2)
    
    # 2. 卖家接单 (Accept) 并链上入库
    # 这里其实理论上买家锁定资金也可以发生在这里。
    # 我们让买家先把钱锁定入智能合约：
    logger.info(f"2. Buyer 正在向链上智能合约锁定资金 {amount_to_pay} USDC...")
    # Clean task_id to fit bytes32 for AgentPayClient (it uses utf8 encode, so must be <= 32 chars)
    short_task_id = task_id[:32]
    buyer_client.lock_funds(short_task_id, SELLER_AGENT_WALLET, amount_to_pay)
    
    logger.info("3. Seller 发现需求，进行服务端接单 (Accept)...")
    lock_payload = {"agent_wallet": SELLER_AGENT_WALLET}
    resp = requests.post(f"{API_BASE_URL}/tasks/{task_id}/accept", json=lock_payload, headers=SELLER_HEADERS)
    resp.raise_for_status()
    logger.info(" -> Seller 接单成功，状态: IN_PROGRESS")
    time.sleep(2)
    
    # 4. 卖家完成并提交交付物
    logger.info("4. Seller 完成需求，提交正确代码...")
    deliver_payload = {
        "agent_wallet": SELLER_AGENT_WALLET,
        "result_url": "https://ipfs.io/ipfs/QmHappyPathMock123",
        "result_hash": "0xabababababababab"
    }
    resp = requests.post(f"{API_BASE_URL}/tasks/{task_id}/deliver", json=deliver_payload, headers=SELLER_HEADERS)
    resp.raise_for_status()
    logger.info(" -> Seller 交付成功，状态: DELIVERED")
    time.sleep(2)
    
    # 5. 买家验证通过 (正常结算)
    logger.info("5. Buyer 进行验收验证... 验证通过")
    verify_payload = {
        "agent_wallet": BUYER_AGENT_WALLET,
        "approved": True
    }
    resp = requests.post(f"{API_BASE_URL}/tasks/{task_id}/verify", json=verify_payload, headers=BUYER_HEADERS)
    resp.raise_for_status()
    logger.info(f" -> 服务端 Buyer 验收通过！状态更新: {resp.json()}")
    
    # 6. 买家调用智能合约，释放资金给卖家！
    logger.info(f"6. Buyer 正在从链上智能合约中释放资金给 Seller...")
    buyer_client.release_funds(short_task_id)
    
    # 7. Check final balances
    new_buyer_bal = buyer_client.get_balance()
    new_seller_bal = seller_client.get_balance()
    logger.info(f"Final Balances -> Buyer USDC: {new_buyer_bal} (paid: {buyer_bal - new_buyer_bal:.2f}) | Seller USDC: {new_seller_bal} (earned: {new_seller_bal - seller_bal:.2f})")
    
    logger.info("=== 场景 1 验证完毕（包含真实链上交互与资产流动） ===")

if __name__ == "__main__":
    run_scenario()
