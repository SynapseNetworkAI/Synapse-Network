# Agent Runtime Gateway and Provider Routing Architecture

## 1. 架构定位

Platform Gateway 是 Synapse 的执行中枢，不是简单的 HTTP 转发器。

它同时承担：

1. Owner scope 绑定
2. Agent Credential 鉴权
3. 预算与限流校验
4. Quote / Invoke 契约执行
5. Provider 健康路由与防绕过转发
6. 账本扣费、收益累积、审计落库

## 2. 整体处理链路

```text
Agent Runtime
    -> Access Control
    -> Budget / Quote Validation
    -> Forwarding Policy
    -> Provider Authenticated Proxy
    -> Result Normalization
    -> Ledger / Audit Finalization
```

## 3. 核心设计原则

1. Gateway 对 Agent 暴露的是稳定服务协议，不暴露内部 Provider 结算面。
2. Gateway 对 Provider 暴露的是安全、可追踪、可签名校验的调用入口，不把预算和计费复杂度甩给 Provider。
3. Discover 与 Routing 必须使用同一套健康事实源，避免“发现可用、转发不可用”。

## 4. 处理分层

### 4.1 鉴权层

1. 从 session / token / credential 中推导 owner scope。
2. 校验 Agent Credential 是否有效、是否撤销、是否超预算。
3. 所有 owner-scoped 行为都以服务端推导结果为准，不接受客户端伪造 owner。

### 4.2 预算与预扣费层

1. 先校验 quote、rate limit、budget policy。
2. 再检查消费侧余额是否可支撑本次调用。
3. 需要预占时，必须走原子写路径，禁止内存先算再覆盖数据库。

### 4.3 反向代理层

1. 使用异步 IO 与连接池复用。
2. 对 Provider 上游设置 timeout、重试、熔断。
3. 把 `request_id / trace_id / service_id` 透传到 Provider。
4. Provider 返回后统一包装为平台响应面。

### 4.4 结算层

1. 调用成功后 capture。
2. 消费侧扣减、Provider 收益累积、平台费累积、ledger、audit 必须同事务。
3. 调用失败必须释放预占或回滚中间态。

## 5. Provider 健康路由

Gateway 必须周期性探测 Provider endpoint，并把结果写入统一健康事实源。

健康路由要求：

1. 只从健康目标池中做加权路由。
2. 当健康目标为零时，直接失败返回，不盲打故障节点。
3. Discover 页面与 Forwarding 主路径使用同一份健康快照。

## 6. Provider 防绕过机制

Provider endpoint 如果暴露在公网，平台必须提供 Gateway-to-Provider 认证机制。

推荐做法：

1. 平台为每个 Provider endpoint 维护专属共享密钥或平台签名校验机制。
2. Gateway 转发时附带 `request_id`、时间戳、签名摘要。
3. Provider 仅接受来自平台签名验证通过的请求。

这能防止第三方绕过计费网关直接打 Provider 公网接口。

## 7. Provider Manifest 契约

Provider 注册服务时至少声明：

1. `service_name`
2. `description_for_model`
3. `input_schema`
4. `output_schema`
5. `pricing`
6. `timeout_ms`
7. `health_check`
8. `auth_mode`

Manifest 的目标不是给人类读，而是给 Agent 和 Gateway 共同执行。

## 8. 对账与可观测

Gateway 必须让每次调用都具备稳定事实链：

1. `request_id`
2. `quote_id`
3. `invocation_id`
4. `ledger reference`
5. `audit event`

Provider Workspace 的收益面板和平台 Admin 面板，都应该读取数据库事实投影，而不是依赖临时内存统计。

## 9. 架构结论

Gateway 的真正价值不是“代发 HTTP 请求”，而是把 `鉴权 / 预算 / 风控 / 转发 / 账本 / 审计` 变成一条不可分割的执行管线，让 Agent 可以稳定买服务，让 Provider 可以稳定收钱，让平台可以稳定追责和清算。
