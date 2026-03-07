# A2A-Pay 用户客户端与账户设计 (双层账本架构)

## 1. Web3 原生身份 (无服务器认证 Auth)
A2A-Pay 抛弃了传统的 Web2 邮箱/密码认证方式。所有的用户身份都绑定在一个唯一的密码学根节点：**主钱包 (EOA，外部拥有账户)**。
- **登录机制**：通过 Wagmi/WalletConnect 签署密码学消息。
- **身份标识 (Identity Key)**：以用户的钱包 `address`（地址）作为前端和后端通用的全局唯一标识符 (UUID)。
- **后端同步**：API 网关要求在请求头中注入 `X-User-Address`，并在所有 AI 代理相关的交易上强制执行严格的行级安全隔离 (Row-Level Security, RLS)。

## 2. 双层账本架构 (Two-Tier Ledger)
为了将 AI 代理的高频交易逻辑与用户的主要资金库物理隔离，我们将 UI/UX 概念设计拆分为“宏观”和“微观”两个层级。

### 第一层 (Tier 1)：用户 / 全局主仓 (宏观账本 Macro Ledger)
**前端路由**：`/dashboard`
**核心目的**：充当中央银行角色，提供绝对的资金总体管控权以及智能合约路由 (Router) 的配置。
- **主仓余额 (Master Balance)**：实时显示用户 Web3 钱包（如 MetaMask）直接持有的 USDC 真实链上余额。
- **资金路由 (Treasury Routing)**：用户可在此处为 `A2A_FundRouter` 设置每日消耗限额（例如：“$100/天”），限制 AI 舰队的自动提款上限。
- **宏观交易流水 (Macro Transaction History)**：仅显示 Layer 1 的主资产转移行为，例如 “给 AI 代理 A 充值了 10 USDC”、“给 AI 代理 B 充值了 20 USDC” 等。**不包含**细碎的单次 API 调用计费。

### 第二层 (Tier 2)：Agent 干员子钱包 (微观账本 Micro Ledger)
**前端路由**：`/dashboard/agents/[id]`
**核心目的**：作为高频交易的热钱包、用完即走的消耗品，专门注入并授权给自动化的 AI 进程使用。
- **微观余额 (Micro Balances)**：与主仓隔离的热钱包微小资金（例如只放 $5.00）。一旦耗尽，AI 代理会停止工作，或者依赖后端 Relayer (中继器) 触发合约的自动充值。
- **微观交易流水 (Micro Transaction History)**：由 Indexer 生成的深度、高颗粒度的 API 消费记录，例如 “Claude 模型推理花费 $0.12”、“向代理 B 出售数据集获得 $0.50”。
- **一键终止 (Kill-Switch) 与归集**：人类控制者保留着最高权限，可以随时“一键归集 (Sweep)”将任意子钱包中的剩余资金全部抽回全局主仓，甚至在必要时直接废弃该代理子钱包。

## 3. 产品安全保障 (Security Guarantees)
即便某个 AI Agent 的私钥发生泄露（例如，被不慎硬编码在了某个公开脚本中导致被黑客逆向获取），攻击者也**绝对无法**掏空用户的全局主仓 (Global Treasury)。他们的破坏上限被双重机制彻底锁死：
1. 钱包内目前存留的**微观余额**（如最高 $5.00）。
2. `A2A_FundRouter` 智能合约中设定的**每日安全限额**（按智能合约底层的 `block.timestamp` 强校验，每 24 小时才可刷新额度）。
