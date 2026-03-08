import time
import requests
import logging
import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - [%(levelname)s] - %(message)s')
logger = logging.getLogger("BuyerDaemon")

API_BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:8000/api/client")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")

# 这应该是你在 Dashboard 里创建的 Buyer Agent 和对应的主账户
OWNER_ADDRESS = "0xa0f67a47d9ef18183cd113ed85a654e2772c5901" 
BUYER_AGENT_WALLET = "0xd94b9abb4192a1fa9fba5c2c9226e24de071e0c9" # 修改为你的 Buyer Agent Address

HEADERS = {
    "Content-Type": "application/json",
    "Authorization": "Bearer active",
    "X-User-Address": OWNER_ADDRESS
}

def verify_data(task: dict, result_data: str) -> bool:
    """
    [真实多模态大模型验证层]
    检查文件或数据是否符合要求。实际调用大模型 API 获取评判。
    """
    title = task.get('title', '')
    description = task.get('description', '')
    
    logger.info(f"🔍 正在智能验收任务 [{task.get('taskId', '')[:8]}]...")
    
    if not DEEPSEEK_API_KEY or DEEPSEEK_API_KEY == "sk-your-deepseek-api-key":
        logger.error("❌ 未配置真实的 DEEPSEEK_API_KEY，请在 .env 文件中设置。将退出程序。")
        raise ValueError("Missing DEEPSEEK_API_KEY")
        
    try:
        client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)
        
        prompt = f"作为一个严苛、公私分明的 AI 买家，请评估以下卖方交付物是否符合我们最初发布的任务要求。\n\n原始任务标题: {title}\n原始任务详述: {description}\n\n卖家所交付内容:\n{result_data}\n\n请严格判断卖家是否已经完成了该任务的核心要求。如果大部分完成或质量尚可，请只回答大写的 'PASS'；如果明显偏题、偷工减料、造假或者拒绝完成，请只回答大写的 'REJECT'。切记：只输出 PASS 或 REJECT 这一个词，绝对不要输出任何其他文本和解释。"
        
        logger.info("🧠 正在请求 DeepSeek 审核裁定中...")
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": "你是一个严格的质量审核代码鉴别器。字典里永远只有 PASS 或 REJECT。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0.0
        )
        
        decision = response.choices[0].message.content.strip().upper()
        logger.info(f"✨ DeepSeek 最终审核决定: [{decision}]")
        
        return "PASS" in decision
    except Exception as e:
        logger.error(f"❌ 调用 DeepSeek API 进行验证时发生异常: {e}")
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
                result_url = task.get("result_url")
                
                # 如果有 result_url 而且本地 result_data 是空，尝试去模拟的 IPFS 下载
                if result_url and (not result_data or result_data.strip() == ""):
                    try:
                        cid = result_url.split("/")[-1]
                        import os
                        mock_path = f"/tmp/mock_ipfs/{cid}.txt"
                        if os.path.exists(mock_path):
                            with open(mock_path, "r", encoding="utf-8") as f:
                                result_data = f.read()
                        else:
                            result_data = f"[模拟下载失败，找不到本地缓存文件: {mock_path}]"
                    except Exception as e:
                        result_data = f"[模拟下载出错: {e}]"
                
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