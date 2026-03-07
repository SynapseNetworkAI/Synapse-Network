import time
import requests
import logging
import os

logging.basicConfig(level=logging.INFO, format='%(asctime)s - [%(levelname)s] - %(message)s')
logger = logging.getLogger("BuyerDaemon")

API_BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:8000/api/client")

# 这应该是你在 Dashboard 里创建的 Buyer Agent 和对应的主账户
OWNER_ADDRESS = "0xa0f67a47d9ef18183cd113ed85a654e2772c5901" 
BUYER_AGENT_WALLET = "0xD65C5ED9A14E6A8c671956d24D303Fdb10BC112f" # 修改为你的 Buyer Agent Address

HEADERS = {
    "Content-Type": "application/json",
    "Authorization": "Bearer active",
    "X-User-Address": OWNER_ADDRESS
}

def verify_data(task: dict, result_data: str) -> bool:
    """
    [多模态大模型验证层 Mock]
    检查文件（通常是通过 result_data 中的 URL 拉取资源）或者数据是否符合要求。
    由于这是一个演示，如果数据看起来有效则返回 True, 否则返回 False
    """
    logger.info(f"🔍 正在验证任务 [{task.get('taskId')[:8]}] - 卖家交付数据: {result_data}")
    time.sleep(2) # 模拟用 LLM 解析验证时间
    
    # 模拟简单的校验规则
    if result_data and "Hello Buyer" in result_data:
        return True
    return False

def poll_and_verify():
    logger.info("=" * 60)
    logger.info(f"🤖 A2A-Pay Buyer Daemon 启动，进入全自动验收模式！")
    logger.info(f"📌 所属权 Ower: {OWNER_ADDRESS}")
    logger.info(f"📌 持有买家钱包: {BUYER_AGENT_WALLET}")
    logger.info("=" * 60)
    
    failed_attempts = 0

    while True:
        try:
            # 1. 查询自己发布的所有任务
            resp = requests.get(f"{API_BASE_URL}/tasks?agent={BUYER_AGENT_WALLET}", headers=HEADERS)
            if resp.status_code != 200:
                logger.error(f"拉取自己任务列表失败: {resp.text}")
                time.sleep(5)
                continue
                
            tasks = resp.json()
            
            # 2. 筛选出处于已交付 (DELIVERED) 状态的任务
            delivered_tasks = [t for t in tasks if t.get("status") == "DELIVERED" and t.get("buyer") == BUYER_AGENT_WALLET.lower()]
            
            if not delivered_tasks:
                # 静默轮询，不刷屏
                time.sleep(3)
                continue
                
            for task in delivered_tasks:
                task_id = task.get("taskId")
                result_data = task.get("result_data", "")
                
                logger.info(f"📥 发现待验收任务！Seller 已经提交。Task ID: {task_id[:8]}...")
                
                # 3. 运行自动验收逻辑
                is_valid = verify_data(task, result_data)
                
                # 4. 根据结果打款(RELEASED)或者申诉(DISPUTED)
                payload = {
                    "agent_wallet": BUYER_AGENT_WALLET,
                    "approved": is_valid
                }
                decision_str = "同意验收打款 (RELEASED)" if is_valid else "拒绝验收发起仲裁 (DISPUTED)"
                logger.info(f"⚖️ AI 判断结果: {decision_str}")
                
                verify_res = requests.post(
                    f"{API_BASE_URL}/tasks/{task_id}/verify", 
                    json=payload, 
                    headers=HEADERS
                )
                
                if verify_res.status_code == 200:
                    logger.info(f"✅ 任务 {task_id[:8]}... 审核后流转成功！链上资金流转中...\n")
                else:
                    logger.error(f"❌ 审核流转失败或被系统拒绝: {verify_res.text}")
                        
        except requests.exceptions.ConnectionError:
            failed_attempts += 1
            logger.warning(f"网络断连，后端服务未开启？(重试次数: {failed_attempts})")
            time.sleep(5)
        except Exception as e:
            logger.error(f"Daemon 内部严重异常: {e}")
            time.sleep(5)
            
        time.sleep(3) 

if __name__ == "__main__":
    poll_and_verify()