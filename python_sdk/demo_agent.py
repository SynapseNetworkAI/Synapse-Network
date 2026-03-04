import os
import json
import random
from dotenv import load_dotenv

# 引入 LangChain / LangGraph 组件
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import SystemMessage

# 引入我们的业务逻辑
from agent_pay import AgentPayClient
from langchain_tools import agent_pay_tools, init_langchain_tools

def load_contract_config():
    """读取本地硬编码的智能合约地址配置"""
    config_path = "../frontend/src/contract-config.json"
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Config config file not found at {config_path}")

    with open(config_path, "r") as f:
        return json.load(f)

def run_agent():
    print("====================================")
    print("🤖 AgentPay LangChain Demo Starting ")
    print("====================================\n")

    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_BASE_URL")
    model_name = os.getenv("ALL_MODEL_NAME", "gpt-4o")

    # 针对国内白嫖和廉价方案的兼容
    if not api_key:
        print("❌ Please set an OPENAI_API_KEY (or compatible equivalent) environment variable.")
        print("💡 推荐的免费/便宜替代替代方案（完全兼容，无需改代码）：")
        print("1. DeepSeek: export OPENAI_BASE_URL='https://api.deepseek.com/v1', ALL_MODEL_NAME='deepseek-chat', 申请Key: platform.deepseek.com")
        print("2. 硅基流动: export OPENAI_BASE_URL='https://api.siliconflow.cn/v1', ALL_MODEL_NAME='Qwen/Qwen2.5-7B-Instruct', 申请Key: cloud.siliconflow.cn")
        return

    # 1. 读取环境和合约配置
    config = load_contract_config()
    usdc_addr = config.get("MockUSDC")
    escrow_addr = config.get("Escrow")
    
    # 仍旧使用 Hardhat #0 号账户作为 Buyer (本 Agent 的私钥)
    buyer_pk = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    
    # 模拟一个外部 Seller 的地址
    seller_addr = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" 

    # 2. 初始化底层 SDK，并将单例注入给 LangChain Tool 环境
    client = AgentPayClient(
        rpc_url="http://127.0.0.1:8545",
        private_key=buyer_pk,
        usdc_address=usdc_addr,
        escrow_address=escrow_addr
    )
    init_langchain_tools(client)

    # 3. 配置 LLM 引擎 (全能兼容版)
    print(f"💡 Interacting with LLM Model: {model_name}" + (f" at {base_url}" if base_url else ""))
    
    llm = ChatOpenAI(
        model=model_name, 
        temperature=0, 
        api_key=api_key,
        base_url=base_url if base_url else None
    )

    # 4. 构建 Agent Prompt 系统提示词
    sys_prompt = """
You are a Web3 native AI Assistant managing a corporate budget.
You are authorized to interact with the Escrow Smart Contract to lock and release funds.

When users request you to pay for tasks, you should:
1. Try to lock funds according to the prompt (using the lock_funds_for_task tool).
2. Report the resulting Transaction Hash to the user.
3. If they ask about your balance, check it (using get_agent_balance).
"""

    # 5. 生成 Tool Calling Agent (基于 LangGraph 最新推荐架构)
    agent_executor = create_react_agent(llm, tools=agent_pay_tools)

    # ==========================
    # 🎉 Demo 运行用例
    # ==========================
    task_id = f"ai-task-{random.randint(100, 999)}"
    test_prompt = f"""
    Please lock 20.0 USDC for my project task '{task_id}'.
    Send it to this reliable seller address: {seller_addr}.
    After it's done, tell me my remaining balance.
    """

    print("👤 [User Prompt]:\n", test_prompt)

    # 执行大模型代理, 将 SystemPrompt 塞入消息历史最前面
    response = agent_executor.invoke({"messages": [
        ("system", sys_prompt),
        ("user", test_prompt)
    ]})

    print("\n-------------------------------------")
    # LangGraph 返回的消息列表里最后一个即是最终回复
    final_reply = response["messages"][-1].content
    print("🤖 [Agent Reply]:\n", final_reply)
    print("-------------------------------------")

if __name__ == "__main__":
    run_agent()
