# Gateway Runtime Architecture

- Status: canonical
- Code paths: `gateway/src/`, `sdk/python/`, `provider_service/`
- Verified with: `npm run ci:gateway`, `npm run ci:sdk-python`, `npm run ci:provider-service`, `npm run ci:docs`
- DB sources: `docker-compose/postgres/init/gateway/001_synapse_schema.sql`
- Supersedes: former `docs/agent/01_Agent_Runtime_Product_Architecture.md` for runtime topology, five-layer model, and control-vs-execution split
- Last verified against code: 2026-03-24

## 1. 目标

本文件解释 Platform Gateway 在运行时到底承担什么职责，以及为什么它必须是一条完整的执行管线，而不是简单的 HTTP proxy。

当前 Runtime 总体架构的 canonical 解释以本文件为准。former `docs/agent/01_Agent_Runtime_Product_Architecture.md` 已完成退役，不再单独定义主架构真相。

## 2. Runtime 五层架构

Synapse Runtime 仍然遵守五层分解，但当前 canonical 归口已回收到架构模块：

1. `Owner Control Plane`
    负责充值、创建 Agent、签发 credential、设置预算、查看账单。
2. `Discovery Plane`
    负责检索、筛选、排序并返回 Agent 可消费的候选服务。
3. `Execution Plane`
    负责 quote、invoke、路由、重试、结果回传。
4. `Risk Plane`
    负责预算、额度、限流、作用域控制、异常熔断与审计追踪。
5. `Settlement Plane`
    负责平台账本、卖家应收、金库出入金和提现清算。

这五层的边界不能塌缩成“前端 + proxy + 数据库”三件套，否则会把预算、路由、清算和审计重新糊在一起。

## 3. Gateway 执行总线

```mermaid
flowchart LR
    A[Request In] --> B[Identity Resolution]
    B --> C[Credential and Budget Validation]
    C --> D[Quote and Policy Checks]
    D --> E[Routing and Forwarding]
    E --> F[Result Normalization]
    F --> G[Settlement and Ledger]
    G --> H[Audit and Response Out]
```

## 4. 控制链路与执行链路

Gateway Runtime 必须同时维护两条链，而不是把控制面和执行面揉成一个接口层。

### 4.1 控制链路

`Owner -> Dashboard -> Gateway Control API -> Credential / Budget Store`

用途：

1. 创建 Agent
2. 生成或吊销 Credential
3. 设置总预算、日预算和速率限制
4. 查看消费历史和风险告警

### 4.2 执行链路

`Agent Runtime -> Discovery API -> Quote API -> Invoke API -> Provider Endpoint`

用途：

1. 查服务
2. 请求 Quote
3. 发起 Invoke
4. 获取结构化结果
5. 完成扣费与审计

硬边界：

1. 控制链路可以看到 Owner、Credential、预算、审计等控制面对象。
2. 执行链路只暴露 Agent 调用服务所必需的信息，不暴露卖家结算资料、平台路由策略或内部账本主键。
3. Settlement Plane 只服务平台内部清算和对账，不直接进入 Agent-facing 协议。

## 5. 七段执行链

### 5.1 Identity Resolution

Gateway 先做：

1. session subject 解析
2. owner scope 绑定
3. credential 归属校验

这一步的原则是：

1. 所有权必须由服务端推导
2. 不允许前端或 Agent 伪造 owner 归属

### 5.2 Credential and Budget Validation

这里做：

1. credential 是否 active
2. credential 是否过期或吊销
3. budget policy 是否允许
4. service scope 是否命中 allowlist / blocklist

### 5.3 Quote and Policy Checks

如果请求走 invoke，则必须再检查：

1. quote 是否存在
2. quote 是否过期
3. quote 是否可消费
4. price 和 response mode 是否仍在允许范围

### 5.4 Routing and Forwarding

Gateway 根据：

1. service manifest
2. endpoint status
3. health snapshot
4. routing weight

选择目标 endpoint 并执行转发。

### 5.5 Result Normalization

上游 Provider 的结果不能原封不动当作平台 contract。

Gateway 需要统一：

1. success / failure 语义
2. timeout / upstream error 映射
3. stable error codes
4. result digest 和 trace context

### 5.6 Settlement and Ledger

调用结果确定后，Gateway 在事务内完成：

1. reserve / capture / release
2. ledger entries
3. balance snapshot update
4. invocation status update

### 5.7 Audit and Response Out

最后才向外返回响应，同时写审计事件。

## 6. Provider 防绕过要求

Gateway 和 Provider 之间不能只是普通公网 HTTP 关系。

至少要保证：

1. Gateway 到 Provider 有共享密钥或签名验证
2. request_id / trace_id 可透传
3. Provider 能验证请求确实来自平台

否则任何第三方都可能绕过计费入口直接打 Provider endpoint。

## 7. 为什么 Gateway 不能退化成透明代理

因为透明代理做不到：

1. 预算前置
2. quote 生命周期控制
3. 成功/失败后的 capture / release
4. 稳定错误码
5. 审计和对账闭环

一旦退化成透明代理，Synapse 就不再是 settlement layer，而只是转发层。

## 8. 和数据库的协作方式

Gateway 的运行时写路径最依赖的表包括：

1. `synapse_agent_credentials`
2. `synapse_budget_policies`
3. `synapse_service_quotes`
4. `synapse_invocations`
5. `synapse_budget_events`
6. `synapse_ledger_entries`
7. `synapse_audit_events`

这说明 Gateway 是执行面和真相层之间的胶水，而不是临时内存脚本。

## 9. 文档结论

Gateway Runtime 的真正价值不是“转发请求”，而是把：

**Identity + Policy + Routing + Settlement + Audit**

收敛成一条金融级执行总线。