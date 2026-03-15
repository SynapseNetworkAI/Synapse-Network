# A2A Provider (Server) 模式 前端架构与重构设计

## 1. 背景 
在此前版本中，DApp 的前端严重倾向于“买家(Buyer) 视角”，提供诸如 `Marketplace（任务大厅）`, `Post Bounty（发悬赏）` 等复杂业务流。
随着架构向极简 **同步支付 API (Sync Router + FastAPI)** 跃迁，我们要将前端重心从“中介任务发布板” 转型至 **“AI 能力供应商 (Provider/Seller) 管理后台”**。 

在这里，Seller 将其自研的 AI Agent（或者数据集/工具）包装成一个服务，接入 Synapse Network 协议收费。

## 2. 需废弃/清理的旧版遗留前端功能 (Deprecation)
在 `frontend/src/app` 中，以下重度强关联旧担保模式的界面与逻辑应该被清理或隐藏：
- **`/dashboard/marketplace`**：所有的“查看/接受/发布任务”逻辑，它们耦合了已被删除的 Python Indexer。
- **Nav/Sidebar 里的 Tasks，Bounties 等字眼。**

## 3. Provider Mode 新前端核心页面设计

### 3.1 仪表盘总览 (Dashboard)
定位为监控 Seller 的收益与服务调用频次。
- **展示图表**：实时调用量 (API Requests)、总创收金额 (Total Earned in USDC)、平均延迟。
- **链上日志**：展示来自 `Synapse NetworkSyncRouter` 的最近 `ServicePaid` 链上事件回执，只显示打款给当前连接钱包的交易。

### 3.2 Agent 与 Service 管理 (My Agents / Services)
定位为分层管理：先创建 Agent，再在 Agent 下创建多个 Service（接口）。

每个 Agent 包含：
- `Agent Name`：如 `seller-agent`、`image-lab-agent`
- `Agent Wallet`：执行与收款相关的钱包身份
- `Agent Role`：Provider / Seller 等角色

每个 Service（接口）包含：
- `Service ID`：(例如 `V1_IMAGE_GEN`，这是 FastAPI 中需要检验的关键标识)。
- `Pricing`：单次调用价格（如 0.05 USDC）。
- `Endpoint API`：该服务背后的 Web2 Provider 公网地址，如 `https://api.my-agent.com/generate`。
- **状态管理**：Active / Inactive 拨动开关。

约束：**一个 Service 对应一个接口 endpoint**。

### 3.3 部署与接入指南 (Integration Docs)
在前端直接提供给 Provider 查阅。当他们填好一个 Service 后，面板可以动态生成一段代码（类似 Stripe），告诉他们：
1. 你的服务标识与定价是怎样的。
2. 你的 FastAPI 应该如写（给出根据他们填写的参数一键生成的 Python Boilerplate）。
3. 你的买家该如何使用你的服务调用代码（生成一个带支付合约地址和卖家地址的 fetch snippet）。

## 4. UI/UX 体验交互流程
1. **连接钱包**：Provider 连接后，系统立刻嗅探 `Synapse NetworkSyncRouter`，计算当前地址总收益。
2. **注册 Agent**：先创建 Agent 身份（钱包 + 角色）。
3. **注册 Service**：在指定 Agent 下创建一个或多个 Service（每个 Service 对应一个接口）。
3. **获取 API Key / 启动**：这只是一个概念隐喻。实际上，区块链 `ServicePaid` 就是该服务的 API Key。系统指导用户开启他的 Python FastAPI 即可躺赚。

## 5. 与新合约的绑定点
当前版本前端唯一的智能合约交互应该是与 `Synapse NetworkSyncRouter.sol` 的只读交互：
- **监听器**: 监听 `event ServicePaid(address indexed buyer, address indexed seller, address token, uint256 amount, uint256 fee, string serviceId);` 
- 使用 `ethers.js` 或 `viem` 通过当前钱包地址进行 event topics 过滤，抓取 `seller == current_user` 的事件来绘制看板图表。

## 6. 后续重构动作 (Action Items)
1. 删除 `app/dashboard/marketplace` 完整路由。
2. 重构 `app/dashboard/page.tsx` 为 Provider Analytics (通过区块日志聚合收益，无需后端数据库)。
3. 重命名 `app/dashboard/agents` 为 `app/dashboard/services`。

---

## 7. Agent / Service 分层注册设计（可直接落地）

### 7.1 数据模型（前端本地存储版）
建议采用三层模型：`WalletProfile -> AgentProfile -> ServiceProfile`。

```ts
type WalletProfile = {
	ownerAddress: string;
}

type AgentProfile = {
	agentId: string;
	ownerAddress: string;
	agentName: string;
	role: string;
	agentWalletAddress: string;
	createdAt: string;
	updatedAt: string;
}
```

```ts
type ServiceProfile = {
	serviceUuid: string;
	ownerAddress: string;
	agentId: string;           // 归属 Agent
	serviceName: string;
	serviceId: string;         // 例如 V1_IMAGE_GEN
	pricing: string;
	endpoint: string;          // 一个 Service 对应一个 endpoint
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
}
```

### 7.2 字段校验规则
- `serviceId`：只允许大写字母、数字、下划线；建议按 `ownerAddress + agentId + serviceId` 维度唯一。
- `pricing`：必须 `> 0`，建议限制小数位（例如最多 4 位）。
- `endpoint`：必须是合法 URL；生产环境建议强制 `https://`，本地开发允许 `http://127.0.0.1:*`。
- `isActive`：默认为 `true`，可随时切换。

### 7.3 状态机
- `Draft`：表单编辑中（尚未保存）。
- `Active`：可对外提供服务并展示于 Dashboard。
- `Inactive`：暂停对外，但配置保留。

---

## 8. 页面设计（Provider Console）

### 8.1 Dashboard (`/dashboard`)
**目标**：总览收益、调用、服务健康。

模块建议：
1. KPI 卡片：`Total Earned`、`Total Fee`、`Net Earned`、`Paid Calls (24h)`。
2. Services 卡片列表：显示 `Service ID / Pricing / Endpoint / Active`。
3. ServicePaid 事件流：仅展示 `seller == current_user`。

### 8.2 Create Agent (`/dashboard/services/create`)
**目标**：完成 Agent 注册（身份层）。

表单字段：
- `Agent Name`
- `Agent Role`
- （自动）`Agent Wallet`

### 8.3 Server Management (`/dashboard/services`)
**目标**：在 Agent 下管理 Service（接口层）。

表单字段：
- `Agent`（选择归属 Agent）
- `Service Name`
- `Service ID`
- `Pricing (USDC)`
- `Endpoint API`
- `Status (Active/Inactive)`

交互要求：
- 提交成功后刷新列表并可继续新增。
- 校验失败时提供字段级错误提示（不仅是全局 toast）。

### 8.4 Agent Detail (`/dashboard/services/[id]`)
**目标**：Agent 身份、资金与流水展示（不承担 Service 配置编辑）。

