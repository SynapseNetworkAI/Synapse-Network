# 🧠 Synapse - Owner Overview & Agent Workspace 交互架构设计

> **核心原则**: Owner 是资产的主人，是控制面的持有人。Agent 才是运行时真正去消费的主体。不再有“买家/卖家钱包壁垒”，一切归于统一的 Owner 身份。

## 一、 架构与空间划分 (Information Architecture)

整个前端控制台划分为“一个枢纽、两个业务隔离工作区”。

1. **Owner Overview (控制面板 / 路由页)**：用户的进站大盘，承载总资产观测与全局路由。
2. **Agent Workspace (原 Developer Console)**：专门管理“花钱”与“消费执行”的工作区。
3. **Provider Workspace**：专门管理“赚钱”与“服务供给”的工作区。
4. **Finance & Refunds**：对账、充提等跨区底层功能。

---

## 二、 首页：Owner Overview 设计

**目标**：极简、去臃肿化。用户登录后，无需在此页做任何重度操作，它的唯一目的是“展示核心状态并把用户路由到 Agent 首次调用的主线任务上”。

### 1. Owner Identity Card (持有人身份卡片)
*   **钱包标识**: `0xd856...a092` (主钱包地址，代表 Owner 身份)
*   **会话状态**: `Session: Signed and Active` (后端 Gateway 持有的真实会话态)
*   **可用余额**: `Spendable: x.xx USDC` (可供给 Agent 调用的消费池余额)

### 2. Workspace 路由组 (Workspace Navigation)
不再显示平铺的大列表，而是提供三个大型的清晰路由区块（Cards / Buttons），引导跳转：
*   🚀 **Open Agent Workspace** (核心 CTA：去往你的消费环境)
*   📦 **Open Provider Workspace** (供给侧入口：发布服务与查看收益)
*   💳 **Open Finance & Refunds** (去财务大厅：充值与退款记录)

### 3. 主线目标引导 (Next Outcome)
*   左/下方用大标题提示："**The page should push you toward first autonomous paid invocation.**"
*   说明文档：“Synapse is the settlement layer for AI agents. Fund runtime spend, inspect service supply... without splitting yourself into fake buyer and seller accounts.”

---

## 三、 消费工作区：Agent Workspace 设计 (原 Developer Console)

**目标**：一站式解决“资金准备 -> Agent 凭证授权 -> 发起调用”闭环。

### 1. 资金水池 (Spendable Balance)
*   **数值显示**: `0.00 USDC` (仅展示消费侧可用余额，不要混入 Provider 的应收提现金额)
*   **交互按钮**: 
    *   `+ Add Funds` (充值：调用链上向 Vault 打钱)
    *   `💧 Faucet: Get 100 USDC` (测试网专用发水)

### 2. Agent 凭证管理 (Agent Credentials / API Keys)
*   **逻辑变化**: 旧的“生成开发者 API Key”在用户心智上变为 **“为你创建的赛博智能体签发 Runtime 凭证 (Credentials)”**。
*   **UI 列表**: 
    *   显示所有的活跃密钥 (`agt_xxxxxxxxx`) 及其对应状态。
    *   `[Create New Agent Credential]` 按钮完成密钥的签发。

### 3. Quick Start 快速向导 (SDK M2M Flow)
保留原有的快速启动代码块，但文案强调：这不仅是你自己写代码，一旦你把这个 Key 和代码交给你的 Agent 代码库，Agent 就能够自主消费了。

```python
# Install the Synapse core SDK
pip install synapse-client

# Instantiate your agent's client using the Agent Credential
# 💡 充值完成并拿到密钥后，从此你的 Agent 可以直接消费你的 USDC
from synapse_client import SynapseClient

client = SynapseClient(api_key="agt_xxxxxxxxx")
response = client.call_service(
    service_name="DeepSeek-Chat",
    prompt="Hello from an autonomous Agent!"
)
print(response.content)
```
