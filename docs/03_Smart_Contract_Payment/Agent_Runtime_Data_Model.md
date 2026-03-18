# Agent Runtime 数据模型

本文档描述 build-for-agent 版本的目标数据库模型，来源于 [infra/docker/postgres/init/001_synapse_schema.sql](../../infra/docker/postgres/init/001_synapse_schema.sql)。

它不是当前线上 schema 的说明书，而是下一代 Agent Runtime 真相层的数据结构说明。

## 1. 设计目标

新数据库要同时承担 6 类职责：

1. Owner 资金池真相
2. Agent 身份与预算真相
3. Service Manifest 与可发现性真相
4. Quote / Invocation 商业状态机真相
5. 双分录账本与余额快照真相
6. 审计、幂等、运行态游标真相

## 2. 主体层

### `synapse_owner_accounts`

用途：Owner 控制面主体。

关键字段：

- `owner_id`
- `owner_wallet`
- `status`
- `default_currency`

### `synapse_provider_profiles`

用途：Provider 主体，仅供平台内部治理、结算和服务归属使用。

关键字段：

- `provider_id`
- `owner_wallet`
- `display_name`
- `status`

### `synapse_provider_payout_accounts`

用途：Provider 结算账户，不暴露给 Agent。

关键字段：

- `payout_account_id`
- `provider_id`
- `payout_address`
- `chain_id`
- `settlement_currency`
- `status`

## 3. Agent 身份层

### `synapse_agent_profiles`

用途：定义一个 Agent Runtime 身份。

关键字段：

- `agent_id`
- `owner_id`
- `name`
- `purpose`
- `status`

### `synapse_agent_credentials`

用途：Runtime 凭据，不再是历史意义上的通用 API key 桶。

关键字段：

- `credential_id`
- `agent_id`
- `secret_hash`
- `secret_prefix`
- `status`
- `expires_at`

### `synapse_budget_policies`

用途：把预算、速率、service scope 固化成独立策略对象。

关键字段：

- `policy_id`
- `credential_id`
- `lifetime_cap_usdc`
- `daily_cap_usdc`
- `per_invocation_cap_usdc`
- `rpm_limit`
- `qps_limit`
- `allowed_service_tags`
- `allowed_service_ids`
- `blocked_service_ids`

## 4. Service Catalog 层

### `synapse_service_manifests`

用途：Agent-facing 的 Service Contract。

关键字段：

- `service_id`
- `provider_id`
- `service_name`
- `manifest_version`
- `status`
- `description_for_model`
- `task_category`
- `capabilities_json`
- `input_schema`
- `output_schema`
- `examples_json`
- `price_model`
- `base_price_usdc`
- `quote_required`

### `synapse_service_endpoints`

用途：路由目标和运行约束。

关键字段：

- `endpoint_id`
- `service_id`
- `endpoint_url`
- `auth_mode`
- `timeout_ms`
- `max_payload_bytes`
- `streaming_supported`
- `async_supported`
- `callback_supported`
- `region`
- `weight`

### `synapse_service_health_snapshots`

用途：服务级 / endpoint 级健康快照。

关键字段：

- `service_id`
- `endpoint_id`
- `health_score`
- `p95_latency_ms`
- `success_rate_24h`
- `last_checked_at`

### `synapse_service_search_index`

用途：Discovery 检索索引。

关键字段：

- `service_id`
- `tags_json`
- `search_text`
- `embedding_ref`
- `reliability_tier`
- `health_score`

## 5. Commerce 层

### `synapse_service_quotes`

用途：Quote 真相表，保存价格锁定和预算预占窗口。

关键字段：

- `quote_id`
- `service_id`
- `credential_id`
- `agent_id`
- `quoted_price_usdc`
- `status`
- `request_fingerprint`
- `response_mode`
- `expires_at`
- `invoke_constraints`

### `synapse_invocations`

用途：Invocation 真相表，代表每次正式执行调用。

关键字段：

- `invocation_id`
- `quote_id`
- `service_id`
- `endpoint_id`
- `credential_id`
- `agent_id`
- `idempotency_key`
- `request_digest`
- `status`
- `charged_usdc`
- `error_code`
- `result_digest`

## 6. Budget 层

### `synapse_budget_events`

用途：预算预占、正式扣减、释放和人工调整。

关键字段：

- `event_id`
- `policy_id`
- `credential_id`
- `quote_id`
- `invocation_id`
- `event_kind`
- `amount_usdc`
- `remaining_lifetime_usdc`
- `remaining_daily_usdc`

## 7. Ledger 层

### `synapse_ledger_accounts`

用途：账户定义。

账户类型建议：

- `owner_vault`
- `provider_receivable`
- `platform_revenue`
- `budget_hold`

### `synapse_account_balances`

用途：余额快照表，高频读用。

关键字段：

- `account_id`
- `available_balance`
- `pending_balance`
- `frozen_balance`

### `synapse_ledger_entries`

用途：双分录资金真相，驱动账本审计和对账。

关键字段：

- `entry_id`
- `reference_type`
- `reference_id`
- `business_type`
- `debit_account_id`
- `credit_account_id`
- `amount_usdc`
- `status`

## 8. Vault Funding 层

### `synapse_vault_deposits`

用途：Owner 资金池入金真相。

关键字段：

- `deposit_id`
- `owner_id`
- `tx_hash`
- `amount_usdc`
- `status`

### `synapse_vault_withdrawals`

用途：Owner 资金池出金真相。

关键字段：

- `withdrawal_id`
- `owner_id`
- `tx_hash`
- `amount_usdc`
- `status`
- `signature`
- `nonce`
- `deadline`

## 9. Reliability 层

### `synapse_audit_events`

用途：统一的 append-only 审计事件表，替代旧的 `synapse_audit_log` + 部分系统活动语义。

### `synapse_idempotency_keys`

用途：继续承担写请求去重与重放保护。

### `synapse_runtime_state`

用途：继续承担 indexer / reconciler / search pipeline 的状态游标。

### `synapse_deposit_attempts`

用途：可选保留，用于前端充值漏斗分析，不再作为 Runtime 主真相。

## 10. 公开协议与内部字段边界

新模型强制分层：

- Agent-facing：`service_id`、Manifest、Quote、Invocation、Credential 最小视图
- Platform-internal：`provider_wallet`、`payout_account_id`、分账比例、路由节点、内部账本键

公开协议不应默认返回：

- Provider 钱包地址
- 平台拆账明细
- 内部账本流水主键
- 内部风控命中规则细节

## 11. 结论

这份模型的核心变化不是“多加几张表”，而是彻底把数据库视角从 `wallet + api_key + legacy call shadow rows`，切换成 `agent + service + quote + invocation + budget + ledger`。