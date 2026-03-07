# AgentPay Python 端设计与实现文档 (Backend API & SDK)

在项目的演进与多角色隔离（Phase 9 / 16）体系下，`python_sdk` 目录的职责已经从单纯的一个“给 AI 调用的 Web3 SDK”，进化为了包含 Web3 Agent SDK 以及充当前端 Dashboard 后端交互网关的组合工程。

本架构将 Python 层分为两大部分：**AgentPay SDK（工具库）** 和 **FastAPI 网关与 Indexer（中间件服务）**。

## 1. 核心架构拓扑 (Architecture Topology)

整个后端及 Python SDK 围绕着智能合约（Smart Contracts）构成了如下互动网络：

```text
[浏览器前端 Web UI] <---HTTP/JWT---> [ FastAPI (C-API / Admin-API) ] <---SQLite--> [ Indexer Daemon ]
     (Web3 Login)                     (Row-Level Security / API Guards)                (监听链上区块与事件)
                                                    ^                                         |
                                                    | (Data Sync)                             | (Fetch Logs)
[ Python AI Agent ]  <--->  [ AgentPay SDK ]  <---> [ RPC Node (Base/L2/Hardhat) ] <---> [ Smart Contracts ]
(🧠 决策: 需调外部服务)       (📦 组装交易 & 签名)         (🌐 广播交易)                     (🔒 Escrow & ERC20)
```

## 2. AgentPay SDK (客户端/AI 模型依赖端)

此部分依旧保持轻量。它是针对诸如 LangChain, AutoGen 等 AI Agent 的核心集成包，使能够**自主、无缝地完成链上支付**。

### SDK 职责设计：
1. **Wallet Manager**: 管理赋予 Agent 的 Session Key（本地临时零钱包私钥），执行完全离线操作。
2. **免密高频小额结算**: 基于 `AgentPayEscrow` 合约，进行 `lockFunds` 与 `releaseFunds`，解决 AI 与 AI（或 API 服务商）之间的去信任交易。
    
**SDK 核心 API 结构 (`AgentPayClient`):**

```python
class AgentPayClient:
    def __init__(self, private_key: str, rpc_url: str, escrow_addr: str, usdc_addr: str):
        """初始化客户端，挂载身份和合约 (不触碰也不应当持有主用户的冷钱包私钥)"""

    def get_balance(self) -> float:
        """获取当前 Agent 拥有的 USDC 余额"""
        
    def lock_funds(self, task_id: str, seller_address: str, amount: float) -> str:
        """买方 Agent 发起担保支付，将资金锁定在 Escrow 中"""

    def release_funds(self, task_id: str) -> str:
        """买方 Agent 拿到运算结果，验证成功后，释放智能合约锁定的资金给卖方 Agent"""
```

## 3. FastAPI 网关与隔离设计 (API Gateway & Indexer)

该模块解决的问题是：以太坊 JSON-RPC 节点只懂底层哈希映射，不懂复杂的“用户->Agent池”的聚合检索；为了辅助前端复杂的业务管理面板，我们搭建了 FastAPI 来缓存与聚合查询数据。

### 双端口隔离设计 (Dual Micro-Services)
为了彻底防范普通用户的 `BOLA (越权攻击)` 操作后台系统核心变量，本系统利用双端口从应用层面切断路由感染。
1. **Client API (`/api/client` :: Port 8000)**
   - 依赖 `verify_client_session`。强制前端在 Header 中提供 `X-User-Address`。
   - 所有数据库基于 `AgentModel(ClientBase)` 执行 RLS 行级约束查询（`filter(AgentModel.owner_address == user_address)`）。
2. **Admin API (`/api/admin` :: Port 8001)**
   - 依赖 `verify_admin_session`。
   - 全局“神之视角”，可以查询汇总流水与利润（`TreasuryRevenue`），并与二次动态密码 (OTP) 集成防止管理员密码泄露。

### Indexer 数据同步引擎
运行在后端守护进程中 (`sync_daemon.py`):
1. 主动轮询 RPC 节点的 `TaskCreated` 或 `FundsReleased` / `TaskDisputed` 等 Event 消息。
2. 捕获到流水的区块信息后，以统一模型格式（`ClientTaskModel`... 等）插入到 `indexer.db` SQLite，解决纯去中心化应用展示多页与排序不畅的问题。

## 4. 依赖项 (Dependencies)

* **Web3 交互**: `web3` >= 6.0.0, `eth-account`
* **Agent 编排框架**: `langchain`, `langchain-openai`
* **Web 后端构架**: `fastapi`, `uvicorn`
* **数据库映射**: `sqlalchemy` (使用 SQLite 实现本地轻量级持久化)
