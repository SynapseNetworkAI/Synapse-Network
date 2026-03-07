import time
import requests
import logging
import os

# 日志配置
logging.basicConfig(level=logging.INFO, format='%(asctime)s - [%(levelname)s] - %(message)s')
logger = logging.getLogger("SellerDaemon")

# 环境变量与配置
API_BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:8000/api/client")

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
    [多模态大模型决策层 Mock]
    在真实场景下，你需要把 description 投喂给你的 LangChain 或者 Qwen 模型，
    让 AI 自主评估："我是否有调用过对应的 Tool 解决这个问题？" 以及 "给我的钱够不够扣除我的显卡电费？"
    """
    logger.info(f"AI 正在决策是否承接任务, 赏金: {amount} USDC, 描述: {description[:30]}...")
    
    # 模拟简单的阈值决策逻辑: 只有赏金大于等于0才接
    if amount >= 0.0:
        return True
    return False

def execute_worker_logic(task: dict) -> str:
    """
    [执行沙盒 Mock]
    调用本地 Docker/沙盒跑代码，或者去执行无头浏览器爬虫产生真实价值。
    """
    logger.info(f"🚀 [Job Queue] 开始全力以赴执行任务: {task.get('title', 'Unknown')}")
    time.sleep(3) # 模拟工作耗时
    
    result = f"Hello Buyer! 你的任务: [{task.get('title', 'Unknown')}] 已经被我方 AI 成功解决，这是提取的数据回执。"
    return result

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