模块建议：
1. Agent Identity（地址、私钥显示与复制）
2. Integration Docs（读取当前 Service 配置并生成）
	 - FastAPI Boilerplate
	 - Buyer Fetch Snippet
3. Payment Ledger（按 Agent 钱包相关流水）

---

## 9. 前端串联流程（从 0 到可收费）

### Step 1: 钱包连接
- 通过 `wagmi` 获取 `current_user`。
- 未连接时由 Guard 阻断业务页面。

### Step 2: 注册 Agent
- Provider 创建 Agent（身份层）。

### Step 3: 在 Agent 下注册 Service
- Provider 选择 Agent，并填写 `serviceName/pricing/isActive/invoke(method+url+schema)`。
- 一个 Agent 可拥有多个 Service，每个 Service 对应一个 endpoint。

### Step 4: 配置确认
- 在 Server Management 页面编辑并保存。
- 同步更新 Dashboard 卡片展示。

### Step 5: 生成接入代码
- 根据当前服务配置动态生成：
	- Seller FastAPI 模板
	- Buyer Fetch 调用模板

### Step 6: 支付与调用
1. Buyer 完成链上支付并提交 `deposit intent`，等待余额入账。
2. Buyer 调用平台网关 `/api/v1/gateway/generate`，Header 携带 `X-Agent-Credential` 与 `X-Service-Id`。
3. Gateway 完成凭据、限流、余额校验后再执行业务。

### Step 7: 收益回流
- Dashboard 监听/查询 `ServicePaid` 日志。
- 聚合统计并更新事件流。

---

## 10. 前端实现分层建议

### 10.1 Store / API 层
- Agent 身份信息仍由 `agentStore` 承载（MVP）。
- Service 配置统一由后端 `services` API 提供与持久化（Backend as Source of Truth）。
- 前端通过 `serviceApi.ts` 暴露：`list/create/update/delete`。

### 10.2 链上读取层
- `services/chain.ts`（建议新增）：封装 `queryServicePaidBySeller(address)`。
- 统一处理：分页、排序、金额格式化、异常降级。

### 10.3 UI 组件层（建议拆分）
- `ServiceForm`
- `ServiceConfigPanel`
- `IntegrationDocsPanel`
- `ServicePaidTable`

---

## 11. 验收标准（Definition of Done）

1. Provider 能在前端创建并保存服务配置。
2. Dashboard 可展示服务列表与链上 `ServicePaid` 收益聚合。
3. 详情页可生成可复制的 FastAPI 与 Fetch Snippet。
4. 状态切换 `Active/Inactive` 生效并可持久化。
5. 流程完整：`连接钱包 → 注册服务 → 充值确认入账 → 网关调用 → 收益回流`。

---

## 12. 核心问题详细设计（实施基线）

本节用于明确你提出的关键问题，作为后续功能开发与联调的统一基线。

### 12.1 数据结构如何关联

采用四层关联模型：

1. **钱包（Provider Wallet）**
	- 主键：`ownerAddress`
	- 含义：租户边界与收益归集主体。

2. **Agent（AgentProfile）**
	- 主键：`agentId`
	- 外键：`ownerAddress`
	- 含义：能力提供节点（可挂多个 Service）。

3. **服务（ServiceProfile）**
	- 主键：`serviceUuid`
	- 外键：`agentId`
	- 业务唯一键：`ownerAddress + agentId + serviceId`
	- 含义：对外收费接口定义（一个 Service = 一个 endpoint）。

4. **支付事件（ServicePaid）**
	- 关联键：`seller(ownerAddress)` + `serviceId`
	- 含义：链上支付凭证，驱动收益统计与调用校验。

关系示意：
- `1 Wallet -> N Agents`
- `1 Agent -> N Services`
- `1 Service -> N ServicePaid Events`

### 12.2 一个钱包可以创建多个 Agent 吗

**可以，且建议支持。**

约束规则：
- 同一钱包下可创建多个 Agent。
- Agent 名称建议在同钱包下唯一。

### 12.3 一个 Agent 可以创建多个 Service 吗

**可以。**

约束规则：
- 同一 Agent 下 `serviceId` 必须唯一。
- 不同 Agent 下可复用同名 `serviceId`（建议仍尽量避免歧义）。
- 每个 Service 只绑定一个 `endpoint`（一个 Service = 一个接口）。

### 12.4 服务状态如何定义

建议采用以下状态（前端可先实现前 3 个）：

1. `Draft`
	- 含义：未完成保存，不可对外宣传。
2. `Active`
	- 含义：可接单；允许 Buyer 发起支付并调用 endpoint。
3. `Inactive`
	- 含义：暂停服务；历史收益保留，不接收新调用。
4. `Deprecated`（可选）
	- 含义：废弃服务，仅保留审计与历史流水。

状态迁移：
- `Draft -> Active`
- `Active <-> Inactive`
- `Inactive -> Deprecated`

### 12.5 发布后是否可调用

**是，但必须同时满足两类条件：**

1. **业务可调用条件**
	- 服务状态为 `Active`
	- endpoint 可达且健康检查通过

2. **支付可验证条件**
	- Buyer 余额已确认入账且 `buyerBalance >= pricing`
	- 调用凭据有效（未过期、未撤销、未超配额）

只有同时满足，Gateway 才返回 200 并执行业务逻辑。

### 12.6 服务上线/下线是否需要与智能合约交互

#### MVP（当前推荐）
- **不强制链上交互**。
- 上/下线仅更新前端注册表（本地存储或后端数据库）。
- 合约仅负责支付与事件证明（`ServicePaid`）。

#### V2（可演进）
- 增加链上注册合约（Service Registry）：
  - `registerService(serviceId, metadataHash)`
  - `setServiceStatus(serviceId, active)`
- 适用于需要公开可验证服务目录的场景。

### 12.7 用户付费后如何调用接口，服务端如何验证

标准链路：

1. Buyer 完成链上支付并提交 `deposit intent`，由 Indexer 异步确认入账。
2. Buyer 调用 Gateway endpoint（POST），请求头附带：
	- `X-Agent-Credential`
	- `X-Service-Id`
3. Gateway 执行校验：
	- 凭据有效（owner/agent/service scope）
	- 三维限流通过
	- `buyerBalance >= service.pricing`
	- 原子扣费并写 usage 审计
4. 校验通过后执行业务逻辑并返回结果；否则返回 401/402/403。

建议补充：
- 最少确认数（例如本地 1，生产可提升）
- 每日限额策略（平台配置）

### 12.8 服务如何做注册

MVP 注册流程（前端已可落地）：

1. Provider 连接钱包。
2. 创建 Agent（身份层）。
3. 在 Agent 下创建 Service（接口层）。
4. 前端校验并提交后端 `services` API。
5. 生成 Integration Docs 给 Provider 部署 FastAPI。

