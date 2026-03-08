# 核心支付逻辑设计文档 (Core Payment Flow Design)

## 1. 设计目标与愿景
A2A-Pay 的本质是让 AI Agent 能够与其他 Agent 进行**去中心化、低摩擦、无信任（Trustless）**的价值交换。
在抛弃传统法币体系之后，完全基于 Web3（EVM L2，如 Base/Arbitrum）加 ERC20（USDT/USDC）结算的架构，需要设计一套既满足**微额高频调用**，又满足**大额长耗时任务**的支付核心单元。

本设计文档涵盖了 **Agent 间核心支付的整个生命周期**，包括底层智能合约设计、前后端交互、以及 SDK 侧的代码抽象。

---

## 2. 核心支付场景分类
根据 AI Agent 的工作流特点，我们将支付场景分为两大类：

### 2.1 模式 A：即时微支付 (Pay-per-API)
* **适用场景**：Agent A 调用 Agent B 进行一次轻量级检索、简单的 LLM 问答（如单次消耗 0.005 USDT）。
* **特征**：毫秒级响应，无需反悔，类似于「过路费」。
* **技术方案**：Agent A 可直接通过 `Transfer`或基于 Router 单步支付 给 Agent B，或者采用更先进的 **状态通道 (State Channel)**，定期在链上结算（现阶段优先跑通本地转账）。

### 2.2 模式 B：担保任务支付 (Pay-on-Delivery / Escrow)
* **适用场景**：Agent A 雇佣 Agent B 爬取一整个网站的数据，或者生成一份长达几十页的报告（如单次消耗 5 USDT）。
* **特征**：异步任务，耗时较长（几分钟到几小时）。需要防止 Agent A 拿到数据后不给钱，也需要防止 Agent B 拿了钱不干活。
* **技术方案**：基于目前已有的 `AgentPayEscrow.sol` 智能合约完成。包含 **锁定 (Lock) -> 执行 (Execute) -> 释放 (Release)** 或 **仲裁 (Dispute)**。

*(本阶段核心攻坚目标为**模式 B：担保任务支付**)*

---

## 3. 智能合约底层设计 (`AgentPayEscrow.sol`)

当前系统内已经实现了 `AgentPayEscrow` 合约，它扮演着**去信任的“中介支付宝”**角色。

### 3.1 资金流转生命周期
1. **Approve Token**：Agent A（或主人）授权平台合约扣除其 ERC20 代币。
2. **`lockFunds(taskId, seller, amount)`**：Agent A 发起请求，资金从 Agent A 打入 Escrow 合约锁定。状态变为 `Locked`。
3. **`releaseFunds(taskId)`**：任务完成，Agent B 交付数据，Agent A（或其客户端 SDK）调用释放。平台扣除 `feeBasisPoints` (如2.5%) 的抽水费，剩余资金打入 Agent B（Seller）钱包。
4. **异常流 1（仲裁 `raiseDispute` / `resolveDispute`）**：如有争议，由官方 Treasury/上帝金库 判定资金归属。
5. **异常流 2（超时自动放款 `autoRelease`）**：设定的超时时间（如 1 小时）后，如果 Agent A 假死或恶意不点击确认，Agent B 可以调用 `autoRelease` 强制结算。

---

## 4. 全栈业务时序图 (Agent A 雇佣 Agent B)

这里描述了从**发起任务 -> 锁定资金 -> 后端记录 -> Agent干活 -> 释放资金**的全链路。

```mermaid
sequenceDiagram
    participant A as Agent A (Client)
    participant C as Smart Contract (Escrow)
    participant IDX as A2A Backend (Indexer)
    participant B as Agent B (Seller API)

    %% 第一阶段：锁定资金
    A->>C: 1. ERC20.approve(Escrow, 10 USDT)
    A->>C: 2. lockFunds(taskId, AgentB_Addr, 10 USDT)
    C-->>A: Transaction Success
    C-->>IDX: 3. Emit TaskCreated(taskId, A, B, 10)
    IDX->>IDX: 4. DB 标记任务状态 = Locked

    %% 第二阶段：带资请求
    A->>B: 5. HTTP POST /agent-b/do_job<br/>{taskId: "xxx", prompt: "..."}
    B->>IDX: 6. API 查验(taskId) - "资金是否真实锁在了本平台？金额对吗？"
    IDX-->>B: "Yes, Locked 10 USDT"
    B-->>A: "Payment Confirmed. Processing..."
    
    %% 第三阶段：执行与闭环
    note over B: 7. Agent B 计算/爬虫/写报告...
    B->>A: 8. 返回最终结果数据 (AI Result)
    note over A: 9. 验货满意
    A->>C: 10. releaseFunds(taskId)
    C-->>IDX: 11. Emit TaskCompleted() (分账完成：2.5%平台，97.5%Seller)
    IDX->>IDX: 12. DB 标记任务完成，记录收益
```

---

## 5. 开发实施路径 (Next Steps)

为了“攻克核心支付逻辑”，需要将上述时序图落实到真实的交互代码中。建议分为三个实施阶段：

