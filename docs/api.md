# Synapse Network API Contract

> 核心定位：这是面向 build-for-agent Runtime 的平台 API 合约总表，不再按旧控制台角色或旧字段命名组织。

## 1. API 分类

### 1.1 Authentication APIs

1. `GET /api/v1/auth/challenge`
2. `POST /api/v1/auth/verify`
3. `POST /api/v1/auth/logout`

### 1.2 Owner Session Business APIs

1. `GET /api/v1/balance`
2. `POST /api/v1/balance/deposit/attempts`
3. `POST /api/v1/balance/deposit/intent`
4. `GET /api/v1/balance/deposit/intents`
5. `POST /api/v1/refund`
6. `GET /api/v1/refunds`
7. `GET /api/v1/usage/logs`
8. `POST /api/v1/providers/withdrawals/intent`
9. `GET /api/v1/providers/withdrawals/capability`
10. `GET /api/v1/providers/withdrawals`
11. `POST /api/v1/providers/withdrawals/{withdrawalId}/complete`
12. `GET /api/v1/router/config`
13. `POST /api/v1/router/config`
14. `GET /api/v1/finance/audit-logs`
15. `GET /api/v1/admin/fee-policy`
16. `PUT /api/v1/admin/fee-policy`
17. `POST /api/v1/admin/deposits/replay`
18. `GET|POST|PUT|DELETE /api/v1/services*` except public discover

### 1.3 Public or Runtime APIs

1. `GET /api/v1/services/discover`
2. `GET /api/v1/services/network-stats`
3. `POST /api/v1/services/quote`
4. `POST /api/v1/gateway/generate`
5. `GET /api/v1/indexer/status`

## 2. Identity Semantics

统一身份原则：

1. `Owner` 是 session 根身份。
2. `Agent Credential` 是 Runtime 调用凭据。
3. `Provider` 是 Owner 的供给侧业务角色，不是另一套根账户。
4. 同一个 Owner 可以同时拥有消费侧资金桶和供给侧收益桶。

## 3. Finance API Semantics

### 3.1 `GET /api/v1/balance`

返回当前 Owner 的余额摘要。

目标态语义：

1. `consumerAvailableBalance`
2. `consumerPendingBalance`
3. `consumerFrozenBalance`
4. `providerReceivableBalance`
5. `providerLockedBalance`
6. `platformFeeAccrued`

如果实现中仍保留历史字段名，应视为兼容层细节，不改变这里的业务语义。

### 3.2 `POST /api/v1/balance/deposit/intent`

用途：登记 Owner 向 Vault 的入金事实。

约束：

1. 要求 `X-Idempotency-Key`
2. 要求唯一 `txHash`
3. 先进入 `PENDING_CONFIRMATION`
4. 资金先进入 `consumer_pending`
5. 确认后才转 `consumer_available`
6. 同一 `txHash` 在 replay-protection window 内重复提交时，返回已存在的 intent，保持稳定业务结果

### 3.2.1 `GET /api/v1/balance/deposit/sync?txHash=...`

这是前端轮询充值同步状态的只读接口。

返回约定：

1. `found = false`：后端当前还没看到这个 `owner + txHash` 的 deposit intent
2. `found = true, status = PENDING_CONFIRMATION`：后端已同步到 intent，但还没确认到账
3. `found = true, status = CONFIRMED`：后端已确认到账，可以刷新余额
4. `canRefreshBalance = true` 只在 `CONFIRMED` 时返回 true

核心字段：

1. `txHash`
2. `found`
3. `synced`
4. `status`
5. `confirmed`
6. `canRefreshBalance`
7. `depositIntentId`
8. `amountUsdc`
9. `creditedAmountUsdc`
10. `confirmations`
11. `eventKey`
12. `confirmedAt`
13. `updatedAt`

### 3.3 `POST /api/v1/refund`

用途：从当前 Owner 的消费侧余额发起退款。

约束：

1. 仅作用于消费侧资金桶
2. 必须绑定 origin request 或 origin tx
3. 默认退回 owner 原地址
4. 大额或异常拆分进入人工审核

### 3.4 `POST /api/v1/providers/withdrawals/intent`

用途：当前 Owner 在 Provider Workspace 发起收益提现。

约束：

1. 仅作用于 `provider_receivable`
2. 同一个 Owner 的退款与提现可并存，但不能混用资金桶
3. 风控输出 `green / yellow / red`
4. `yellow` 进入人工审核
5. `red` 直接拒绝并审计

### 3.4.1 `GET /api/v1/providers/withdrawals/capability`

用途：给 Provider Settlements 页面返回“网关当前能否签发 withdraw ticket”的能力探测结果。

返回约定：

