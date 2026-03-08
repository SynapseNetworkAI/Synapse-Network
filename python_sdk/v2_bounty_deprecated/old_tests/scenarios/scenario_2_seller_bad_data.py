import os
import time
import requests
import logging
from tests.scenarios.utils import setup_test_agents, get_headers

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger("Scenario2")

API_BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:8000/api/client")

def run_scenario():
    logger.info("=== 场景 2: 卖家提供不符合需求的数据 -> 买家拒绝验收发起仲裁 ===")
    
    b_owner, BUYER_AGENT_WALLET, s_owner, SELLER_AGENT_WALLET = setup_test_agents()
    BUYER_HEADERS = get_headers(b_owner)
    SELLER_HEADERS = get_headers(s_owner)
    
    # 1. 发布需求
    payload = {
        "title": "[Scenario 2] 帮我写一篇关于黑洞物理学的高质量科普文章",
        "description": "需求: 不少于1000字，要求深度分析事件视界和霍金辐射。",
        "amount": "0.02",
        "buyer_agent": BUYER_AGENT_WALLET,
        "seller_agent": ""
    }
    logger.info("1. Buyer 发布严谨需求...")
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
    
    # 3. 卖家敷衍了事，返回烂数据
    logger.info("3. Seller 偷工减料，返回不符合要求的数据...")
    deliver_payload = {
        "agent_wallet": SELLER_AGENT_WALLET,
        "result_url": "https://ipfs.io/ipfs/QmBadDataMock456",
        "result_hash": "0xcdcdcdcdcdcdcdcd"
    }
    resp = requests.post(f"{API_BASE_URL}/tasks/{task_id}/deliver", json=deliver_payload, headers=SELLER_HEADERS)
    resp.raise_for_status()
    logger.info(" -> Seller 敷衍完成，状态变更为: DELIVERED")
    time.sleep(2)
    
    # 4. 买家验证不通过，发起仲裁
    logger.info("4. Buyer 进行 AI 验收...")
    # Mock AI verified it as failing: "approved": False
    verify_payload = {
        "agent_wallet": BUYER_AGENT_WALLET,
        "approved": False
    }
    resp = requests.post(f"{API_BASE_URL}/tasks/{task_id}/verify", json=verify_payload, headers=BUYER_HEADERS)
    resp.raise_for_status()
    logger.info(f" -> Buyer 验收拒绝 (质量烂)，任务进入仲裁状态！返回数据: {resp.json()}")
    logger.info("=== 场景 2 验证完毕 (等待 Jury 接入处理) ===")

if __name__ == "__main__":
    run_scenario()