后续增强：
- 将注册信息落库（Postgres）
- 可选同步到链上 Registry（仅存 `metadataHash`，明文放 IPFS/对象存储）。

### 12.8 平台是否做接口转发

**当前模式由平台网关统一做鉴权、扣费与转发。**

职责边界：
- 链上 Router：收款、分账、事件留痕。
- Buyer 客户端：发起支付并调用平台网关。
- Gateway：凭据校验、余额扣费、审计与转发。
- Seller API：专注执行业务逻辑。
- Provider Console：配置管理、文档生成、收益看板。

可选扩展（非 MVP）：
- 平台可提供 API Gateway（限流、鉴权、审计），但会增加中心化复杂度与成本。

### 12.8.1 不转发时，平台如何“验证是否调用了”

这个问题需要拆成两个层级：

1. **支付是否发生（平台可强验证）**
	- 平台通过链上 `ServicePaid` 事件可确认：某 Buyer 对某 Seller 的某 `serviceId` 完成了支付。
	- 这是强可验证事实（链上证据）。

2. **业务接口是否真正执行成功（平台默认不可强验证）**
	- 在“Buyer 直连 Seller”的模式下，平台看不到 Seller 私有 API 的真实执行结果。
	- 因此平台默认只能证明“已支付”，不能单独证明“Seller 已返回业务结果”。

### 12.8.2 MVP 的调用完成证明方案（不引入转发）

在不做平台转发的前提下，建议增加轻量回执机制：

1. Seller 处理完成后，向平台上报 `Delivery Receipt`（可先后端记录，后续可上链哈希）。
2. 回执建议字段：
	- `txHash`
	- `serviceId`
	- `status`（success/failed）
	- `resultHash`（响应摘要，避免上传明文）
	- `timestamp`
3. 平台据此提供“支付成功/执行成功/执行失败”三态看板。

说明：
- 该回执是“平台观测增强”，不改变 Buyer 直连 Seller 的架构边界。
- 若需要平台对执行结果做强背书，应升级为 Gateway/TEE/可验证执行方案（非 MVP）。

### 12.8.3 Buyer 是否直接调用 Seller

**是。当前 MVP 设计为 Buyer 直接调用 Seller endpoint。**

完整顺序：
1. Buyer 链上支付，获得 `txHash`。
2. Buyer 携带 `txHash + serviceId` 直接请求 Seller API。
3. Seller 本地校验支付事件并返回结果。
4. （可选）Seller 上报 Delivery Receipt 给平台用于运营看板。

### 12.8.4 为什么 MVP 不做平台转发（决策说明）

当前阶段选择“Buyer 直连 Seller、平台不转发”的核心原因：

1. **降低工程与运维复杂度**
	- 若平台转发，需要额外建设网关集群、限流、熔断、重试、全链路日志、灰度与监控告警。
	- 对 MVP 而言，这些成本会显著延后核心闭环上线。

2. **避免平台成为业务单点**
	- 转发后所有流量经过平台，平台故障会直接影响所有服务可用性。
	- 直连模式下，故障域隔离更好，不会“一处故障全网不可用”。

3. **保持 Provider 服务主权**
	- Provider 可独立部署、扩缩容、替换基础设施，平台只负责支付与证明。
	- 迁移成本更低，符合开放生态目标。

4. **降低合规与数据责任压力**
	- 平台不经手业务明文请求/响应，可减少数据托管与内容责任边界。
	- 更容易以“支付与结算基础设施”定位推进落地。

5. **性能路径更短**
	- 避免额外网络跳点（Buyer -> Platform -> Seller），减少时延与额外失败面。

### 12.8.5 何时应升级为平台转发（触发条件）

当出现以下任一类需求时，可评估从“直连模式”升级到“网关转发模式”：

1. **统一风控与治理要求**
	- 需要全局 WAF、IP 黑白名单、请求内容审计、统一 DDoS 防护。

2. **企业级 SLA 承诺**
	- 需要平台统一保障可用性、重试策略、故障切流与标准化错误码。

3. **统一鉴权与配额计费**
	- 需要统一 API Key、调用配额、细粒度租户隔离与套餐能力。

4. **争议仲裁证据强化**
	- 需要平台持有完整调用轨迹，支撑执行成功率、超时、结果回执等争议判定。

5. **多服务编排与聚合场景**
	- 需要平台在一次请求内编排多个 Seller 服务并统一返回。

升级建议（分阶段）：
- Phase A：保持直连，先落地 `Delivery Receipt` 与观测指标。
- Phase B：引入可选 Gateway（Opt-in），允许 Provider 自主接入。
- Phase C：对特定高合规/高 SLA 服务启用强制 Gateway。

### 12.9 收益如何分配

以 `ServicePaid(amount, fee)` 为准：

- 平台费：`fee`
- Provider 实得：`amount - fee`

Dashboard 建议展示：
- `Gross Earned = Σ amount`
- `Platform Fee = Σ fee`
- `Net Earned = Σ (amount - fee)`

按服务维度统计：
- `Net(serviceId) = Σ_serviceId (amount - fee)`

### 12.10 开发落地优先级（建议）

P0（必须）：
1. 完成服务状态约束（Active 才允许调用）。
2. 完成服务端 `txHash` 校验与防重放。
3. 完成 Dashboard 的 `amount/fee/net` 三指标聚合。

P1（应做）：
1. 服务维度流水视图（按 `serviceId` 过滤事件）。
2. 支付有效期与确认数策略。

P2（可选）：
1. 链上 Service Registry。
2. 平台 API Gateway 转发模式。

### 12.11 Seller 入驻模型（平台自营 + 第三方）

当前目标是开放 Provider 生态，Seller 不仅限于平台自营。

1. **第三方 Seller（默认）**
	 - 任意钱包地址可注册服务并收款。
	 - 按统一协议完成支付校验与交付。

2. **平台自营 Seller（可选）**
	 - 平台可使用独立钱包注册官方服务。
	 - 在协议层与第三方 Seller 权限一致，不应有“特权调用路径”。

3. **准入策略（可配置）**
	 - MVP：开放注册。
	 - 后续可增加白名单、KYC、押金/质押、服务审核分层。

### 12.12 支付-验证-交付时序与异常处理（MVP 必须实现）

#### 12.12.1 正常时序
1. Buyer 获取 `sellerAddress/serviceId/pricing/invoke.url`。
2. Buyer 链上支付并提交 `deposit intent`。
3. Indexer 完成链上确认后，余额进入 `buyerBalance`。
4. Buyer 调用 `/api/v1/gateway/generate`，携带 `X-Agent-Credential` 与 `X-Service-Id`。
5. Gateway 校验并扣费后执行业务，返回结果。

#### 12.12.2 未立即确认充值（链上确认延迟）
当 Indexer 尚未确认充值交易时：
- 返回 `202 Pending`（不是失败）。
- 响应建议包含：
	- `code: DEPOSIT_PENDING_CONFIRMATION`
	- `retryAfterSec: 2~5`
	- `txHash`
