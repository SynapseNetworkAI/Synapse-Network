# Identity, Authentication, and Risk Control

- Status: canonical
- Code paths: `gateway/src/`, `apps/frontend/src/`, `sdk/python/`, `admin/gateway-admin/src/`
- Verified with: `npm run ci:gateway`, `npm run ci:frontend`, `npm run ci:sdk-python`, `npm run ci:admin-gateway`, `npm run ci:docs`
- DB sources: `docker-compose/postgres/init/gateway/001_synapse_schema.sql`
- Supersedes: former `docs/agent/00_Platform_Role_Identity_Model.md` for role layering and identity boundaries; former `docs/agent/04_Credential_Budget_Risk_Model.md` for credential and runtime risk boundaries
- Last verified against code: 2026-03-24

## 1. 目标

本文件定义 Synapse 如何把身份、鉴权和风控串成统一控制链，而不是三套彼此割裂的子系统。

当前角色与身份边界的 canonical 解释以本文件为准。former `docs/agent/00_Platform_Role_Identity_Model.md` 与 former `docs/agent/04_Credential_Budget_Risk_Model.md` 已完成退役，不再单独定义长期身份模型或风控边界。

## 2. 四层角色模型

Synapse 当前最稳定的 build-for-agent 身份边界是四层，而不是简单的 `owner / provider / platform` 三分法。

| 角色 | 身份层级 | 核心职责 | 不该承担的职责 |
| --- | --- | --- | --- |
| Owner | 租户根身份 | 充值、创建 Agent、设预算、注册服务、查看账单 | 不应逐次手工批准每次 Agent 调用 |
| Agent | Owner 授权出来的运行时身份 | Discovery、Quote、Invoke、消耗预算 | 不应接触主钱包私钥或修改控制面资源 |
| Provider | Owner 的供给侧业务角色 | 维护 Manifest、运营服务、累积收益、提现 | 不是独立于 Owner 的第二套根账户体系 |
| Platform | 平台内部系统角色 | 鉴权、风控、路由、记账、审计、结算 | 不应被暴露成租户侧业务主体 |

一句话：

1. Owner 是账户根。
2. Agent 是运行时执行体。
3. Provider 是 Owner 的 supply-side role。
4. Platform 是系统执行与结算角色。

## 3. 身份分层

### 3.1 Owner Identity

Owner 是控制面根身份。

Owner 负责：

1. session 建立
2. deposit
3. create agent
4. set budget
5. provider role operations

当前 wallet-first auth 已经进一步约束了 Owner profile 的落点和写入方式：

1. `synapse_owner_accounts` 承载 Owner 的可选 profile 字段，例如 `display_name`、`email`、`notify_marketing`、`notify_alerts`
2. 这些字段只是附着在 Owner wallet 上的运营元数据，不是第二套账户体系
3. profile 读取可以只依赖 JWT，但 profile 写入必须再走一次 wallet challenge + signature，避免 stale session 伪造配置更新

### 3.2 Agent Credential

Agent credential 是 Runtime 支付身份。

它的职责是：

1. 绑定 agent
2. 限定预算
3. 限定调用范围
4. 承担自动调用的最小权限执行面

当前 runtime 支付身份至少分成三层对象：

1. `AgentProfile`
2. `AgentCredential`
3. `BudgetPolicy`

这里的硬边界是：

1. Agent 持有的是运行时 secret 和最小必要上下文。
2. Owner 与 Gateway 才能看到完整预算策略、吊销状态、风控标签和审计元数据。
3. `owner_wallet` 之类绑定信息属于平台控制面和审计面，不应成为外部运行时协议字段。

### 3.2.1 Connector OAuth Token

ChatGPT custom MCP app 这类托管连接器不应拿到原始 `agt_xxx`。Synapse first-party OAuth 把连接器凭据与运行时支付身份分开：

1. ChatGPT 获取的是 Synapse OAuth access token / refresh token。
2. OAuth authorization code 必须使用 PKCE S256，短期、一次性使用。
3. Refresh token 是 opaque token，服务端只保存 hash，并在刷新时旋转。
4. Access token 的 audience/resource 必须是 `https://mcp.synapse-network.ai/mcp`，不能被复用于其他资源。
5. Gateway 校验 OAuth token 后，按 token grant 绑定的 `credential_id` 找到 Owner 授权的 Agent Credential。
6. 扣费、预算、调用上限、receipt 归属仍然只看映射后的 Agent Credential。

