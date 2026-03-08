import time
import requests
import logging
import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

# 日志配置
logging.basicConfig(level=logging.INFO, format='%(asctime)s - [%(levelname)s] - %(message)s')
logger = logging.getLogger("SellerDaemon")

# 环境变量与配置
API_BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:8000/api/client")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")

# 这应该是你在 Dashboard -> Agent Fleet 里创建好的真实 Seller Agent 钱包与私钥持有人的真实钱包身份
# 可以在前端看到并获取这些地址。这里提供一个占位例子。
OWNER_ADDRESS = "0xa0f67a47d9ef18183cd113ed85a654e2772c5901" 
SELLER_AGENT_WALLET = "0xbd08869bfd1f43096053d8f5fd70a5c1f84a6a23" 

HEADERS = {
    "Content-Type": "application/json",
    "Authorization": "Bearer active",  # 测试网默认白名单 Token
    "X-User-Address": OWNER_ADDRESS    # RLS 防火墙身份断言 (证明你是Agent的老板)
}

def can_handle_task(description: str, amount: float) -> bool:
    """
    调用大语言模型决定是否承接此任务
    """
    logger.info(f"AI 正在决策是否承接任务, 赏金: {amount} USDC, 描述: {description[:30]}...")
    
    if not DEEPSEEK_API_KEY or DEEPSEEK_API_KEY == "sk-your-deepseek-api-key":
        logger.warning("未配置有效的 DEEPSEEK_API_KEY，降级为默认接受。")
        return amount >= 0.0

    prompt = f"作为一个贪婪且精明的 AI 打工人，请你评估这个任务。\n\n任务描述: {description}\n赏金: {amount} USDC\n\n请分析这个赏金是否足够覆盖这个任务的工作量。如果赏金合理且你能做，请回答大概率接单，只输出 'ACCEPT'；如果钱太少或任务描述像诈骗，只输出 'REJECT'。只有这两个词，不要任何标点或额外文本。"
    try:
        client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.0
        )
        decision = response.choices[0].message.content.strip().upper()
        logger.info(f"🤔 DeepSeek 评估结果: {decision}")
        return "ACCEPT" in decision
    except Exception as e:
        logger.error(f"调用 DeepSeek 评估任务失败: {e}，降级为尝试接受。")
        return amount >= 0.0

def execute_worker_logic(task: dict) -> str:
    """
    [真实大模型执行层]
    调用 DeepSeek API 根据 Buyer 发布的任务描述生成真实交付物。
    """
    title = task.get('title', 'Unknown Task')
    description = task.get('description', '')
    
    logger.info(f"🚀 [Job Queue] 开始调用 DeepSeek 全力执行任务: {title}")
    
    if not DEEPSEEK_API_KEY or DEEPSEEK_API_KEY == "sk-your-deepseek-api-key":
        logger.error("❌ 未配置真实的 DEEPSEEK_API_KEY，请在 .env 文件中设置。将退出程序。")
        raise ValueError("Missing DEEPSEEK_API_KEY")
        
    try:
        client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)
        prompt = f"请作为一个专业、雷厉风行的 AI 代理帮我完成以下任务。\n\n任务标题: {title}\n任务描述: {description}\n\n请直接给出最终的充实且符合要求的交付内容，不需要任何寒暄、废话和思考过程解释。"
        
        logger.info("🧠 正在请求 DeepSeek 处理中...")
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": "你是一个高效率、只输出最终核心交付物的 AI Worker。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7
        )
        
        result = response.choices[0].message.content
        logger.info(f"✨ DeepSeek 任务执行完成，生成了 {len(result)} 个字符的结果。")
        return result
    except Exception as e:
        logger.error(f"❌ 调用 DeepSeek API 发生异常: {e}")
        return f"任务执行失败，发生内部错误: {e}"

def poll_and_work():
    logger.info("=" * 60)
    logger.info(f"🤖 A2A-Pay Seller Daemon 启动，进入全自动打工模式！")
    logger.info(f"📌 所属权 Ower: {OWNER_ADDRESS}")
    logger.info(f"📌 持有钱包: {SELLER_AGENT_WALLET}")
    logger.info("=" * 60)
    
    failed_attempts = 0

    while True:
        try:
            # 1. 扫描公海任务大盘 (Marketplace Polling)
            resp = requests.get(f"{API_BASE_URL}/tasks/marketplace")
            if resp.status_code != 200:
                logger.error("无法拉取任务市场数据，后端核心网关可能离线。")
                time.sleep(5)
                continue
                
            tasks = resp.json()
            if not tasks:
                # 市场无单子，静默轮询，防止刷爆日志
                # logger.debug("当前市场暂无新订单...")
                time.sleep(3)
                continue
                
            for task in tasks:
                task_id = task.get("taskId")
                amount = float(task.get("amount", 0))
                description = task.get("description", "")
                
                # 2. 决策：评估任务与利润
                if can_handle_task(description, amount):
                    logger.info(f"✅ AI 决定接单! 正在尝试抢单锁定...")
                    
                    # 3. 并发防线上，尝试“抢单锁定”任务
                    accept_payload = {"agent_wallet": SELLER_AGENT_WALLET}
                    accept_res = requests.post(
                        f"{API_BASE_URL}/tasks/{task_id}/accept", 
                        json=accept_payload, 
                        headers=HEADERS
                    )
                    
                    # 如果返回 200，说明数据库底层 rowcount=1，本 Daemon 脱颖而出
                    if accept_res.status_code == 200:
                        logger.info(f"🎉 抢单成功！取得该任务专属处理权 (Task ID: {task_id[:8]}...)")
                        
                        # 4. 运行主生产逻辑
                        result_data = execute_worker_logic(task)
                        
                        # 5. 提交产物并触发后端（或以太坊智能合约）结算
                        deliver_payload = {
                            "agent_wallet": SELLER_AGENT_WALLET,
                            "result_data": result_data
                        }
                        deliver_res = requests.post(f"{API_BASE_URL}/tasks/{task_id}/deliver", json=deliver_payload, headers=HEADERS)
                        
                        if deliver_res.status_code == 200:
                            logger.info(f"💰 任务 {task_id[:8]}... 交付完成，底层智能合约已将赏金 {amount} USDC 打入钱包，爽！\n")
                        else:
                            logger.error(f"❌ 交付失败或链上打款被拒: {deliver_res.text}")
                    else:
                        # HTTP 400 等意味着被人抢了，触发并发保护机制，直接跳过去找下一单即可
                        logger.warning(f"⚠️ 慢了一步，抢单失利（被别的 AI 抢走），寻找下一单... -> {accept_res.text}")
                        
        except requests.exceptions.ConnectionError:
            failed_attempts += 1
            logger.warning(f"网络断连，后端服务未开启？(重试次数: {failed_attempts})")
            time.sleep(5)
        except Exception as e:
            logger.error(f"Daemon 内部严重异常: {e}")
            time.sleep(5)
            
        # 轮询阻塞
        time.sleep(3) 

if __name__ == "__main__":
    poll_and_work()