- Buyer 按指数退避重试（例如总等待 30~60 秒）。

#### 12.12.3 失败与拒绝条件
- `402 Payment Required`：
	- 无有效 `ServicePaid`，或 `amount < pricing`。
- `403 Forbidden`：
	- `seller/serviceId/token` 不匹配。
- `408 Request Timeout`（或业务约定码）：
	- 超过支付有效窗口仍未获得有效确认（例如 10 分钟）。
- `409 Conflict`：
	- 重放请求（`txHash + logIndex` 已消费）。

#### 12.12.4 生产参数建议
- `minConfirmations`：
	- 本地链：1
	- 生产链：2~5（按链稳定性调整）
- `paymentTtlSec`：
	- 建议 600 秒（10 分钟）
- `idempotencyKey`：
	- 建议采用 `txHash + logIndex + serviceId`

#### 12.12.5 安全基线
- Seller 公网路由全部走“先验单后执行”中间件。
- 禁止暴露免验单调试接口到公网。
- 建议额外校验 Buyer 签名（可选）以绑定请求发起者身份。

---

## 13. Server 管理页面功能设计（Agent / Service）

### 13.1 页面定位
- 路由：`/dashboard/services`
- 目标：作为 Provider 的“Server 管理台”，集中管理 Agent 下的 Service 配置。
- 覆盖能力：列表展示、按服务名搜索、按状态筛选、分页、新增、编辑、上线/下线、按 Agent 归属管理。

### 13.2 页面信息架构
1. **Header 区域**
	- 标题：`Server Management`
	- 描述：Agent 与 Service 分层管理说明
	- 主按钮：`New Service`（跳转 `/dashboard/services/create`）

2. **筛选区域**
	- `Search by service name`（关键字模糊匹配 `service.name`）
	- `Search by status`（`All / Active / Inactive`）
	- （可选）`Filter by agent`

3. **列表区域（表格）**
	- 列字段：
	  - `Service Name`
	  - `Service ID`
	  - `Pricing`
	  - `Status`
	  - `Endpoint`
	  - `Actions`

4. **分页区域**
	- `Prev / Next`
	- 页码信息：`Page X / Y`
	- 区间统计：`Showing A - B of N`

### 13.3 数据来源与权限边界
- 数据源：`agentStore.getAgentsByOwner(current_wallet)`
- 权限边界：仅展示当前连接钱包名下 Agent 与其 Service。
- 默认排序：`createdAt DESC`（最新注册优先）。

### 13.4 搜索与筛选规则
1. **服务名称搜索**
	- 字段：`service.name`
	- 方式：大小写不敏感，`contains` 模糊匹配。

2. **状态筛选**
	- `All`：不过滤
	- `Active`：`isActive === true`
	- `Inactive`：`isActive === false`

3. **联动规则**
	- 搜索词或筛选条件变化后，分页重置到第一页。

### 13.5 分页规则
- 默认每页条数：`8`
- 计算：`totalPages = ceil(filteredCount / pageSize)`
- 边界处理：
  - `currentPage < 1` 归一化为 `1`
  - `currentPage > totalPages` 自动回落到 `totalPages`

### 13.6 操作能力定义
1. **新增服务**
	- 按钮：`Register Service`
	- 在当前页或弹层录入（需选择 Agent）。

2. **编辑服务**
	- 行内按钮：`Edit`
	- 在当前页编辑区完成更新。

3. **上线/下线服务**
	- 行内按钮：`Online / Offline`
	- 行为：切换 `isActive` 并持久化到 `agentStore.updateAgent`。
	- 反馈：Toast 显示切换成功。

### 13.7 状态与UI约束
- `Active` 状态：绿色标识
- `Inactive` 状态：灰色标识
- `Endpoint` 为空时显示 `Not configured`
- 无结果时显示空态提示：`No services matched current filters.`

### 13.8 与其他页面关系
- `Server Management` 是 Service 配置管理入口。
- `Create Service` 可保留为 Agent 创建入口。
- `Agent Detail` 负责身份、流水、文档与测试。

### 13.9 MVP 验收标准
1. 可展示当前钱包下所有 Agent 与其注册 Service。
2. 支持按服务名称搜索。
3. 支持按状态筛选（All/Active/Inactive）。
4. 支持分页浏览。
5. 支持从列表新增、编辑、上线/下线服务。

---

## 14. 新版架构基线（以本节为准）

### 14.1 核心层级
- `1 Wallet -> N Agents -> N Services`
- `1 Service = 1 API Interface (endpoint)`

### 14.2 关键定义
1. **Wallet**：租户与收益归集主体。
2. **Agent**：能力执行与服务容器，承载多个 Service。
3. **Service**：最小可计费接口单元，独立 `serviceId + pricing + endpoint + status`。

### 14.3 建模约束
- Wallet 下 Agent 可多。
- Agent 下 Service 可多。
- Service 与 endpoint 一对一。
- `serviceId` 建议在 `ownerAddress + agentId` 范围内唯一。

---

## 15. 前端页面排版规划（模块化设计）

### 15.1 信息架构总览
建议前端控制台拆为 4 个一级模块：

1. **Overview（总览）**
	 - 路由：`/dashboard`
	 - 内容：收益 KPI、调用趋势、最近支付流水。

2. **Agent Management（Agent 管理）**
	 - 路由：`/dashboard/agents`（建议新增）
	 - 能力：查看 Agent 列表、创建 Agent、修改 Agent（名称/角色）、查看 Agent 详情。

3. **Service Management（Service 管理）**
	 - 路由：`/dashboard/services`
	 - 能力：创建 Service、修改 Service、上线/下线、查询筛选、分页。
	 - 约束：每个 Service 必须关联一个 Agent。

4. **Integration & Test（接入与测试）**
	 - 路由：`/dashboard/services/[id]` 或独立 `integration` 子页
	 - 内容：FastAPI Boilerplate、Buyer 调用片段、Pay + Invoke 测试。

### 15.2 页面排版建议（Desktop 优先）

#### A. Agent 管理页
布局：`Header + Filter Bar + List/Table + Pagination`

- Header
	- 左：页面标题与说明
	- 右：`Create Agent` 按钮

- Filter Bar
	- `Search by agent name`
	- `Role filter`（Seller / Buyer / Hybrid，若启用）

- List/Table
	- 列：`Agent Name | Role | Wallet Address | Service Count | Created Time | Actions`
	- Actions：`View / Edit / Disable`

- Drawer/Panel（编辑区）
	- 字段：`Agent Name`、`Role`
	- 保存后回刷列表

#### B. Service 管理页
布局：`Header + Create/Edit Form + Search/Filter Bar + Service Table + Pagination`

- Header
	- 标题：`Server Management`
	- 主按钮：`Register Service`

