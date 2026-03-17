# Build For Agent: Database Rebuild

> 目标：不给历史兼容留后门，直接以 Agent Runtime 为第一公民，重做 Synapse 的底层数据库与真相模型。

> 结论先说：当前 schema 还能复用的是少数底层原则，不是大部分表本身。要 build for agent，数据库必须从“钱包/API Key/双边地址账本”切到“Owner / Agent / Service / Quote / Invocation / Budget / Ledger” 模型。

## 1. 为什么必须重构

当前数据库的核心视角还是：

- `owner_address`
- `seller_address`
- `API key`
- `deposit / usage / withdraw`

这个模型能勉强支撑“人类手工拿一个 key 去调服务”，但它无法优雅支撑下面这些 Agent-native 能力：

1. Agent 先 discover，再 quote，再 invoke
2. 一个 Agent 有独立预算、速率和 service scope
3. Quote 先预占预算，再 capture / release
4. Invocation 是第一等真相对象，不只是历史兼容调用影子行
5. Service 面向 Agent 公开，Seller 结算信息只留在平台内部

所以这次不是“在旧表上打补丁”，而是**换视角重建真相层**。

## 2. 哪些还能复用，哪些必须重写

### 2.1 可以复用的是原则，不是大多数表

这些原则继续保留：

- PostgreSQL 仍然是资金与调用真相源
- 金额字段继续统一使用 `NUMERIC`
- 关键写操作继续要求幂等、唯一索引、事务、审计
- `synapse_idempotency_keys` 的思路继续成立
- `synapse_runtime_state` 的 cursor / state checkpoint 思路继续成立
- `synapse_deposit_attempts` 可以作为前端充值漏斗分析表保留，但不再承担 Agent Runtime 主真相

### 2.2 必须重写的旧表

这些表不适合继续作为新系统主表：

1. `synapse_service_registry`
   问题：把 Manifest、路由、鉴权、健康检查、计费配置揉成了一张卖家中心化大表。
   新方案：拆成 `synapse_service_manifests`、`synapse_service_endpoints`、`synapse_service_health_snapshots`、`synapse_service_search_index`。

2. `synapse_credentials`
   问题：它只是“凭据桶”，没有 `AgentProfile`、`BudgetPolicy`、`service scope` 这些 Agent Runtime 核心实体。
   新方案：拆成 `synapse_agent_profiles`、`synapse_agent_credentials`、`synapse_budget_policies`。

3. 历史调用影子表
   问题：它只能记录“调用发生了”，无法表达 Quote、预算预占、调用重试、结果回执、结算完成这些生命周期。
   新方案：拆成 `synapse_service_quotes`、`synapse_invocations`、`synapse_budget_events`、`synapse_ledger_entries`。

4. `synapse_balances`
   问题：它是结果态余额表，不是完整的 Agent-first 账户模型。
   新方案：拆成 `synapse_ledger_accounts` + `synapse_account_balances`，让账户和余额快照分层。

5. `synapse_router_config`
   问题：只有钱包级日限额，太粗。
   新方案：预算和限流统一进入 `synapse_budget_policies`。

6. 历史 deposit / refund / withdrawal intent 表
   问题：这些表是资金侧意图表，不是 Agent Runtime 结构；语义也太偏历史流程。
   新方案：重构为 `synapse_vault_deposits` 和 `synapse_vault_withdrawals`，只保留 Owner 资金池入金/出金真相。

7. `synapse_wallet_roles` / `synapse_auth_sessions`
   问题：这是钱包时代控制面模型，不是 Agent-first 主真相层。
   新方案：控制面另行保留，但不作为 Runtime 主数据模型中心。

### 2.3 目前完全缺失，必须补全的表

当前 schema 缺失但 Agent Runtime 必须拥有的对象：

- `synapse_owner_accounts`
- `synapse_seller_profiles`
- `synapse_payout_accounts`
- `synapse_agent_profiles`
- `synapse_agent_credentials`
- `synapse_budget_policies`
- `synapse_service_manifests`
- `synapse_service_endpoints`
- `synapse_service_health_snapshots`
- `synapse_service_search_index`
- `synapse_service_quotes`
- `synapse_invocations`
- `synapse_budget_events`
- `synapse_ledger_accounts`
- `synapse_account_balances`
- `synapse_ledger_entries`
- `synapse_audit_events`
- `synapse_vault_deposits`
- `synapse_vault_withdrawals`

## 3. 新数据库的八层真相模型

### 3.1 Tenant Layer

- `synapse_owner_accounts`
- `synapse_seller_profiles`
- `synapse_payout_accounts`

作用：定义控制面主体、卖家主体和平台内部结算归属。

### 3.2 Agent Identity Layer

