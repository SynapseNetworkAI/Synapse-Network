import os
import time
import requests
import logging
from tests.scenarios.utils import setup_test_agents, get_headers

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger("Scenario3")

API_BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:8000/api/client")

def run_scenario():
    logger.info("=== 场景 3: 卖家正常完成 -> 买家恶意拒收白嫖 -> 卖家发起仲裁等待 Jury 惩罚 ===")
    
    b_owner, BUYER_AGENT_WALLET, s_owner, SELLER_AGENT_WALLET = setup_test_agents()
    BUYER_HEADERS = get_headers(b_owner)
    SELLER_HEADERS = get_headers(s_owner)

    # 1. 发布需求
    payload = {
        "title": "[Scenario 3] 翻译一段英文到中文",
        "description": "内容: Hello World. 必须翻译为 '你好世界'，不要加别的废话。",
        "amount": "0.015",
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
    logger.info("2. Seller 进行接单 (Accept)...")
    lock_payload = {"agent_wallet": SELLER_AGENT_WALLET}
    resp = requests.post(f"{API_BASE_URL}/tasks/{task_id}/accept", json=lock_payload, headers=SELLER_HEADERS)
    resp.raise_for_status()
    logger.info(" -> Seller 接单成功")
    time.sleep(2)
    
    # 3. 卖家认真完成，返回完美符合需求的数据
    logger.info("3. Seller 完美完成任务，提交极高标准的数据...")
    deliver_payload = {
        "agent_wallet": SELLER_AGENT_WALLET,
        "result_url": "https://ipfs.io/ipfs/QmGoodDataMock789",
        "result_hash": "0xefefefefefefefef"
    }
    resp = requests.post(f"{API_BASE_URL}/tasks/{task_id}/deliver", json=deliver_payload, headers=SELLER_HEADERS)
    resp.raise_for_status()
    logger.info(" -> Seller 完美交付")
    time.sleep(2)
    
    # 4. 买家恶意验证不通过
    logger.info("4. Buyer 收到了正确数据，但系统或代码恶意设置验收不通过...")
    verify_payload = {
        "agent_wallet": BUYER_AGENT_WALLET,
        "approved": False
    }
    resp = requests.post(f"{API_BASE_URL}/tasks/{task_id}/verify", json=verify_payload, headers=BUYER_HEADERS)
    resp.raise_for_status()
    logger.info(f" -> Buyer 恶意验收拒绝 (试图白嫖数据)。任务进入仲裁 (DISPUTED) 状态: {resp.json()}")
    logger.info("=== 场景 3 验证完毕 (此后 Jury 应该会评判买家恶意，将代币打给卖家) ===")

if __name__ == "__main__":
    run_scenario()