- Create/Edit Form（固定在列表上方）
	- 字段：`Agent`（必选）
	- 字段：`Service Name / Service ID / Pricing / Endpoint / Status`
	- 按钮：`Save`、`Cancel Edit`

- Search/Filter Bar
	- `Search by service name`
	- `Filter by status`
	- `Filter by agent`
	- `Sort by created time`

- Service Table
	- 列：`Service Name | Agent | Service ID | Pricing | Status | Endpoint | Actions`
	- Actions：`Edit / Online-Offine / Open Detail`

### 15.3 模块职责边界（避免混乱）
- **Agent 管理页**：只管 Agent 身份与容器属性。
- **Service 管理页**：只管 Service 配置与可用状态。
- **Agent 详情页**：展示身份、流水、资金、接入文档与测试，不做 Service 配置编辑。

### 15.4 关键交互流程
1. 用户进入 Agent 管理页创建 Agent。
2. 进入 Service 管理页，选择 Agent 并注册多个 Service。
3. 在 Service 管理页进行上线/下线、编辑、查询与分页浏览。
4. 在详情/接入页完成支付调用测试与联调。

### 15.5 Agent 是否需要区分 Seller 和 Buyer？

结论分两层：

1. **MVP（当前建议）**
	 - **Agent 默认仅作为 Seller（Provider）处理。**
	 - Buyer 是调用方身份，不必建成 Agent 实体。
	 - 优点：模型简单、页面负担小、落地快。

2. **扩展版（需要多角色生态时）**
	 - 可引入 `agentRole: seller | buyer | hybrid`。
	 - 仅当出现“买方自动代理编排/谈判”等复杂场景再启用。

推荐：当前先采用 Seller-only Agent，保留 role 字段以兼容未来扩展。

### 15.6 视觉分区建议
- 顶部主导航：`Overview | Agents | Services | Router`
- 页面统一三段：`标题区 -> 操作区 -> 数据区`
- 数据区统一规则：
	- 桌面端表格 + 分页
	- 移动端卡片堆叠
	- 空态与错误态必须显式展示

### 15.7 验收标准（页面排版层）
1. Agent 与 Service 的入口、表单、列表明确分区，不混在同一编辑上下文。
2. Service 创建时必须选择 Agent，形成强关联。
3. Service 管理支持查询、筛选、分页、上线/下线。
4. Agent 详情页不再承担 Service 配置编辑职责。

---

## 16. 数据取值与存储完整方案（实施版）

本节定义“每个字段从哪里来、写到哪里、何时刷新、异常如何降级”，用于统一前端、后端与链上口径。

### 16.1 设计目标
1. **单字段单权威来源（Single Source of Truth）**。
2. **配置数据与观测数据解耦**：Agent 配置走本地，Service 配置走后端，余额与收益走链上/索引层。
3. **可降级**：任一来源故障时页面可读，不出现整页不可用。
4. **可演进**：MVP 可用，后续可平滑迁移到数据库与索引服务。

### 16.2 三类数据域

1. **配置域（Configuration Domain）**
	- 内容：Agent、Service 配置（名称、角色、serviceId、pricing、endpoint、isActive）。
	- 特性：读多写少、需要持久化、可由用户编辑。

2. **链上事实域（On-chain Facts Domain）**
	- 内容：USDC/ETH 余额、`ServicePaid` 事件、合约参数。
	- 特性：不可篡改、读取较慢、需要格式化与聚合。

3. **运营统计域（Operational Stats Domain）**
	- 内容：收入/支出汇总、调用成功率、状态分布。
	- 特性：可由后端聚合，也可由链上事件重算。

### 16.3 字段级口径（必须遵守）

| 字段 | 权威来源 | 读取方式 | 刷新策略 | 备注 |
|---|---|---|---|---|
| ownerAddress | 钱包连接态（wagmi） | 前端内存 | 钱包变更时 | 租户边界 |
| Agent 基础信息 | `agentStore`（MVP） | localStorage | 页面进入/刷新 | 后续可迁移 DB |
| Service 配置 | 后端 `services` API | FastAPI + JSON/DB | 页面进入/保存后 | 以 ownerAddress 隔离 |
| Agent USDC 余额 | 链上 MockUSDC | `balanceOf(address)` | 页面加载+手动刷新 | 统一 18 decimals |
| Agent ETH 余额 | 链上 RPC | `provider.getBalance` | 页面加载+手动刷新 | 展示 gas 能力 |
| ServicePaid 流水 | 链上 Router 事件 | `queryFilter` | 页面加载+手动刷新 | 作为收益事实 |
| Gross/Fee/Net | 链上事件聚合 | 前端计算 | 每次事件刷新后 | 不依赖业务后端 |
| Agent 收入/支出（MVP） | 后端 tasks 接口 | `GET /api/client/tasks?agent=` | 页面加载+手动刷新 | 作为运营统计口径 |

> 规则：同一页面同一指标只使用一种口径；Service 配置字段固定以后端 `services` API 为唯一口径。

### 16.4 存储分层设计

#### L0（运行时内存）
- React `useState`：页面渲染态、复制状态、弹窗状态。
- 不持久化，刷新丢失。

#### L1（浏览器持久层）
- `agentStore`（localStorage）。
- 用于 Agent 身份配置持久化（MVP）。

#### L2（链上状态层）
- RPC `127.0.0.1:8545` + 合约读取。
- 用于余额、事件、事实型数据。

#### L3（后端统计层）
- FastAPI 任务接口（运营/流程态）。
- 用于运营统计与业务态补充。

### 16.5 读取流程（Dashboard 标准流程）

1. 获取 `ownerAddress`。
2. 从 L1 读取 Agent 配置，并从后端读取 Service 配置。
3. 并行读取 L2：
	- Agent 余额（USDC/ETH）
	- ServicePaid 事件
4. 读取 L3（可选）：Agent 任务收入/支出统计。
5. 在前端聚合并渲染：
	- Tier1（钱包余额）
	- Tier2（收益指标）
	- Agent 列表（地址、余额、收入/支出）

### 16.6 写入流程（配置变更）

1. 用户创建/编辑 Agent 或 Service。
2. 前端校验字段（serviceId、pricing、endpoint、status）。
3. Service 写入后端 `services` API；Agent 仍写入 L1（localStorage）。
4. 触发页面重读并刷新内存态。
5. 不做链上写入（MVP）。

> 约束：配置写入成功不代表链上可调用；是否可调用仍由支付验证与服务状态共同决定。

### 16.7 刷新策略

1. **事件触发刷新**
	- 钱包切换
	- 新增/编辑/上下线配置后
	- 手动点击刷新按钮

2. **轮询（可选）**
	- Dashboard 可选每 15~30 秒轻量刷新余额与事件。
	- 避免高频全量重算（尤其 `queryFilter`）。

3. **一致性优先级**
	- 链上事实 > 后端统计 > 本地缓存展示。

### 16.8 异常与降级策略

