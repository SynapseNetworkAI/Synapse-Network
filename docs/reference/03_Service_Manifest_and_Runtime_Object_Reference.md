# Service Manifest and Runtime Object Reference

- Status: canonical
- Code paths: `gateway/src/domain/`, `gateway/src/services/provider/`, `sdk/python/`
- Verified with: `npm run ci:gateway`, `npm run ci:sdk-python`, `npm run ci:docs`
- DB sources: `docker-compose/postgres/init/gateway/001_synapse_schema.sql`
- Supersedes: former `docs/agent/03_Service_Manifest_Field_Standard.md` for manifest field standards
- Last verified against code: 2026-03-24

## 1. 目标

本文件总结 Synapse 中最重要的公开 Runtime 对象和 Service Manifest 约束，确保 Agent、Gateway、Provider 对同一组对象有一致理解。

当前 Service Manifest 字段标准的 canonical 解释以本文件为准。former `docs/agent/03_Service_Manifest_Field_Standard.md` 已完成退役，不再单独定义长期字段真相。

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

`status` 是控制面生命周期，不是健康状态。当前公开语义为：

1. `draft`：尚未发布，不承载流量。
2. `active`：允许承载流量，但仍必须通过运行时健康判断。
3. `inactive`：Provider 主动暂停，不 discover、不 invoke、不自动探活。
4. `suspended`：平台冻结，不 discover、不 invoke，但可继续探活和保留健康历史。
5. `deleted`：逻辑删除终态，不探活、不发现、不调用。

为了兼容现有 PostgreSQL schema，底层 manifest row 可能仍以 `paused / archived` 保存非 active 终态；运行时 API 会统一投影成 `inactive / deleted`。业务判断必须使用公开 lifecycle 语义，而不是直接把数据库兼容值暴露给 Agent。

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

运行时健康由 Gateway 探活生成，典型状态为：

1. `unknown`
2. `probing`
3. `healthy`
4. `degraded`
5. `unhealthy`
6. `stale`

Agent-facing discovery / invoke 的可调用条件必须同时满足：

1. `isActive=true`
2. `status=active`
3. 健康快照未过期
4. 至少一个 target 为 `healthy`

因此 `active + unhealthy` 是合法状态：它表示控制面仍允许上线，但 Gateway 当前自动摘流。后续健康恢复后可自动重新进入 discovery / invoke。

探活调度会额外暴露 `probeTier` 供控制台和运维判断：

1. `normal`：按 `SERVICE_HEALTH_PROBE_INTERVAL_SEC` 正常探活。
2. `slow_lane`：长期不健康或 suspended，按 slow lane 间隔降频探活。
3. `manual_only`：`draft` / `inactive`，不进入自动探活，只能手动 force probe。
4. `disabled`：`deleted`，不再探活。

slow lane 只节省探活资源，不改变生命周期。Provider 修复 endpoint 后，如果服务仍为 `active`，等待下一次 slow lane probe 或点击 `Force probe` 即可恢复；如果服务被 Pause 成 `inactive`，需要 Resume / 重新发布后才会重新进入自动探活。

Invoke 转发还会使用动态并发保护：

1. `constraints.maxConcurrency` 是 Provider 可选声明的 target 级并发上限。
2. Gateway 会取 `constraints.maxConcurrency`、平台 `DOWNSTREAM_ADAPTIVE_MAX_CONCURRENCY`、`maxQps * timeoutMs` 推导值三者最小值作为动态并发硬上限。
3. 下游响应慢或失败时，Gateway 自动降低并发；恢复后逐步升并发。
4. `SERVICE_BUSY` / `SERVICE_CIRCUIT_OPEN` 发生在扣费前；`SERVICE_TIMEOUT` 表示请求已转发但超时，会走失败回滚和审计。

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

## 6. Provider Console V1 收敛规则

第一版 Provider 注册页不会把所有 Manifest 字段都开放成可编辑表单。

以下字段在 V1 中由平台统一决定或通过运行时观测生成，不要求 Provider 手工填写：

1. `status`
2. `streaming_supported` / `async_supported` / `callback_supported`
3. `quality.*`
4. `unit_name` / `min_billable_unit` / `quote_required`
5. `forwarding_policy.request_id_header`
6. `metering_policy.*`

Provider Console 当前默认首屏只要求 Provider 明确以下最小接入信息：

1. `service_name`
2. `service_id`
3. `runtime.endpoint_url`
4. `billing.base_price_usdc`
5. `model_usage.description_for_model`
6. `io_schema.input_schema`
7. `io_schema.output_schema`

其中以下字段允许前端自动推导或预填默认值：

1. `service_id` 可先由 `service_name` 自动派生，但 Provider 仍可手动覆盖
2. `service_slug` 默认由 `service_name` 派生
3. `manifest_version` 默认 `1.0.0`
4. `settlement_currency` 默认 `USDC`
5. `runtime.auth_mode` 默认 `gateway_forward`
6. `gateway_extensions.health_check.path` 默认 `/health`
7. `gateway_extensions.health_check.timeout_ms` 默认 `3000`
8. `gateway_extensions.rate_limit_policy.max_qps` 默认 `50`
9. `constraints.maxConcurrency` 可选；不填时由 Gateway 根据平台默认值、QPS 和超时推导。

平台默认策略：

1. 新建 service 默认进入 `draft`。
2. `price_model` 在 V1 固定为 `fixed`。
3. 服务是否进入 discover / invoke 候选，取决于 `status=active`、`isActive=true`、健康快照未过期且至少一个 target 为 `healthy`。
4. `quality` 由平台健康检查与运行观测生成，而不是由 Provider 手填。

## 7. AI API Parser 输入约定

Provider Console 的 AI API Parser 在 V1 推荐直接粘贴“完整调用样例”，而不是只贴 cURL 命令骨架。

Parser 需要从样例中推断：

1. `endpoint_url`
2. `input_schema`
3. `output_schema`
4. `examples`
5. `description_for_model`
6. `routing_targets`

目标不是生成旧版自由格式字段，而是直接返回当前注册页可以消费的标准 Manifest 结构。

## 8. 关键 Runtime 对象

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

## 9. 文档结论

Manifest 是 Service Contract，不是 Provider Profile；

Runtime Object 是执行和结算的事实对象，不是页面字段的随意投影。
