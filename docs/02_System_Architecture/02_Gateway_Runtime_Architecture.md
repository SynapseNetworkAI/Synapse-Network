# Gateway Runtime Architecture

## 1. 目标

本文件解释 Platform Gateway 在运行时到底承担什么职责，以及为什么它必须是一条完整的执行管线，而不是简单的 HTTP proxy。

## 2. Gateway 执行总线

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

## 3. 七段执行链

### 3.1 Identity Resolution

Gateway 先做：

1. session subject 解析
2. owner scope 绑定
3. credential 归属校验

这一步的原则是：

1. 所有权必须由服务端推导
2. 不允许前端或 Agent 伪造 owner 归属

### 3.2 Credential and Budget Validation

这里做：

1. credential 是否 active
2. credential 是否过期或吊销
3. budget policy 是否允许
4. service scope 是否命中 allowlist / blocklist

### 3.3 Quote and Policy Checks

如果请求走 invoke，则必须再检查：

1. quote 是否存在
2. quote 是否过期
3. quote 是否可消费
4. price 和 response mode 是否仍在允许范围

### 3.4 Routing and Forwarding

Gateway 根据：

1. service manifest
2. endpoint status
3. health snapshot
4. routing weight

选择目标 endpoint 并执行转发。

### 3.5 Result Normalization

上游 Provider 的结果不能原封不动当作平台 contract。

Gateway 需要统一：

1. success / failure 语义
2. timeout / upstream error 映射
3. stable error codes
4. result digest 和 trace context

### 3.6 Settlement and Ledger

调用结果确定后，Gateway 在事务内完成：

1. reserve / capture / release
2. ledger entries
3. balance snapshot update
4. invocation status update

### 3.7 Audit and Response Out

最后才向外返回响应，同时写审计事件。

## 4. Provider 防绕过要求

Gateway 和 Provider 之间不能只是普通公网 HTTP 关系。

至少要保证：

1. Gateway 到 Provider 有共享密钥或签名验证
2. request_id / trace_id 可透传
3. Provider 能验证请求确实来自平台

否则任何第三方都可能绕过计费入口直接打 Provider endpoint。

## 5. 为什么 Gateway 不能退化成透明代理

因为透明代理做不到：

1. 预算前置
2. quote 生命周期控制
3. 成功/失败后的 capture / release
4. 稳定错误码
5. 审计和对账闭环

一旦退化成透明代理，Synapse 就不再是 settlement layer，而只是转发层。

## 6. 和数据库的协作方式

Gateway 的运行时写路径最依赖的表包括：

1. `synapse_agent_credentials`
2. `synapse_budget_policies`
3. `synapse_service_quotes`
4. `synapse_invocations`
5. `synapse_budget_events`
6. `synapse_ledger_entries`
7. `synapse_audit_events`

这说明 Gateway 是执行面和真相层之间的胶水，而不是临时内存脚本。

## 7. 文档结论

Gateway Runtime 的真正价值不是“转发请求”，而是把：

**Identity + Policy + Routing + Settlement + Audit**

收敛成一条金融级执行总线。