1. RPC 不可用：
	- 余额显示 `0.00` 或 `--`，并提示“链上读取失败”。
2. 后端不可用：
	- 收入/支出显示 `0.00`，不阻塞页面其他模块。
3. localStorage 异常：
	- 仅影响 Agent 身份配置；Service 列表仍可由后端返回。
4. 多来源冲突：
	- 以字段口径表为准，不进行隐式覆盖。

### 16.9 数据一致性规范

1. **金额统一格式化**
	- USDC：`toFixed(2)`（展示层）
	- ETH：`toFixed(4)`（展示层）

2. **地址统一处理**
	- 统一小写比较，保留 checksum 展示。

3. **事件聚合窗口**
	- 默认全量（fromBlock=0）在本地开发可接受。
	- 生产需改为“增量同步 + 游标（lastSyncedBlock）”。

### 16.10 安全与隐私边界

1. 私钥仅保存在本地（当前 MVP），不上传后端。
2. 展示层私钥默认遮罩，点击显式 reveal。
3. 复制操作提供显式反馈，避免误操作。
4. 后端接口调用应带 `X-User-Address` 与会话标识。

### 16.11 生产化演进路线

#### Phase A（当前 MVP）
- Agent 配置：localStorage
- Service 配置：后端 `services` API
- 事实：链上直读
- 统计：后端任务接口

#### Phase B（推荐近期）
- 新增 `provider_config` 数据库表，托管 Agent/Service 配置。
- 前端通过 API 读取配置，localStorage 仅用于 Agent 临时缓存。

#### Phase C（稳定期）
- 增加索引服务（Indexer）处理 `ServicePaid`，前端读取聚合结果。
- 引入统一数据访问层（Data Access Layer）与版本化字段口径。

### 16.12 文档化验收标准（DoD）

1. 所有页面字段都能在“字段级口径表”找到来源。
2. 每类数据都定义了刷新时机与失败降级。
3. 代码实现遵守“单字段单权威来源”原则。
4. MVP 与生产演进路径清晰、可执行。

---

## 17. 页面字段 -> 数据来源对照矩阵（开发执行表）

本节用于前端开发直接对照实现。每个字段明确“来源、读取方式、刷新、降级”。

### 17.1 Dashboard（`/dashboard`）

| 页面模块 | 字段 | 来源层 | 获取方式 | 刷新时机 | 降级策略 |
|---|---|---|---|---|---|
| Tier1 Master | Master USDC Balance | L2 链上 | `MockUSDC.balanceOf(ownerAddress)` | 首次加载/手动刷新/钱包切换 | 显示 `0.00` + 异常提示 |
| Tier1 Master | 钱包地址 | 钱包连接态 | wagmi `useAccount()` | 钱包切换 | `Not Connected` |
| Tier2 KPI | Service Wallets Total | L2 链上聚合 | 各 Service 地址 `balanceOf` 累加 | 首次加载/手动刷新 | `0.00` |
| Tier2 KPI | Total Earned | L2 链上事件 | `ServicePaid.amount` 聚合 | 事件刷新/手动刷新 | `0.00` |
| Tier2 KPI | Total Platform Fee | L2 链上事件 | `ServicePaid.fee` 聚合 | 事件刷新/手动刷新 | `0.00` |
| Tier2 KPI | Paid Calls (24h) | L2 链上事件 | 24h 时间窗计数 | 事件刷新/手动刷新 | `0` |
| Agent Table（空服务态） | Agent 名称/角色/地址 | L1 配置 | `agentStore.getAgentsByOwner` | 首次加载/刷新 | 空态提示 |
| Agent Table（空服务态） | 地址复制状态 | L0 内存态 | React state | 点击复制后 | 状态回落 |
| Agent Table（空服务态） | Agent USDC/ETH Balance | L2 链上 | `balanceOf` + `getBalance` | 首次加载/手动刷新 | `0.00 / 0.0000` |
| Agent Table（空服务态） | Agent Income/Expense（MVP） | L3 后端统计 | `GET /api/client/tasks?agent=...` | 首次加载/手动刷新 | `0.00 / 0.00` |
| Service Cards（有服务态） | Service 配置字段 | 后端配置 | `listServiceRegistry` + `agentStore` 关联 | 首次加载/编辑后刷新 | 隐藏异常字段 |
| Service Cards（有服务态） | Service Balance | L2 链上 | `balanceOf(service.sellerAddress)` | 首次加载/手动刷新 | `0.00` |
| Event Stream | ServicePaid 列表 | L2 链上事件 | `queryFilter(ServicePaid)` | 首次加载/手动刷新 | 空列表提示 |

### 17.2 Agent Management（`/dashboard/agents`）

| 页面模块 | 字段 | 来源层 | 获取方式 | 刷新时机 | 降级策略 |
|---|---|---|---|---|---|
| 列表表格 | Agent 名称/角色/地址 | L1 配置 | `agentStore.getAgentsByOwner` | 首次加载/保存后 | 空态提示 |
| 列表表格 | Details 按钮跳转 | 路由参数 | `agent.id` | 渲染时 | 按钮隐藏（异常） |
| 新增/编辑弹窗 | 表单字段（name/role） | L0 内存态 | React state | 输入变化 | 校验阻断提交 |
| 新增/编辑弹窗 | 生成钱包地址/私钥 | 本地计算 | `ethers.Wallet.createRandom()` | 新建弹窗打开时 | 重新生成 |
| 新增/编辑弹窗 | 地址二维码 | L0 + 计算派生 | `QRCodeSVG(value=address)` | 地址变更 | 占位二维码 |
| 新增/编辑弹窗 | 地址复制/私钥复制状态 | L0 内存态 | React state + clipboard | 点击复制 | 复制失败 toast |
| 新增/编辑弹窗 | USDC/ETH 余额 | L2 链上 | `balanceOf(address)` + `getBalance(address)` | 弹窗打开/地址变更 | `0.00 / 0.0000` |
| 保存操作 | Agent 持久化 | L1 配置 | `agentStore.add/update` | 点击保存 | toast + 保持表单 |

### 17.3 Agent Detail（`/dashboard/agents/[id]`）

| 页面模块 | 字段 | 来源层 | 获取方式 | 刷新时机 | 降级策略 |
|---|---|---|---|---|---|
| Header | Agent 名称/角色 | L1 配置 | `agentStore.getAgent(id)` | 首次加载 | 跳回列表 |
| Identity 卡片 | 地址/私钥 | L1 配置 | `agentStore.getAgent(id)` | 首次加载 | 跳回列表 |
| Identity 卡片 | 地址/私钥复制状态 | L0 内存态 | React state + clipboard | 点击复制 | 复制失败 toast |
| Identity 卡片 | 私钥 reveal 状态 | L0 内存态 | React state | 点击 reveal | 默认遮罩 |
| Balance 卡片 | USDC/ETH 余额 | L2 链上 | `balanceOf` + `getBalance` | 首次加载/手动刷新（可扩展） | `0.00 / 0.0000` |
| QR 卡片 | 地址二维码 | 派生 | `QRCodeSVG(address)` | 地址变更 | 占位二维码 |

