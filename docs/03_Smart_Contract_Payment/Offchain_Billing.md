# Off-chain Billing Architecture

> 这份文档定义 Synapse 资金系统的 canonical target-state 设计。旧的单桶账本与双边角色命名已废弃，后续后端重构以本文为准。

## 1. 设计目标

Synapse 的计费系统必须同时满足：

1. Agent Runtime 调用低延迟
2. Owner 资金归属清晰
3. Provider 收益独立可提现
4. Platform 审计与对账可追溯

因此，计费系统不再以历史单桶余额对象作为主模型，而是改用：

1. `Owner`
2. `Agent`
3. `Provider role`
4. `ledger buckets`
5. `budget and settlement events`

## 2. 角色与职责

### 2.1 Owner

Owner 是根身份，负责：

1. 向 Vault 入金
2. 创建 Agent
3. 签发 Credential
4. 管理服务
5. 查看消费与收益

### 2.2 Agent

Agent 是运行时执行身份，负责：

1. Discovery
2. Quote
3. Invoke
4. 消耗 Owner 预算

### 2.3 Provider

Provider 不是独立账户，而是 Owner 的供给侧业务角色。

### 2.4 Platform

Platform 负责：

1. 报价
2. 风控
3. 扣费
4. 分账
5. 审计
6. 结算

## 3. 资金桶模型

同一个 Owner 下至少要拆出这些 bucket：

1. `consumer_available`
2. `consumer_pending`
3. `consumer_locked`
4. `provider_receivable`
5. `provider_locked`
6. `platform_fee`

它们回答的是不同问题：

1. `consumer_available`: Agent Runtime 当前可消费的资金
2. `consumer_pending`: 已登记但未最终确认的入金
3. `consumer_locked`: refund / risk / review 占用中的消费侧资金
4. `provider_receivable`: Provider 已赚到但未提现的收益
5. `provider_locked`: provider withdrawal 占用中的收益
6. `platform_fee`: 平台累计抽成

## 4. 计费主链路

### 4.1 入金阶段

1. Owner 向 Vault 入金
2. Platform 创建 deposit intent
3. Indexer 确认链上事件
4. 金额进入 `consumer_available`

### 4.2 调用阶段

1. Agent 发起 Discovery / Quote / Invoke
2. Platform 检查 Credential + Budget + Owner 资金
3. 调用成功后执行分账

### 4.3 分账阶段

设：

- `unit_price = P`
- `platform_fee = F`
- `provider_net = N`

则：

- `N = P - F`

一次成功调用后：

1. `consumer_available -= P`
2. `provider_receivable += N`
3. `platform_fee += F`

## 5. 预算与余额的边界

预算不是余额，余额也不是凭据。

### 5.1 Budget

Budget 控制：

1. 这个 Agent 能不能花
2. 一次最多花多少
3. 每天最多花多少

### 5.2 Balance

Balance 控制：

1. Owner 账户里是否真有足够资金
2. 调用成功后如何分账

### 5.3 Credential

Credential 控制：

1. 谁在跑
2. 允许调用什么
3. 风控命中后是否拦截

## 6. Refund 与 Provider Withdrawal 必须分离

这条是未来代码重构的硬约束。

### 6.1 Refund

Refund 只作用于：

1. `consumer_available`
2. `consumer_locked`

路径：

1. `consumer_available -> consumer_locked`
2. 链上完成后 `consumer_locked -> owner wallet`

### 6.2 Provider Withdrawal

Provider Withdrawal 只作用于：

1. `provider_receivable`
2. `provider_locked`

路径：

1. `provider_receivable -> provider_locked`
2. 链上完成后 `provider_locked -> owner wallet`

### 6.3 结论

同一个 `ownerAddress` 可以同时发起：

1. refund
2. provider withdrawal

只要它们操作的是不同 bucket，就不会冲突。

## 7. 审计事件模型

所有资金变化都要落成事件，而不是只改最终余额。

至少包括：

1. `vault_deposit_registered`
2. `vault_deposit_confirmed`
3. `budget_reserved`
4. `usage_charged`
5. `provider_earning_accrued`
6. `platform_fee_captured`
7. `refund_intent_created`
8. `refund_completed`
9. `provider_withdraw_intent_created`
10. `provider_withdraw_completed`

## 8. 对账不变量

目标不变量：

$$
consumer\_available + consumer\_pending + consumer\_locked + provider\_receivable + provider\_locked + platform\_fee = vault\_obligation
$$

如果引入外部坏账、人工调整、争议冻结，则必须通过独立 adjustment event 进入账本，而不能直接改余额。

## 9. API 设计影响

后续代码重构时，API 应该遵循：

1. `GET /balance` 返回的是 owner-scoped finance summary
2. Refund API 明确声明自己只处理 consumer bucket
3. Provider withdrawal API 明确声明自己只处理 provider bucket
4. Agent-facing API 不暴露 provider settlement internals

## 10. 数据模型方向

建议后续代码重构时，逐步收敛到以下对象：

1. `owner_accounts`
2. `agent_profiles`
3. `agent_credentials`
4. `budget_policies`
5. `service_manifests`
6. `service_quotes`
7. `invocations`
8. `ledger_accounts`
9. `ledger_entries`
10. `audit_events`

## 11. 结论

Off-chain Billing 的 canonical 设计不是：

1. 一个单一消费余额
2. 一个单一供给应收
3. 一个模糊平台池

而是：

**一个 Owner 身份下的多资金桶账本系统，由 Agent Runtime 消费，由 Provider role 赚取收益，由 Platform 负责风控、扣费、审计和清算。**
