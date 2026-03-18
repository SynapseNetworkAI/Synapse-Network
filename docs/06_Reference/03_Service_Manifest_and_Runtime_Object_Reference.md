# Service Manifest and Runtime Object Reference

## 1. 目标

本文件总结 Synapse 中最重要的公开 Runtime 对象和 Service Manifest 约束，确保 Agent、Gateway、Provider 对同一组对象有一致理解。

## 2. Service Manifest 的角色

Manifest 不是广告页，而是：

1. Agent 能理解何时调用的能力契约
2. Gateway 能理解如何计费和路由的执行契约
3. Provider 能声明 SLA 与运行约束的注册契约

## 3. Manifest 字段分层

### 3.1 身份字段

至少包括：

1. `service_id`
2. `service_name`
3. `service_slug`
4. `provider_id`
5. `manifest_version`
6. `status`

### 3.2 Agent 理解字段

至少包括：

1. `description_for_model`
2. `task_category`
3. `capabilities`
4. `input_schema`
5. `output_schema`
6. `examples`
7. `limitations`

### 3.3 商业字段

至少包括：

1. `price_model`
2. `base_price_usdc`
3. `unit_name`
4. `min_billable_unit`
5. `quote_required`
6. `settlement_currency`

### 3.4 运行字段

至少包括：

1. `endpoint_url`
2. `auth_mode`
3. `timeout_ms`
4. `streaming_supported`
5. `async_supported`
6. `callback_supported`
7. `max_payload_bytes`

### 3.5 平台内部扩展字段

典型包括：

1. `health_check`
2. `routing_targets`
3. `forwarding_policy`
4. `metering_policy`
5. `rate_limit_policy`

这些字段主要服务 Gateway 控制面，不是 Agent 选择服务所需的最小公开契约。

## 4. 不应暴露给 Agent 的字段

默认不应通过 Runtime 协议暴露：

1. `provider_wallet`
2. `settlement_account_id`
3. `payout_policy_id`
4. 内部分账规则
5. 内部路由拓扑

## 5. V1 最小必填集

V1 至少要求：

1. `service_id`
2. `service_name`
3. `description_for_model`
4. `input_schema`
5. `output_schema`
6. `price_model`
7. `base_price_usdc`
8. `endpoint_url`
9. `timeout_ms`
10. `status`

## 6. 关键 Runtime 对象

除 Manifest 外，Runtime 还围绕以下对象工作：

1. `AgentCredential`
2. `BudgetPolicy`
3. `ServiceQuote`
4. `Invocation`
5. `BudgetEvent`
6. `AuditEvent`

它们共同组成：

1. 身份边界
2. 价格锚点
3. 执行事实
4. 资金与审计事实

## 7. 文档结论

Manifest 是 Service Contract，不是 Provider Profile；

Runtime Object 是执行和结算的事实对象，不是页面字段的随意投影。