### 17.4 Service Management（`/dashboard/services`）

| 页面模块 | 字段 | 来源层 | 获取方式 | 刷新时机 | 降级策略 |
|---|---|---|---|---|---|
| 列表表格 | Service Name/ID/Pricing/Endpoint/Status | 后端配置 | `listServiceRegistry(ownerAddress)` | 首次加载/保存后 | 空态提示 |
| 关联关系 | Agent 显示字段 | L1 配置 | `service.agentId` -> `agentStore` | 首次加载/保存后 | 显示 `Unknown Agent` |
| 筛选搜索 | 名称/状态/Agent 过滤 | L0 内存态 + L1 | 前端计算过滤 | 条件变化实时 | 无结果提示 |
| 分页 | current/total page | L0 内存态 + 派生 | 前端分页计算 | 条件变化重置页码 | 回落到第 1 页 |
| 新增/编辑 | 表单字段 | L0 内存态 | React state | 输入变化 | 字段级错误 |
| 保存操作 | Service 持久化 | 后端配置 | `createServiceRegistry/updateServiceRegistry` | 点击保存 | toast + 保留表单 |

### 17.5 Service Detail（`/dashboard/services/[id]`）

| 页面模块 | 字段 | 来源层 | 获取方式 | 刷新时机 | 降级策略 |
|---|---|---|---|---|---|
| Agent Identity | 名称/地址/私钥 | L1 配置 | `agentStore.getAgent(id)` | 首次加载 | 跳回 Dashboard |
| Service 主配置 | serviceId/serviceName/pricing/invoke/isActive | 后端配置 | `listServiceRegistry` 后按 `agentId/address` 匹配主服务 | 首次加载 | 显示未配置 |
| On-chain USDC | Service 余额 | L2 链上 | `MockUSDC.balanceOf(service.address)` | 首次加载/手动刷新 | `0.00` |
| Payment Ledger | 交易流水（MVP） | L3 后端 | `/api/client/tasks?agent=...` | 首次加载/刷新 | 空列表 |
| Integration Docs | FastAPI / Buyer Snippet | L1 配置派生 | 模板字符串生成 | 配置变更后重算 | 占位模板 |
| Pay & Invoke | 调用结果 | L2 + L3 联动 | 支付后调用 endpoint | 用户触发 | 明确错误态 |

### 17.6 执行约束（必须）

1. 新增页面字段时，必须先补本节矩阵，再落代码。
2. 同一字段禁止双来源混用；Service 配置字段禁止从 localStorage 读取。
3. 接口失败必须有可见降级，不允许空白或静默失败。
4. 任何金额展示必须显式标注单位（USDC/ETH）。

### 17.7 扩展矩阵（Owner + 验收测试点）

本小节在 17.1~17.5 的基础上补充两列：
- `Owner`：该字段/模块的主责任方
- `验收测试点`：联调或回归时必须验证的关键行为

#### 17.7.1 Dashboard 扩展矩阵

| 页面模块 | 字段组 | Owner | 验收测试点 |
|---|---|---|---|
| Tier1 Master | Master USDC Balance + 钱包地址 | Frontend + Chain | 切换钱包后余额与地址同步变化；RPC 异常时显示降级值 |
| Tier2 KPI | Earned/Fee/Paid Calls | Frontend + Chain | 刷新后与链上事件统计一致；无事件时显示 0 |
| Agent Table（空服务态） | Agent 基础信息 | Frontend | 新增/编辑 Agent 后列表即时更新 |
| Agent Table（空服务态） | 地址复制状态 | Frontend | 点击复制后 icon 状态切换并自动回落 |
| Agent Table（空服务态） | USDC/ETH 余额 | Frontend + Chain | RPC 在线显示真实值；RPC 失败显示 `0.00/0.0000` |
| Agent Table（空服务态） | Income/Expense（MVP） | Backend + Frontend | 后端返回有效 tasks 时统计正确；接口失败时显示 `0.00/0.00` |
| Event Stream | ServicePaid 列表 | Frontend + Chain | 事件条目可见且排序正确；空数据有空态提示 |

#### 17.7.2 Agent Management 扩展矩阵

| 页面模块 | 字段组 | Owner | 验收测试点 |
|---|---|---|---|
| Agent 列表 | 名称/角色/地址 | Frontend | 保存后列表刷新；仅显示当前钱包数据 |
| Actions | Details/Edit 路由与弹窗 | Frontend | Details 跳转成功；Edit 打开并载入正确 Agent |
| 新增弹窗 | 钱包生成（地址/私钥/二维码） | Frontend | 每次新建生成新地址；二维码与地址一致 |
| 编辑弹窗 | 余额展示（USDC/ETH） | Frontend + Chain | 打开编辑时读取当前 Agent 地址余额 |
| 保存逻辑 | add/update 持久化 | Frontend | 刷新页面后数据仍在（localStorage） |

#### 17.7.3 Agent Detail 扩展矩阵

| 页面模块 | 字段组 | Owner | 验收测试点 |
|---|---|---|---|
| Header/Identity | 名称/角色/地址/私钥 | Frontend | 非 owner 访问被拦截；不存在 id 跳回列表 |
| Security UX | 私钥 reveal + copy | Frontend | 默认遮罩；点击 reveal 后可见；复制反馈正常 |
| Balance | USDC/ETH | Frontend + Chain | 页面加载完成后显示链上余额；失败降级 |

#### 17.7.4 Service Management 扩展矩阵

| 页面模块 | 字段组 | Owner | 验收测试点 |
|---|---|---|---|
| Service 列表 | Name/ID/Pricing/Endpoint/Status | Frontend | 新增/编辑后列表立即正确反映 |
| 关联关系 | Service -> Agent | Frontend | 选择 Agent 后保存，列表能正确显示归属 |
| 查询筛选 | 搜索/状态/分页 | Frontend | 条件变化时结果正确，分页自动回到第一页 |
| 持久化 | add/update/remove | Frontend | 刷新后数据保持一致 |

#### 17.7.5 Service Detail 扩展矩阵

| 页面模块 | 字段组 | Owner | 验收测试点 |
|---|---|---|---|
| Identity + 主配置 | Agent 与 Service 核心字段 | Frontend | 字段展示与配置源一致；无配置时有占位 |
| Balance + Ledger | 链上余额 + 后端流水（MVP） | Frontend + Chain + Backend | 余额来自链上；流水来自后端；任一失败不阻塞页面 |
| Integration Docs | FastAPI / Buyer Snippet | Frontend | 配置修改后模板内容同步更新 |
| Pay & Invoke | 支付 + 调用链路 | Frontend + Chain + Backend | 成功链路返回结果；失败链路返回明确错误态 |

