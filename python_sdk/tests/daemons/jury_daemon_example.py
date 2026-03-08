import time
import requests
import logging
import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - [%(levelname)s] - %(message)s')
logger = logging.getLogger("A2A-Jury")

API_BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:8000/api/client")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")

def process_dispute(task: dict) -> tuple[str, str]:
    """
    Tier 1 AI Judge Logic
    Returns: (Winner "BUYER" or "SELLER", "Reasoning Content")
    """
    title = task.get('title', '')
    description = task.get('description', '')
    result_data = task.get('result_data', '')
    result_url = task.get('result_url')
    task_id = task.get('taskId', '')

    if result_url and (not result_data or result_data.strip() == ""):
        try:
            cid = result_url.split("/")[-1]
            import os
            mock_path = f"/tmp/mock_ipfs/{cid}.txt"
            if os.path.exists(mock_path):
                with open(mock_path, "r", encoding="utf-8") as f:
                    result_data = f.read()
            else:
                result_data = f"[模拟下载失败: {mock_path}]"
        except Exception as e:
            result_data = f"[模拟下载出错: {e}]"

    if not result_data:
        result_data = ""

    logger.info(f"⚖️ [法庭开庭] 正在卷宗分析 任务 [{task_id[:8]}...]...")
    logger.info(f"📝 原始需求: {title} | 卖家交付证据长度: {len(result_data)}")

    if not DEEPSEEK_API_KEY or DEEPSEEK_API_KEY == "sk-your-deepseek-api-key":
        logger.warning("⚠️ 未配置真实的 DEEPSEEK_API_KEY，降级为随机或默认裁决")
        time.sleep(2)
        # 默认偏袒买方 (Mock)
        return "BUYER", "未接入大模型的 Mock 判决，默认买家胜诉退款。"

    try:
        client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)
        
        prompt = f"""
你现在是 A2A-Pay 平台的最高级 AI 仲裁法官 (AI Jury)。
有一笔外包代码任务发生了争执。买方 (买方 Agent) 拒绝了卖方 (卖方 Agent) 交付的数据，并要求全额退款。卖方则抗议退款，目前这笔资金被锁定在以太坊智能合约中。

[原告 (买方) 的需求描述]:
标题: {title}
详情: {description}

[被告 (卖方) 实际交付的成果]:
{result_data}

请作为无感情、无利益冲突的客观法官，执行以下判断：
1. 卖方的交付物是否实质性地完成了需求？（哪怕有小瑕疵，只要核心功能代码给出了，就在道义上算完成，不能允许买方白嫖代码然后恶意退款）
2. 如果交付物完全牛头不对马嘴、瞎编乱造或者只是空壳，则买方的拒绝是合理的。

请深入分析，然后在结尾给出最终的硬性判决！
你必须在结尾严格另起一行，只输出: "WINNER: BUYER" 或者 "WINNER: SELLER"。
- 输出 "WINNER: BUYER" 表示买家拒收合理，合约应把资金退还给买家。
- 输出 "WINNER: SELLER" 表示卖家交付合理，买家是想白嫖代码，合约应强制把资金打给卖家。
"""
        logger.info("🧠 正在请求 DeepSeek-Chat 推理大模型进行深层证据穿透与审判...")
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": "你是公正的去中心化最高法庭法官。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1
        )
        
        reasoning_and_decision = response.choices[0].message.content.strip()
        logger.info(f"✨ 法官判词已生成, 长度: {len(reasoning_and_decision)} 字符")
        
        # 截取最后的判决
        winner = "BUYER"
        if "WINNER: SELLER" in reasoning_and_decision.upper():
            winner = "SELLER"
        
        logger.info(f"👨‍⚖️ 最终判决：胜诉方为 {winner}!")
        return winner, reasoning_and_decision

    except Exception as e:
        logger.error(f"❌ 调用 DeepSeek API 进行法庭验证时发生异常: {e}")
        # 系统出错，默认保护买方资金
        return "BUYER", f"法庭系统异常: {str(e)}"

def poll_for_disputes():
    logger.info("=" * 60)
    logger.info("🏛️  A2A-Pay AI Jury Daemon 启动，监控全网 DISPUTED 案件...")
    logger.info("=" * 60)
    
    while True:
        try:
            resp = requests.get(f"{API_BASE_URL}/tasks/disputed")
            if resp.status_code != 200:
                logger.error("拉取法庭争议案件失败。")
                time.sleep(5)
                continue
                
            tasks = resp.json()
            if not tasks:
                time.sleep(3)
                continue
                
            for task in tasks:
                task_id = task.get("taskId")
                
                winner, reason = process_dispute(task)
                
                # 请求后端解决争议，触发链上结算（此处演示层面直接提交 API）
                res_resp = requests.post(f"{API_BASE_URL}/tasks/{task_id}/resolve", json={
                    "winner": winner,
                    "reason": reason
                })
                
                if res_resp.status_code == 200:
                    logger.info(f"✅ 案件 [{task_id[:8]}] 已结案并广播！合约资金流已清算 ({winner} 收到资金)。这笔判词将永远记录在链上！\n")
                else:
                    logger.error(f"❌ 结案同步到平台失败: {res_resp.text}")

        except requests.exceptions.ConnectionError:
            logger.warning("网络断连，后端服务未开启？")
            time.sleep(5)
        except Exception as e:
            logger.error(f"法庭内部异常: {e}")
            time.sleep(5)
            
        time.sleep(5)

if __name__ == "__main__":
    poll_for_disputes()
