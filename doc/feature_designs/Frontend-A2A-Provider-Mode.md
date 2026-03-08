# A2A Provider (Server) 模式 前端架构与重构设计

## 1. 背景 
在此前版本中，DApp 的前端严重倾向于“买家(Buyer) 视角”，提供诸如 `Marketplace（任务大厅）`, `Post Bounty（发悬赏）` 等复杂业务流。
随着架构向极简 **同步支付 API (Sync Router + FastAPI)** 跃迁，我们要将前端重心从“中介任务发布板” 转型至 **“AI 能力供应商 (Provider/Seller) 管理后台”**。 

在这里，Seller 将其自研的 AI Agent（或者数据集/工具）包装成一个服务，接入 A2APay 协议收费。

## 2. 需废弃/清理的旧版遗留前端功能 (Deprecation)
在 `frontend/src/app` 中，以下重度强关联旧 Escrow 模式的界面与逻辑应该被清理或隐藏：
- **`/dashboard/marketplace`**：所有的“查看/接受/发布任务”逻辑，它们耦合了已被删除的 Python Indexer。
- **Nav/Sidebar 里的 Tasks，Bounties 等字眼。**

## 3. Provider Mode 新前端核心页面设计

### 3.1 仪表盘总览 (Dashboard)
定位为监控 Seller 的收益与服务调用频次。
- **展示图表**：实时调用量 (API Requests)、总创收金额 (Total Earned in USDC)、平均延迟。
- **链上日志**：展示来自 `A2APaySyncRouter` 的最近 `ServicePaid` 链上事件回执，只显示打款给当前连接钱包的交易。

### 3.2 服务应用管理 (My Services / Agents)
定位为创建一个可被其他人调用的服务终点（原先的 Agents 即 Service）。
每个 Service 包含：
- `Service ID`：(例如 `V1_IMAGE_GEN`，这是 FastAPI 中需要检验的关键标识)。
- `Pricing`：单次调用价格（如 0.05 USDC）。
- `Endpoint API`：该服务背后的 Web2 Provider 公网地址，如 `https://api.my-agent.com/generate`。
- **状态管理**：Active / Inactive 拨动开关。

### 3.3 部署与接入指南 (Integration Docs)
在前端直接提供给 Provider 查阅。当他们填好一个 Service 后，面板可以动态生成一段代码（类似 Stripe），告诉他们：
1. 你的服务标识与定价是怎样的。
2. 你的 FastAPI 应该如写（给出根据他们填写的参数一键生成的 Python Boilerplate）。
3. 你的买家该如何使用你的服务调用代码（生成一个带支付合约地址和卖家地址的 fetch snippet）。

## 4. UI/UX 体验交互流程
1. **连接钱包**：Provider 连接后，系统立刻嗅探 `A2APaySyncRouter`，计算当前地址总收益。
2. **注册服务**：点击“Create Service”，录入上面提到的元数据。此时仅仅是将服务数据保存在本地或一个去中心化 KV 注册表中（此部分可采用模拟本地存储）。
3. **获取 API Key / 启动**：这只是一个概念隐喻。实际上，区块链 `ServicePaid` 就是该服务的 API Key。系统指导用户开启他的 Python FastAPI 即可躺赚。

## 5. 与新合约的绑定点
在旧版中我们有 `AgentPayEscrow`。现在前端唯一的智能合约交互应该是与 `A2APaySyncRouter.sol` 的只读交互：
- **监听器**: 监听 `event ServicePaid(address indexed buyer, address indexed seller, address token, uint256 amount, uint256 fee, string serviceId);` 
- 使用 `ethers.js` 或 `viem` 通过当前钱包地址进行 event topics 过滤，抓取 `seller == current_user` 的事件来绘制看板图表。

## 6. 后续重构动作 (Action Items)
1. 删除 `app/dashboard/marketplace` 完整路由。
2. 重构 `app/dashboard/page.tsx` 为 Provider Analytics (通过区块日志聚合收益，无需后端数据库)。
3. 重命名 `app/dashboard/agents` 为 `app/dashboard/services`。