1. `ticketSigningEnabled` 表示服务端是否具备签发 EIP-712 withdrawal ticket 的最小条件。
2. `code` / `message` 返回当前阻塞原因，例如 `WITHDRAW_SIGNER_NOT_CONFIGURED`。
3. 前端必须先读该接口，再决定是否允许点击 `Generate & Claim`，避免把配置错误直接暴露成 500 交互。

## 4. Runtime Invocation Semantics

### 4.1 `GET /api/v1/services/discover`

用途：向 Agent 暴露可调用服务目录。

要求：

1. 返回 service、schema、price、health、routing contract
2. 不暴露 Provider 内部结算字段
3. 只返回当前健康可路由服务

### 4.1.1 `GET /api/v1/services/network-stats`

用途：给首页与公开营销页提供最小公共网络摘要。

要求：

1. 只返回聚合后的公共计数，不返回 wallet、request 级明细。
2. 至少包含 `registeredServices`、`discoverableServices`、`staleServices`、`runtimeReadyServices`、`totalCalls`、`connectedAgents`。
3. `totalCalls` 必须基于已接受/已成功的 charge 记录做 `requestId` 去重。
4. `connectedAgents` 只统计至少完成过一次已接受/已成功调用的 consumer 去重数量。
5. `registeredServices` 表示已注册且处于公开 active 生命周期的服务数；`discoverableServices` 表示当前处于健康窗口内、Agent 可发现的服务数；`staleServices` 表示仍处于 active 生命周期但健康快照已过期的服务数。
6. `runtimeReadyServices` 为兼容旧前端保留，当前等同于 `discoverableServices`。
5. 该接口服务首页的 live counters，不得扩张成泄露结算面的公开分析接口。

### 4.2 `POST /api/v1/services/quote`

用途：基于 service 和请求上下文生成价格确认。

要求：

1. 绑定 credential 和 service
2. 带有效期
3. 作为后续 invoke 的价格锚点

### 4.3 `POST /api/v1/gateway/generate`

用途：执行同步 Gateway invoke。

调用前：

1. 校验 owner scope
2. 校验 agent credential
3. 校验 budget policy
4. 校验 quote 或 service pricing policy
5. 校验 rate limit
6. 校验消费侧余额

调用后：

1. 成功则 capture
2. 原子完成消费侧扣减、供给侧收益累积、平台费累积、ledger、audit
3. 失败则 release 或 rollback

## 5. Service Control Plane

### 5.1 `GET|POST|PUT|DELETE /api/v1/services*`

用途：Owner 在 Provider Workspace 管理自己的服务。

要求：

1. service ownership 绑定当前 owner scope
2. Provider 只是业务角色，不是独立账户体系
3. manifest 字段必须对齐 `docs/agent/03_Service_Manifest_Field_Standard.md`
4. `serviceId` 是机器路由主键；Build Service Manifest 页面中的 `Agent Tool Name` 会直接映射到它
5. `serviceId` 必须全局唯一；重复注册返回 `422 SERVICE_REGISTRATION_INVALID`
6. 当前实现没有独立的服务注册人工审核流；请求校验通过且健康探测完成后，服务立即写入 owner registry。公共 discover 是否可见仍取决于 `status=active` 且运行健康

## 6. Audit and Admin APIs

### 6.1 `GET /api/v1/finance/audit-logs`

用途：返回 owner-scoped 金融审计事件。

### 6.1.1 `GET /api/v1/usage/logs`

用途：返回 owner-scoped invocation / billing 日志，供 Dashboard Invocations、结算明细和 owner 自查使用。

查询参数：

1. `page`，从 `1` 开始，默认 `1`
2. `pageSize`，默认 `20`，最大 `100`
3. `status`，可选，按调用状态过滤
4. `query`，可选，按 `invocation id / request id / service id / wallet` 模糊过滤
5. `limit`，兼容旧客户端的简化参数；传入时返回前 N 条最新记录

返回约定：

1. `logs` 为当前页记录
2. `count` 为当前页记录数
3. `total` 为过滤后的总记录数
4. `page` / `pageSize` 为服务端实际分页参数
5. `hasMore` 表示是否仍有下一页
6. 记录会尽量返回 `agentId` 与 `latencyMs`，用于 Invocations 页面展示真实调用流水视图

### 6.2 `GET /api/v1/indexer/status`

用途：返回充值索引器、backfill、reconciliation 的运行状态。

### 6.3 Admin APIs

1. 费率策略管理
2. 入金回放
3. 对账与告警观察

这些接口属于平台控制面，不属于 Agent-facing Runtime 协议。

## 7. Design Rules

1. 文档优先表达目标态业务语义，不再以旧字段名为组织中心。
2. Runtime 协议默认只暴露 service-facing 信息，不暴露 Provider 结算面。
3. 任何资金接口变更都必须同步更新本文件和对应专题文档。