#### 17.7.6 责任划分约定

1. `Frontend`：展示、状态管理、降级策略、交互一致性。
2. `Backend`：tasks 统计口径、鉴权、错误码稳定性。
3. `Chain`：余额/事件读取正确性与 RPC 可用性。
4. 跨域字段（Frontend + Backend + Chain）默认需要联调用例，不允许单侧验收。

---

## 18. 客户端权限验证与数据隔离安全设计（Wallet Tenant Isolation）

本节回答两个核心问题：
1. 客户端权限如何验证。
2. 如何保证用户只能查看/修改自己钱包关联的 Agent 与 Service。

### 18.1 安全目标

1. **同钱包租户隔离**：`Wallet A` 不能读取或修改 `Wallet B` 数据。
2. **鉴权不可伪造**：不能只信任前端传入的 `ownerAddress`。
3. **最小权限原则**：每个接口只暴露必要数据与操作。
4. **可审计**：关键读写动作要有可追踪日志。

### 18.2 威胁模型（最小集合）

1. 攻击者篡改请求体中的 `ownerAddress`。
2. 攻击者枚举 `serviceId/id` 读取他人数据。
3. 攻击者重放旧登录令牌调用写接口。
4. 攻击者越权更新（已知 id 但不属于自己）。

### 18.3 认证模型（推荐：SIWE + 短时会话）

采用“钱包签名登录 + 服务端签发短时 token”的双阶段模型：

1. `GET /api/v1/auth/challenge`
	- 服务端生成随机 `nonce`（一次性，短时有效）。

2. 客户端用钱包签名 challenge（EIP-191/EIP-4361）。

3. `POST /api/v1/auth/verify`
	- 服务端验签，恢复地址 `recovered_address`。
	- 验证 `nonce` 未使用、未过期。
	- 签发会话 token（JWT 或 opaque session id）。

4. 后续请求统一携带：
	- `Authorization: Bearer <token>`
	- 可选 `X-User-Address`（仅用于观测，不作为授权依据）

> 强制规则：**ownerAddress 一律以服务端验签恢复地址为准**，忽略客户端自报地址。

### 18.4 授权模型（资源归属检查）

每个写操作和敏感读操作都执行“资源归属校验”：

1. 从 token 拿到 `subject_wallet`。
2. 查询目标资源（Agent/Service）的 `owner_address`。
3. 校验 `resource.owner_address == subject_wallet`。
4. 不满足时返回 `403 Forbidden`。

### 18.5 数据模型与索引约束

后端持久层（JSON/DB）至少包含：

```ts
Agent {
  id: string;
  owner_address: string; // 强制小写存储
  name: string;
  role: string;
  wallet_address: string;
  created_at: number;
  updated_at: number;
}

Service {
  id: string;
  owner_address: string; // 强制小写存储
  agent_id: string;
  name: string;
  service_id: string;
  pricing: string;
  endpoint: string;
  is_active: boolean;
  created_at: number;
  updated_at: number;
}
```

唯一性建议：
1. `agent.id` 全局唯一。
2. `service.id` 全局唯一。
3. 业务唯一键：`(owner_address, agent_id, service_id)`。

### 18.6 接口权限策略（必须执行）

#### 18.6.1 读接口

1. `GET /api/v1/services`
	- 不接受自由 owner 参数作为授权依据。
	- 只返回 `owner_address == subject_wallet` 的记录。

2. （可选）`GET /api/v1/services?ownerAddress=...`
	- 后端只接受 `ownerAddress == subject_wallet`。
	- 不匹配直接拒绝。

#### 18.6.2 写接口

1. `POST /api/v1/services`
	- 创建时不接受 `serviceId`，由系统生成。
	- 校验 `agentId` 必须属于 `subject_wallet`。
	- 校验 `invoke.method/url/timeoutMs/request.schema/response.schema`。

2. `PUT /api/v1/services/{id}`
	- 查询目标 service。
	- 校验其 owner 为 `subject_wallet`。
	- 禁止跨租户迁移 owner。
	- 禁止修改 `serviceId`。

3. `DELETE /api/v1/services/{id}`
	- 同上先查 owner，再删除。

### 18.7 服务端校验清单（代码层）

每次请求统一执行：

1. `require_auth()`：
	- 验 token 签名、过期时间、吊销状态。

2. `normalize_address()`：
	- 所有地址比较用小写；存储也用小写。

3. `enforce_owner(resource_owner, subject_wallet)`：
	- 不匹配立即 `403`。

4. `validate_input_schema()`：
	- serviceName、pricing、isActive、invoke。

5. `audit_log()`：
	- 记录 `subject_wallet`, `action`, `resource_id`, `status_code`, `request_id`。

### 18.8 前端配合策略（防误用，不替代后端授权）

1. 前端仅显示当前连接钱包数据。
2. 切换钱包后清空上一钱包缓存视图。
3. 不在 URL 暴露可枚举的敏感 owner 参数。
4. 所有后端 403 明确提示“无权限访问该资源”。

> 注意：前端过滤只提升体验，**真正安全边界在后端 owner 校验**。

### 18.9 存储层策略（JSON 现状 + DB 演进）

#### 当前 JSON 版本（MVP）
1. 文件中每条记录带 `ownerAddress`。
2. 读写都在服务端按 `subject_wallet` 过滤。
3. 拒绝任何“按任意 ownerAddress 查询”的开放能力。

#### 数据库版本（推荐）
1. `services`、`agents` 表强制 `owner_address not null`。
2. 查询默认条件 `WHERE owner_address = :subject_wallet`。
3. 若用 Postgres，建议加 RLS（Row Level Security）：
	- `USING (owner_address = current_setting('app.user_wallet'))`

### 18.10 错误码约定

1. `401 Unauthorized`：未登录/Token 无效。
2. `403 Forbidden`：已登录但资源不属于该钱包。
3. `404 Not Found`：资源不存在（或隐藏越权资源细节）。
4. `409 Conflict`：唯一键冲突（重复 serviceId 等）。

### 18.11 验证用例（必须通过）

1. `Wallet A` 登录后创建 Service，`Wallet B` 请求 `update/delete` 必须失败。
2. `Wallet B` 篡改 body 中 `ownerAddress=WalletA`，仍应被拒绝。
3. `Wallet A` 只能看到自己的列表条目，无法看到 B 的 id。
4. 过期 token 发起写操作返回 `401`。
5. 重放旧 challenge 签名无法再次登录。

### 18.12 实施优先级

P0（立刻）
1. 后端统一 token 验证中间件。
2. 所有 Service/Agent 接口加 owner 校验。
3. 接口忽略客户端自报 ownerAddress。

P1（近期）
1. 增加审计日志与 request_id。
2. 增加 delete 接口并做同样授权。
3. 增加自动化越权测试。

P2（中期）
1. 迁移 DB + RLS。
2. 引入刷新 token、会话吊销列表。