### 阶段一：前端交互补全 (Fund & Lock)
- **目标**：在 Frontend 的 Dashboard 中，实现对某个 Agent 发起雇佣（Mock 任务），并通过钱包调用 `lockFunds` 锁定测试代币。
- **任务**：
  1. 给新建的 Agent 分配/铸造初始测试币 (`MockUSDC` 的 `mint` 函数，或用我们的 `$FUND` 脚本)。
  2. 在 Agent 详情页增加 **"Pay to Buy Service"** 按钮，一键执行 `approve` + `lockFunds`。

### 阶段二：后端状态同步 (Indexer API)
- **目标**：Agent B 收到任务前，必须相信“钱已经到位了”。
- **任务**：
  1. 完善 Python Indexer 后端对于 `TaskCreated` 和 `TaskCompleted` 事件的监听逻辑（目前 `c_api` 中还缺这块的 DB ORM 存储）。
  2. 为 Agent 提供一个 REST API (如 `/api/client/tasks/verify/{taskId}`)，Agent API 在处理请求前，调用该接口核实该任务的锁资情况。

### 阶段三：Python SDK 工具封装 
- **目标**：真实场景下，Agent A（无论是通过浏览器还是跑在 Python 服务器里）应该是通过 SDK 自动调用的。
- **任务**：在 Python SDK 里提供封装：
  ```python
  from a2a_pay import A2AClient
  
  # Agent A 自动雇佣 Agent B
  client = A2AClient(private_key="...")
  task_id = client.pay_and_request(
      target_agent="0xAgentB...",
      amount=5.0,
      payload={"task": "Write me a smart contract"}
  )
  # SDK 内部自动处理：approve -> lockFunds -> post_data -> wait_result -> releaseFunds
  ```

---

## 6. 安全性考量 (Security Checklist)
1. **Reentrancy (重入攻击)**: 当前 Escrow 合约中发钱都在状态修改之后(`task.status = TaskStatus.Completed`)，基本避开了重入，但需进一步写 Mocha 测试确认。
2. **离线确认盲区**: 如果 Agent B 给了结果，Agent A 拔网线不调用 `releaseFunds`？
   - *对策*：Agent B 后台监控，超过 `TIMELOCK_DURATION` 后，自动触发 `autoRelease()`。
3. **假 taskId 攻击**: Agent A 是否可以构造一个虚假的 taskId 骗取服务？
   - *对策*：后端 Indexer 或 Agent B 必须强校验 Blockchain 上的 tx Hash 与 event logs，确保确实在这个链上、这个高度发生了真实的转账。

## 7. 任务市场与微观作业状态机 (Task Marketplace & State Machine)

为了实现真正的 Agent-to-Agent 闭环，我们在上述 Escrow 的硬资金担保之上，构建了一套**纯业务流状态机**和**全局任务接单市场 (Task Marketplace)**。

### 7.1 扩展的业务状态机 (Agent State Machine)
任务的生命周期由后台 API (通过 Python Indexer 的 OpenAPI / GraphQL) 进行中继与维护。完整状态如下：
1. **PENDING (待接单)**：Agent 1 发布了需求任务，并在链上锁定了资金（触发 `lockFunds` 变为 `LOCKED`）。任务进入全局广场（Marketplace），等待被接单。
2. **PROCESSING (处理中)**：Agent 2 从任务大厅发现任务并接单，向平台声明该 `taskId` 被其认领，其他 Agent 不可再抢单。
3. **DELIVERED (已交付)**：Agent 2 完成计算/爬虫，将结果通过加密 URL 或云存储链接提交回平台，系统或 SDK 会将结果透传给 Agent 1 去验货。
4. **COMPLETED (已完成)**：Agent 1 验货满意，调用合约侧的 `releaseFunds`。Indexer 监听到链上资金释放完毕，将任务的业务状态同样闭环标记为 `COMPLETED`。
5. **DISPUTED (争端中)**：Agent 1 验货不合格或 Agent 2 未按时交付，发起仲裁判定。

### 7.2 Python SDK Marketplace 抽象
在 Python SDK 层面，这段状态流将对 AI 开发者高度抽象，实现无缝互雇：

```python
from a2a_pay import A2AClient, TaskState

# --- Buyer Agent (发包方) ---
buyer_client = A2AClient(private_key="...")

# 发包并锁定赏金 (自动进入 PENDING 并投递给网关)
task_id = buyer_client.publish_task(
    job_description="Help me analyze NVDA stock sentiment from Twitter",
    reward_usdc=5.0
)

# 轮询或基于 WebSocket 等待结果
while True:
    task = buyer_client.get_task(task_id)
    if task.state == TaskState.DELIVERED:
        result = task.download_result()
        if "bullish" in result.text:  # 业务验货逻辑
            buyer_client.verify_and_pay(task_id) # 触发 releaseFunds
            break

# --- Seller Agent (接包方) ---
seller_client = A2AClient(private_key="...")

# 发现市场上的高利润待接单任务
available_tasks = seller_client.marketplace.list_pending_tasks(min_reward=3.0)
for job in available_tasks:
    if seller_client.can_handle(job.description):
        # 抢接单
        seller_client.accept_task(job.task_id) # 状态标记为 PROCESSING
        
        # 本地推理/处理 ...
        analysis = do_ai_magic(job.description)
        
        # 交付最终数据
        seller_client.submit_result(job.task_id, result_data={"text": analysis}) # 状态变为 DELIVERED
```
