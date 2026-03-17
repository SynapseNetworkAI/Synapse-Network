# Gateway 数据库设计

> 这是删库重建后唯一应参考的 Gateway 数据库设计文档。

> Canonical bootstrap SQL: [infra/docker/postgres/init/001_synapse_schema.sql](../infra/docker/postgres/init/001_synapse_schema.sql)

## 1. 设计目标

新的 Gateway 数据库不再围绕 `wallet + api_key + usage_log` 展开，而是围绕下面 6 类真相对象展开：

1. Owner 资金池
2. Agent Runtime 身份
3. Service Manifest 与 Endpoint
4. Quote / Invocation 商业状态机
5. Budget 预占与释放
6. Ledger / Audit / Runtime State

一句话：数据库的第一公民已经从“钱包和 key”切换成“Agent、Service、Quote、Invocation”。

## 2. 数据库主分层

### 2.1 Tenant 层

- `synapse_owner_accounts`
- `synapse_seller_profiles`
- `synapse_payout_accounts`

### 2.2 Agent Runtime 层

- `synapse_agent_profiles`
- `synapse_agent_credentials`
- `synapse_budget_policies`

### 2.3 Service Catalog 层

- `synapse_service_manifests`
- `synapse_service_endpoints`
- `synapse_service_health_snapshots`
- `synapse_service_search_index`

### 2.4 Commerce 层

- `synapse_service_quotes`
- `synapse_invocations`

### 2.5 Budget 层

- `synapse_budget_events`

### 2.6 Ledger 与 Reliability 层

- `synapse_ledger_accounts`
- `synapse_account_balances`
- `synapse_ledger_entries`
- `synapse_audit_events`
- `synapse_idempotency_keys`
- `synapse_runtime_state`
- `synapse_deposit_attempts`
- `synapse_vault_deposits`
- `synapse_vault_withdrawals`

## 3. 设计原则

1. Agent-facing 协议只暴露 Service、Quote、Invocation、Credential 最小视图。
2. 卖家结算地址、拆账策略、内部账本键留在平台内部表。
3. Quote 必须先落库，预算必须先 reserve，再 capture / release。
4. Invocation 是第一等真相对象，不再退化成 `usage_log`。
5. Ledger 必须是双分录，余额快照只做高频读加速。

## 4. 关键链路

### 4.1 Discover

读：

- `synapse_service_search_index`
- `synapse_service_manifests`
- `synapse_service_health_snapshots`

### 4.2 Quote

写：

- `synapse_service_quotes`
- `synapse_budget_events` (`reserve`)

### 4.3 Invoke

写：

- `synapse_invocations`
- `synapse_budget_events` (`capture` / `release`)
- `synapse_ledger_entries`
- `synapse_audit_events`

### 4.4 Deposit / Withdraw

写：

- `synapse_vault_deposits`
- `synapse_vault_withdrawals`
- `synapse_ledger_entries`
- `synapse_account_balances`

## 5. Admin Projection

删库重建后，后台投影视图也已经跟着切到新 schema：

- [infra/docker/postgres/init/003_gateway_admin_projection_views.sql](../infra/docker/postgres/init/003_gateway_admin_projection_views.sql)

它现在主要依赖：

- `synapse_account_balances`
- `synapse_vault_deposits`
- `synapse_vault_withdrawals`
- `synapse_invocations`
- `synapse_audit_events`
- `synapse_runtime_state`

## 6. 已废弃的旧主表

这些表不再是重建后的主真相层：

- `synapse_service_registry`
- `synapse_credentials`
- `synapse_usage_log`
- `synapse_balances`
- `synapse_router_config`
- `synapse_deposit_intents`
- `synapse_refund_intents`
- `synapse_withdrawal_intents`

## 7. 重建顺序

删库重建时只需要执行：

1. `001_synapse_schema.sql`
2. `003_gateway_admin_projection_views.sql`

不再需要：

- `004_synapse_deposit_attempts.sql`
- `010_agent_runtime_rebuild.sql`

## 8. 结论

这套数据库结构服务的是 build-for-agent 的 Runtime，而不是历史上的 wallet/API key 网关模型。