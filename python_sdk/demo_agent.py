import os
import json
import random
from dotenv import load_dotenv

# 引入 LangChain 组件
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate

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
    github_token = os.getenv("GITHUB_TOKEN")

    if not api_key and not github_token:
        print("❌ Please set either OPENAI_API_KEY or GITHUB_TOKEN environment variable.")
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

    # 3. 配置 LLM 引擎
    # 优先使用 OpenAI官方 Key；否则使用 GitHub Models 的免费企业级 API (由 Azure AI 驱动)
    if api_key:
        llm = ChatOpenAI(model="gpt-4o", temperature=0, api_key=api_key)
    else:
        print("💡 Using GitHub Models API for LLM inference...")
        llm = ChatOpenAI(
            model="gpt-4o", 
            temperature=0, 
            api_key=github_token, 
            base_url="https://models.inference.ai.azure.com"
        )

    # 4. 构建 Agent Prompt 系统提示词
    system_message = """
You are a Web3 native AI Assistant managing a corporate budget.
You are authorized to interact with the Escrow Smart Contract to lock and release funds.

When users request you to pay for tasks, you should:
1. Try to lock funds according to the prompt (using the lock_funds_for_task tool).
2. Report the resulting Transaction Hash to the user.
3. If they ask about your balance, check it (using get_agent_balance).
    """

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_message),
        ("human", "{input}"),
        ("placeholder", "{agent_scratchpad}"),
    ])

    # 5. 生成 Tool Calling Agent
    agent = create_tool_calling_agent(llm, agent_pay_tools, prompt)
    agent_executor = AgentExecutor(agent=agent, tools=agent_pay_tools, verbose=True)

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

    # 执行大模型代理
    response = agent_executor.invoke({"input": test_prompt})

    print("\n-------------------------------------")
    print("🤖 [Agent Reply]:\n", response["output"])
    print("-------------------------------------")

if __name__ == "__main__":
    run_agent()