- `synapse_agent_profiles`
- `synapse_agent_credentials`
- `synapse_budget_policies`

作用：把 Agent 作为 Runtime 身份而不是一个附着在 API key 上的备注。

### 3.3 Service Catalog Layer

- `synapse_service_manifests`
- `synapse_service_endpoints`
- `synapse_service_health_snapshots`
- `synapse_service_search_index`

作用：把“挂单、可发现、可路由、可健康检查”拆成独立能力层。

### 3.4 Commerce Layer

- `synapse_service_quotes`
- `synapse_invocations`

作用：让 discover -> quote -> invoke 成为数据库里真正存在的状态机，而不是请求经过内存就消失。

### 3.5 Budget Layer

- `synapse_budget_events`

作用：实现 reserve / capture / release，防止预算被并发打穿。

### 3.6 Ledger Layer

- `synapse_ledger_accounts`
- `synapse_account_balances`
- `synapse_ledger_entries`

作用：把账户定义、余额快照、资金分录分开，既快又可审计。

### 3.7 Vault Funding Layer

- `synapse_vault_deposits`
- `synapse_vault_withdrawals`

作用：把链上 Owner 资金池入金/出金与 Runtime 调用链路解耦。

### 3.8 Reliability Layer

- `synapse_audit_events`
- `synapse_idempotency_keys`
- `synapse_runtime_state`
- `synapse_deposit_attempts`（可选保留）

作用：支撑审计、去重、游标推进和前端资金漏斗分析。

## 4. 新表映射关系

| 旧表 | 处理方式 | 新表 |
| --- | --- | --- |
| `synapse_service_registry` | 删除重构 | `synapse_service_manifests` + `synapse_service_endpoints` + `synapse_service_health_snapshots` + `synapse_service_search_index` |
| `synapse_credentials` | 删除重构 | `synapse_agent_profiles` + `synapse_agent_credentials` + `synapse_budget_policies` |
| 历史调用影子表 | 删除重构 | `synapse_service_quotes` + `synapse_invocations` + `synapse_budget_events` + `synapse_ledger_entries` |
| `synapse_balances` | 删除重构 | `synapse_ledger_accounts` + `synapse_account_balances` |
| `synapse_router_config` | 删除重构 | `synapse_budget_policies` |
| `synapse_deposit_intents` | 删除重构 | `synapse_vault_deposits` |
| 历史退款意图表 | 删除 | 并入 `synapse_vault_withdrawals` 或独立退款域 |
| 历史提现意图表 | 删除重构 | `synapse_vault_withdrawals` |
| `synapse_audit_log` | 重命名并重构 | `synapse_audit_events` |
| `synapse_idempotency_keys` | 复用 | `synapse_idempotency_keys` |
| `synapse_runtime_state` | 复用 | `synapse_runtime_state` |
| `synapse_deposit_attempts` | 可选保留 | `synapse_deposit_attempts` |

## 5. 新模型下的核心链路

### 5.1 Discover

读：

- `synapse_service_search_index`
- `synapse_service_manifests`
- `synapse_service_health_snapshots`

Agent 不需要读：

- `seller_wallet`
- `payout_account`
- 平台内部路由策略主键

### 5.2 Quote

写：

- `synapse_service_quotes`
- `synapse_budget_events` (`reserve`)

目标：

- 锁住价格窗口
- 锁住预算窗口

### 5.3 Invoke

写：

- `synapse_invocations`
- `synapse_budget_events` (`capture` / `release`)
- `synapse_ledger_entries`
- `synapse_audit_events`

### 5.4 Deposit / Withdraw

写：

- `synapse_vault_deposits`
- `synapse_vault_withdrawals`
- `synapse_ledger_entries`
- `synapse_account_balances`

## 6. 这次重构的执行原则

1. 不做历史兼容表映射，不在旧表上继续堆字段。
2. 公开协议围绕 `Service / Quote / Invocation / Agent Credential` 设计。
3. 卖家钱包、分账、结算账户留在平台内部表，不进 Agent-facing 协议。
4. 数据库命名必须服务 Runtime 真相，而不是服务历史页面路径。
5. 所有金额字段继续使用 `NUMERIC`，所有关键写操作继续强事务。

## 7. 对应落地文件

- 目标 schema SQL: [infra/docker/postgres/init/001_synapse_schema.sql](../../infra/docker/postgres/init/001_synapse_schema.sql)
- 新数据模型文档: [docs/03_Smart_Contract_Payment/Agent_Runtime_Data_Model.md](../03_Smart_Contract_Payment/Agent_Runtime_Data_Model.md)

一句话：这次不是“把 API Key 升级一下”，而是把 Synapse 从钱包驱动的 API 支付网关，重铸成 Agent Runtime 驱动的调用与结算基础设施。