这意味着 OAuth token 是 connector authorization，不是 Agent Credential 本身。撤销 OAuth grant 不需要泄露或轮换 `agt_xxx`；撤销 Agent Credential 则会让所有映射到它的 OAuth token 失去运行时能力。

### 3.3 Provider Role

Provider 不是另一套根身份，而是 Owner 的供给侧业务角色。

服务注册、收益归属、Provider Console 工作区本质上仍然是 owner-scoped。

### 3.4 Platform Admin

Admin 身份必须和普通 Owner 完全隔离。

## 4. 同一个 Owner 同时消费和供给

同一个 Owner 可以同时拥有：

1. Consumer workspace
2. Provider workspace
3. 多个 Agent runtime 身份

这里不会冲突，前提是坚持两条铁律：

1. 身份归属看 Owner。
2. 记账归类看资金桶和业务动作，不看“这个钱包当前更像买家还是卖家”。

因此退款与提现不会因为同一个钱包地址而打架，真正的隔离来自：

1. `consumer_wallet` 与 `provider_wallet` 分桶
2. `consumer_refund` 与 `provider_withdrawal` 分动作
3. owner scope 相同但账本语义不同

## 5. 鉴权原则

### 5.1 默认拒绝

除公开 discover 或网络摘要接口外，所有写路径都要求有效身份。

### 5.2 Owner Binding

任何 owner-scoped 行为，都必须由服务端 token subject 推导 owner，而不是信任客户端字段。

### 5.3 Least Privilege

1. Owner 控制面只能操作自己资源
2. Agent credential 只能在被授权 scope 内运行
3. Provider 只能操作自己归属的 service
4. Admin 权限必须独立

## 6. 风控分层

### 6.1 Funding Risk

关注：

1. deposit replay
2. tx hash duplication
3. suspicious funding source
4. reconciliation mismatches

### 6.2 Runtime Risk

关注：

1. budget exhaustion
2. daily cap hit
3. rate limiting
4. scope denied
5. abnormal failure spikes

Gateway 对 runtime 调用的判定顺序应固定为：

1. Credential 是否存在
2. Credential 是否有效且未吊销
3. Quote 是否存在且未过期
4. Service 是否在允许范围
5. 单次调用是否超过 `per_invocation_cap_usdc`
6. 当日累计是否超过 `daily_cap_usdc`
7. 生命周期累计是否超过 `lifetime_cap_usdc`
8. RPM / QPS 是否超限
9. Owner 主账户可用余额是否足够

这套顺序不能乱，先挡最便宜的检查，再做最贵的执行。

### 6.3 Payout Risk

关注：

1. provider withdrawal amount spikes
2. account age and behavior anomaly
3. liquidity pressure
4. payout address anomaly

## 7. 风险等级

当前最稳定的分级模型是：

1. `green`
2. `yellow`
3. `red`

语义：

1. `green` 自动放行
2. `yellow` 进入人工审核或额外检查
3. `red` 直接拒绝并审计

## 8. 风控执行点

### 8.1 Deposit

在登记和确认阶段检查：

1. tx uniqueness
2. amount validity
3. chain event match

### 8.2 Quote / Invoke

在执行前检查：

1. credential validity
2. budget validity
3. rate limits
4. service scope
5. balance sufficiency

### 8.3 Refund / Withdrawal

在出金前检查：

1. source bucket correctness
2. amount sufficiency
3. abnormal patterns
4. manual review threshold
5. signature / nonce / deadline requirements

## 9. Admin Risk Control Plane

Risk control 不应只停留在 Gateway 内部逻辑，还必须在 Admin plane 有可观察性。

至少要可见：

1. yellow queue
2. red alerts
3. liquidity status
4. deposit reconciliation backlog
5. abnormal invocation clusters

## 10. 文档结论

Synapse 的身份和风控不是“登录之后再补几条校验规则”，而是：

**Owner root identity + Agent runtime credential + Provider role + risk gates**

共同组成的统一控制链。
