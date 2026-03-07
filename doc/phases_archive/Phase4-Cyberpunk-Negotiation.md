# Phase 4: A2A Cyberpunk Black Market Negotiation

## 演进背景 (Background)
在 Phase 3 中，我们展示了单一 Agent 能够理解自然语言并自主调用大模型工具进行 Web3 转账。但真实的 Autonomous Agent（自主智能体）网络必然是网状（Networked）的架构。
在 Phase 4，我们将展示最核心的 **A2A-Pay (AI to AI Payment)** 场景：两个持有相反立场、拥有不同提示词参数的 LLM 在“赛博黑市”中直接对等地沟通。整个过程不需要人类编写“如果A则报错B”的硬编码逻辑，全靠纯大模型的自然语言推演。

## 角色设计 (Agents Roster)

1. **Buyer Agent (企业雇主)**
   * **性格**：无情的企业 AI，精打细算。
   * **能力**：它持有在 Phase 2 创建好的 `AgentPayClient` 和私钥，能够将 USDC 锁仓，能够查余额。
   * **目标**：以低于 50 USDC（最好 20 USDC 以内）的价格招募一台机器替它完成任务 `cyber-scrape-001`。一旦交易敲定，则自动执行智能合约。

2. **Seller Agent (黑客/服务提供者)**
   * **性格**：孤高的网络极客。
   * **能力**：懂得漫天要价，并持有自己的独立以太坊收款地址。
   * **目标**：不接受低于 30 USDC 的低级活。只在确实看到以太坊上锁仓确认后，才开始干活。

## 工作流引擎 (Workflow Engine)
我们使用 **LangGraph `create_react_agent`** 以及大模型的原生状态传递组合这个极简的事件循环：

```text
       ┌───────────────询价 (15 USDC)───────────────┐
       │                                            ▼
[ Buyer Agent ] ◀─────还价 (太少了，最低 40)──── [ Seller Agent ]
(携带 Web3 Tool)                                (纯文本议价模型)
       │                                            │
       └─────同意 (成交，35 USDC，提供地址)─────────▶│
       │                                            │
   (Tool Calling)                                   │
调用 lock_funds_for_task                      (等待资金到账)
       │                                            │
  [以太坊本地节点] ◀──签发交易                       │
       │                                            │
       └──────告知 TX Hash─────────────────────────▶│
```

## 平台端联动 (Platform Integration)
这段代码完全在 Python 或后端微服务中独立跑，不需要人类去点击任何按钮。但此时如果你打开我们在 Phase 1 中留在一旁的 Next.js 监控大屏，你会看到：
当双方达成共识，大屏立刻刷新 **「Task Created」** 的链上数据拦截。这是由于以太坊节点被跨语言（Ethers.js v6 和 Web3.py）无缝打通。

## 后续如何启动
1. 确保 Hardhat 本地网路还在运行（包含 MockUSDC 等合约）。
2. 在 `python_sdk` 目录下运行：
`python multi_agent_negotiation.py`
3. 观看两个 AI 神仙打架和智能合约自动执行的魔法！