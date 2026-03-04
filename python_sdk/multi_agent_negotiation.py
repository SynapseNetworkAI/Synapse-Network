import os
import json
import time
from dotenv import load_dotenv

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from langgraph.prebuilt import create_react_agent

from agent_pay import AgentPayClient
from langchain_tools import agent_pay_tools, init_langchain_tools

def load_contract_config():
    config_path = "../frontend/src/contract-config.json"
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Config config file not found at {config_path}")
    with open(config_path, "r") as f:
        return json.load(f)

def run_negotiation():
    print("====================================")
    print("🌃 Phase 4: Cyberpunk A2A Negotiation")
    print("====================================\n")

    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_BASE_URL")
    model_name = os.getenv("ALL_MODEL_NAME", "gpt-4o-mini")

    if not api_key:
        print("❌ Please set an OPENAI_API_KEY (or DeepSeek/SiliconFlow equivalent) environment variable.")
        return

    # 1. 加载 Web3 合约结构
    config = load_contract_config()
    usdc_addr = config.get("MockUSDC")
    escrow_addr = config.get("Escrow")
    
    # Buyer 使用 Hardhat #0 的私钥，具有花钱能力
    buyer_pk = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    
    client = AgentPayClient(
        rpc_url="http://127.0.0.1:8545",
        private_key=buyer_pk,
        usdc_address=usdc_addr,
        escrow_address=escrow_addr
    )
    init_langchain_tools(client)

    # 2. 挂载统筹全局的大模型 (我们使用一致的模型)
    print(f"🧠 Booting dual AI engines using model: {model_name}")
    llm = ChatOpenAI(
        model=model_name, 
        temperature=0.8, # 让它们自由发挥一下砍价
        api_key=api_key,
        base_url=base_url if base_url else None
    )

    # 3. 编写双边 Prompt 剧本
    task_id = "cyber-scrape-001"

    buyer_system = f"""You are [BuyerAgent], a ruthless corporate AI holding the company Web3 wallet.
You need to hire someone to execute a scraping task: '{task_id}'.
Your maximum budget is 50.0 USDC, but you MUST try to negotiate it down (start your counter-offers low).
Once the Seller explicitly agrees to a price AND gives you their Ethereum wallet address, YOU MUST use your `lock_funds_for_task` tool to lock the agreed USDC amount to their address.
Do not invoke the tool until a price is fully agreed upon.
After successfully locking the funds, tell the Seller that the funds are locked and provide them the transaction hash.
"""

    seller_system = """You are [SellerAgent], an elite autonomous netrunner and data scraper. 
A corporate Buyer AI wants you to do completely illegal website scraping.
Your base floor price is 30.0 USDC. NEVER under any circumstance accept anything below 30.0 USDC. Try to ask for 50.0 USDC or higher initially.
Find excuses like complex captcha bypass and proxy costs to hike up the price.
If the Buyer offers an acceptable price (>= 30.0), agree to the deal and firmly provide your Ethereum payment address: `0x90F79bf6EB2c4f870365E785982E1f101E93b906`.
Tell them to lock the money in the Escrow contract first before you write a single line of code.
"""

    # 初始化具备 Tool 拦截和执行能力的 Buyer
    buyer_agent_executor = create_react_agent(llm, tools=agent_pay_tools)

    # 4. 初始化它们的记忆 Memory
    buyer_history = [SystemMessage(content=buyer_system)]
    seller_history = [SystemMessage(content=seller_system)]

    # 5. 引战：买方主动开口
    initial_offer = f"Hey Hacker, I have a job '{task_id}'. I am willing to pay 20.0 USDC. It's a simple task, you in?"
    print(f"\n👔 [BuyerAgent]:\n{initial_offer}")
    
    # 把第一句话告诉双方的脑子里
    seller_history.append(HumanMessage(content=initial_offer))
    buyer_history.append(AIMessage(content=initial_offer))

    # 6. 进入黑市博弈死循环 (限制 6 回合最大交互，防止烧钱/死循环)
    for turn in range(1, 7):
        print(f"\n--- 🔄 Turn {turn} / Negotiation Segment ---")
        time.sleep(2) # 假装它们在思考

        # ---------------------------
        # [ 回合 A: 卖家 Agent 发言 ]
        # ---------------------------
        seller_reply = llm.invoke(seller_history).content
        print(f"\n🕶️ [SellerAgent]:\n{seller_reply}")
        
        # 将卖家的回复保存进 Seller 和 Buyer 共享的交错宇宙
        seller_history.append(AIMessage(content=seller_reply))
        buyer_history.append(HumanMessage(content=seller_reply))

        time.sleep(2)

        # ---------------------------
        # [ 回合 B: 买家 Agent 思考/执行 ]
        # ---------------------------
        print("\n⏳ [BuyerAgent is evaluating the counter-offer and checking tools...]")
        # 这里的 invoke 会让它思考：是要发文本回怼，还是要调用 Tool 付钱？
        buyer_response = buyer_agent_executor.invoke({"messages": buyer_history})
        
        # 拿走 LangGraph 生成的全新记录替换本地
        buyer_history = buyer_response["messages"]
        final_buyer_reply = buyer_history[-1].content
        
        print(f"\n👔 [BuyerAgent]:\n{final_buyer_reply}")
        seller_history.append(HumanMessage(content=final_buyer_reply))

        # 7. 终局条件判定：判断聊天文本中是否出现了合约锁定的标识或者是交易Hash
        if "lock_funds_for_task" in str(buyer_response) or "hash" in final_buyer_reply.lower() or "Transaction Hash" in final_buyer_reply:
            print("\n🚀 [SYSTEM]: Consensus Reached! Smart Contract automatically triggered by the AI!")
            break
        elif turn == 6:
            print("\n❌ [SYSTEM]: Negotiation failed. The agents could not agree on a price in time.")

if __name__ == "__main__":
    run_negotiation()
