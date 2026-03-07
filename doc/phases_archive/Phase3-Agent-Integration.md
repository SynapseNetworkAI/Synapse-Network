# Phase 3: AI Agent Integration (LangChain / AutoGen / CrewAI)

## 架构概览 (Architecture Overview)

Phase 3 的核心目标是赋予 LLM (大语言模型) 操控 Web3 钱包和智能合约的能力，实现跨 AI 的**意图识别与自动化支付**。在这一阶段，由之前单纯的脚本控制，进化为完全由自然语言驱动的自主执行。

工作流如下：
1. **Natural Language Input**: 用户或另一个 Agent 发送自然语言指令（如："给数据清洗任务 agent-task-001 锁定 5 个 USDC 的奖金，接收方地址是 0x7099..."）。
2. **Intent Recognition (LLM)**: LangChain Agent 接收指令，通过 LLM 解析意图，并提取出关键参数 (`task_id`, `amount`, `seller_address`)，决定是否需要调用外部工具。
3. **Tool Calling (Function Calling)**: Agent 决定调用已绑定在它身上的 `AgentPay` 工具集（包含 `get_balance`, `lock_funds`, `release_funds` 等能力）。
4. **On-chain Execution**: Python 工具函数内部调用 `AgentPayClient` (我们在 Phase 2 构建好的 Web3 SDK)，将参数构造为以太坊交易，用离线私钥签名并广播到区块链（如本地的 Hardhat Node 或 Base 网络）。
5. **Observation & Response**: 交易上链并打包后，SDK 将 Transaction Hash 返回给 Agent。Agent 观测到工具调用的结果后，最终用自然语言回复执行情况。

## 开发路线图 (Roadmap)

在 `python_sdk` 目录下我们将新增：
- `langchain_tools.py`: 利用 Pydantic 和 `@tool` 等 LangChain 装饰器，把 `AgentPayClient` 的底层 Web3 方法重塑为可供 OpenAI 识别调用的工具结构。
- `demo_agent.py`: LangChain 代理系统的入口启动脚本，负责初始化 LLM (如 `gpt-4o-mini`)，绑定专属工具，利用 `create_tool_calling_agent` 和 `AgentExecutor` 等模块启动代理网络。
- 环境变量: 构建 `.env` 机制隐式管理 Agent 必须的 API Keys。

## 关键技术栈
- **LangChain** (`langchain`, `langchain-openai`, `langchain-core`): 处理代理编排、Prompt 管理和工具封装。
- **OpenAI Function Calling**: 利用原生支持的 JSON 模式强类型输出来解析复杂的链上参数。
- **AgentPay SDK (`web3.py`)**: 底层基建，稳定执行链上读写操作。

## 远景扩展 (Phase 4 预览)
当前的单体代理架构 (Single Agent) 直接跑通跑透后，即可无缝重构进 **CrewAI** 或 **AutoGen** 等多智能体 (Multi-Agent) 框架中：
比如设定一个 `BuyerAgent` (代表需求方持有资金) 和一个 `SellerAgent` (代表执行方提供服务)。两者通过多轮对话通信自动完成业务询价、验收甚至纠纷仲裁。当确认达成一致后，`BuyerAgent` 无需人类介入，就能自主呼叫此 `AgentPay` 面板实现资金质押上链。