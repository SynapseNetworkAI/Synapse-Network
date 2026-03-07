import os
import time
import requests
import logging
from tests.scenarios.utils import setup_test_agents, get_headers

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger("Scenario1")

API_BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:8000/api/client")

def run_scenario():
    logger.info("=== 场景 1: 买家发布需求 -> 卖家正常完成 -> 正常结算 ===")
    
    b_owner, BUYER_AGENT_WALLET, s_owner, SELLER_AGENT_WALLET = setup_test_agents()
    BUYER_HEADERS = get_headers(b_owner)
    SELLER_HEADERS = get_headers(s_owner)
    
    # 1. 发布需求
    payload = {
        "title": "[Scenario 1] 编写一个 React 计数器组件",
        "description": "需求: 用 TS 和 Tailwind 编写一个支持加减的 React 计数器组件，要求完整代码。",
        "amount": "0.01",
        "buyer_agent": BUYER_AGENT_WALLET,
        "seller_agent": ""
    }
    logger.info("1. Buyer 发布需求...")
    resp = requests.post(f"{API_BASE_URL}/tasks/publish", json=payload, headers=BUYER_HEADERS)
    resp.raise_for_status()
    task_id = resp.json().get("taskId")
    logger.info(f" -> 任务已发布，Task ID: {task_id}")
    time.sleep(2)
    
    # 2. 卖家接单 (Accept)
    logger.info("2. Seller 发现需求，进行接单 (Accept)...")
    lock_payload = {"agent_wallet": SELLER_AGENT_WALLET}
    resp = requests.post(f"{API_BASE_URL}/tasks/{task_id}/accept", json=lock_payload, headers=SELLER_HEADERS)
    resp.raise_for_status()
    logger.info(" -> Seller 接单成功，状态: IN_PROGRESS")
    time.sleep(2)
    
    # 3. 卖家完成并提交交付物
    logger.info("3. Seller 完成需求，提交正确代码...")
    deliver_payload = {
        "agent_wallet": SELLER_AGENT_WALLET,
        "result_data": "import React, { useState } from 'react';\n\nexport const Counter = () => {\n  const [cnt, set] = useState(0);\n  return <div className=\"p-4\"><button onClick={() => set(cnt+1)}>+1</button></div>;\n};\n"
    }
    resp = requests.post(f"{API_BASE_URL}/tasks/{task_id}/deliver", json=deliver_payload, headers=SELLER_HEADERS)
    resp.raise_for_status()
    logger.info(" -> Seller 交付成功，状态: DELIVERED")
    time.sleep(2)
    
    # 4. 买家验证通过 (正常结算)
    logger.info("4. Buyer 进行验收验证...")
    # Mock AI verified it as passing
    verify_payload = {
        "agent_wallet": BUYER_AGENT_WALLET,
        "approved": True
    }
    resp = requests.post(f"{API_BASE_URL}/tasks/{task_id}/verify", json=verify_payload, headers=BUYER_HEADERS)
    resp.raise_for_status()
    logger.info(f" -> Buyer 验收通过，打款结算成功！返回数据: {resp.json()}")
    logger.info("=== 场景 1 验证完毕 ===")

if __name__ == "__main__":
    run_scenario()
