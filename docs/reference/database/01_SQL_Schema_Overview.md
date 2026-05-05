# SQL Schema Overview

- Status: canonical
- Code paths: `gateway/src/storage/`, `admin/gateway-admin/src/storage/`
- Verified with: `npm run ci:gateway`, `npm run ci:admin-gateway`, `npm run ci:provider-service`, `npm run ci:docs`
- DB sources: `docker-compose/postgres/init/gateway/001_synapse_schema.sql`
- Supersedes: former `docs/agent/06_Build_For_Agent_Database_Rebuild.md` for schema-layer rebuild rationale and eight-layer truth model
- Last verified against code: 2026-03-24

## 1. 目标

最新的 `001_synapse_schema.sql` 不是在旧系统上继续补丁，而是一次明确的建模切换：

从：

1. wallet
2. api key
3. deposit / usage / withdraw 的松散并列表

切到：

1. Owner
2. Agent Runtime
3. Provider Role
4. Service / Quote / Invocation
5. Budget Event / Ledger Entry / Vault Deposit / Vault Withdrawal

一句话：

**数据库第一公民已经从钱包和 key，切换成 Runtime commerce objects。**

当前 Agent-first 数据库重建的 canonical 解释以本文件为准。former `docs/agent/06_Build_For_Agent_Database_Rebuild.md` 已完成退役，不再单独定义长期数据库重建真相。

## 1.1 重构边界

这次不是“在旧表上打补丁”，而是换视角重建真相层。

可以复用的是原则，不是大多数旧表本身：

1. PostgreSQL 仍然是资金与调用真相源。
2. 金额字段继续统一使用 `NUMERIC`。
3. 关键写操作继续要求幂等、唯一索引、事务、审计。
4. `synapse_idempotency_keys` 与 `synapse_runtime_state` 的核心思路继续成立。

必须重构的旧建模方向包括：

1. 从 `service registry` 大表拆成 manifest、endpoint、health、search index。
2. 从历史 `credentials` 桶拆成 agent profile、agent credential、budget policy。
3. 从历史调用影子表拆成 quote、invocation、budget event、ledger entry。
4. 从结果态余额表拆成 ledger account、balance snapshot、append-only ledger entry。

## 2. Schema 的全局设计原则

### 2.1 Owner 是根身份

所有控制面根归属都挂在 `synapse_owner_accounts` 上。

这意味着：

1. Agent 不是根账户
2. Provider 也不是独立根账户
3. 同一个 Owner 可以同时拥有消费侧资金桶和供给侧收益桶

### 2.2 Agent Runtime 是一等对象

Runtime 身份相关对象单独成层：

1. `synapse_agent_profiles`
2. `synapse_agent_credentials`
3. `synapse_budget_policies`
4. `synapse_owner_spend_limits`

这表示平台同时具备两层额度语义：

1. Agent + Budget Policy 的 credential 级约束
2. Owner account 的 billing-cycle 总额度约束

### 2.3 Service / Quote / Invocation 是商业状态机

数据库中明确存在：

1. `synapse_service_manifests`
2. `synapse_service_quotes`
3. `synapse_invocations`

这让 discover -> quote -> invoke 不再只是 HTTP 路由层行为，而是落到可审计、可对账、可恢复的状态机。

### 2.4 Ledger 和 Balance 分层

SQL 明确把资金层拆成：

1. `synapse_ledger_accounts`
2. `synapse_account_balances`
3. `synapse_ledger_entries`

因此：

1. 账户定义不等于余额快照
2. 余额快照不等于最终真相
3. 最终真相是 append-only `ledger_entries`

### 2.5 Vault Funding 和 Runtime Commerce 解耦

出入金不再直接混在调用结算表里，而是独立进入：

1. `synapse_vault_deposits`
2. `synapse_vault_withdrawals`

这让两件事可以明确分开：

1. Owner 把钱放进平台资金池
2. Agent Runtime 如何消费资金池里的钱

## 3. SQL 中定义的枚举类型

最新 schema 先通过枚举把核心状态机钉死。

### 3.1 `synapse_budget_event_kind`

1. `reserve`
2. `capture`
3. `release`
4. `adjust`

说明：预算变更不再是一个“剩余额度数字”被直接覆盖，而是有事件流可追溯。

### 3.2 `synapse_quote_status`

1. `OPEN`
2. `EXPIRED`
3. `CONSUMED`
4. `CANCELLED`

说明：Quote 是短生命周期的价格和预算窗口，而不是长期凭证。

### 3.3 `synapse_invocation_status`

1. `PENDING`
2. `RUNNING`
3. `SUCCEEDED`
4. `FAILED_RETRYABLE`
5. `FAILED_FINAL`
6. `SETTLED`

说明：调用执行和资金结算是相关但不完全重叠的两个阶段，所以保留 `SETTLED` 作为最终账务闭环态。

### 3.4 `synapse_withdrawal_kind`

1. `consumer_refund`
2. `provider_withdrawal`
3. `platform_distribution`

说明：同一套 withdrawal 基础设施服务多类出金，但必须靠 kind 做严格桶隔离。

## 4. 主分层

### 4.1 Tenant Layer

1. `synapse_owner_accounts`
2. `synapse_provider_profiles`
3. `synapse_provider_payout_accounts`

作用：定义根主体、Provider role 和收益接收地址。

### 4.2 Agent Runtime Layer

1. `synapse_agent_profiles`
2. `synapse_agent_credentials`
3. `synapse_budget_policies`

作用：定义 Runtime 身份、支付凭据和预算约束。

### 4.3 Service Catalog Layer

1. `synapse_service_manifests`
2. `synapse_service_endpoints`
3. `synapse_service_health_snapshots`
4. `synapse_service_health_runtime`
5. `synapse_service_health_events`
6. `synapse_service_search_index`

作用：定义可发现服务、真实 endpoint、当前健康状态和 7 天诊断窗口内的健康翻转事件。

### 4.4 Commerce Layer

1. `synapse_service_quotes`
2. `synapse_invocations`

作用：定义报价和执行状态机。

### 4.5 Budget Layer

1. `synapse_budget_events`

作用：把 reserve / capture / release 做成可追溯事件流。

### 4.6 Ledger Layer

1. `synapse_ledger_accounts`
2. `synapse_account_balances`
3. `synapse_ledger_entries`

作用：定义账户、快照和分录。

### 4.7 Vault Funding Layer

1. `synapse_vault_deposits`
2. `synapse_vault_withdrawals`

作用：定义入金和出金真相。

### 4.8 Reliability Layer

1. `synapse_audit_events`
2. `synapse_idempotency_keys`
3. `synapse_runtime_state`
4. `synapse_deposit_attempts`

作用：定义审计、去重、typed sidecar 和前端充值漏斗补偿记录。

## 5. 命名约束

SQL 的命名规律非常明确：

1. `profiles` 定义主体
2. `credentials` 定义运行时凭据
3. `policies` 定义约束规则
4. `manifests` / `endpoints` / `search_index` 定义服务目录
5. `quotes` / `invocations` 定义商业状态机
6. `events` / `entries` 定义 append-only 真相
7. `balances` 定义快照
8. `deposits` / `withdrawals` 定义 Vault 资金出入

这套命名本身就在强调：

**不要再让单张“万能大表”承载身份、调用、结算、审计和控制面五种职责。**

## 6. 文档结论

这套 schema 的价值不只是“表更多了”，而是它把系统从旧时代的页面驱动存储，切成了 Runtime 驱动真相层。

Phase 2 的剩余文档，都会在这个总图上继续展开。 
