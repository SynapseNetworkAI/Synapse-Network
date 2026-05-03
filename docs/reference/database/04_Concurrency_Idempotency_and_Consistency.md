# Concurrency, Idempotency, and Consistency

## 1. 目标

这份文档不讲页面，不讲 API 文案，只讲数据库安全底盘。

如果这里做错，Synapse 会出现最糟糕的三类事故：

1. 重复入金
2. 重复扣费或超扣
3. 冻结金额泄漏或错桶出金

因此 Phase 2 最重要的结论是：

**并发控制、幂等、防重放和事务一致性，不是优化项，而是上线门禁。**

## 2. 幂等设计

### 2.1 API 级幂等

SQL 通过 `synapse_idempotency_keys` 提供统一幂等设施。

关键字段：

1. `scope`
2. `owner_id`
3. `idempotency_key`
4. `request_hash`
5. `response_code`
6. `response_digest`

关键约束：

1. `UNIQUE (scope, owner_id, idempotency_key)`

这条约束直接防止：

1. 同一个 Owner 在同一业务域重复提交同一请求
2. 网络重试被误判成新操作

### 2.2 链上事实级幂等

除了 API 级幂等，还必须有业务主键级去重。

典型例子：

1. `synapse_vault_deposits.tx_hash UNIQUE`
2. `synapse_vault_withdrawals.tx_hash UNIQUE`
3. `synapse_vault_withdrawals.ticket_hash` 业务唯一，且链上 `consumedTickets[ticketHash]` 单次消费
4. `synapse_invocations UNIQUE (credential_id, idempotency_key)`
5. `synapse_ledger_entries UNIQUE (reference_type, reference_id, debit_account_id, credit_account_id)`

这些约束共同解决：

1. 同一链上入金不重复入账
2. 同一链上提现不重复核销
3. 同一 withdrawal ticket 不重复 claim
4. 同一业务调用不重复执行和扣费
5. 同一业务参考对象不重复生成账本分录

## 3. 悲观锁与行锁

最新 SQL 没有把锁策略写成 DDL，但从业务性质上，以下写路径必须采用数据库级悲观锁或等价原子更新。

### 3.1 Deposit 确认

更新 `synapse_account_balances` 前，必须锁定目标 `account_id` 对应的余额行。

否则两条确认路径可能同时执行：

1. 重复把同一笔 pending 转成 available
2. 造成重复入账

### 3.2 Quote Reserve / Invoke Capture / Release

对 `synapse_budget_policies`、预算快照来源和关联账户余额做预占/释放时，必须：

1. 锁定 credential 对应 policy
2. 锁定相关 `budget_hold` / `consumer_wallet` 账户快照

否则并发 invoke 会出现：

1. 多次 reserve 同一预算窗口
2. capture 时超出上限
3. release 释放错误金额

### 3.3 Withdrawal / Refund

创建提现和退款 intent 时，必须锁住 source account 的余额行。

否则会出现：

1. 两个并发请求同时读取同一可用余额
2. 分别都认为“余额充足”
3. 最终造成双提或超提

提现创建必须用数据库原子锁仓或等价事务边界，不允许先把余额读到内存再计算。
Consumer 自动通过路径只能执行一次 `available -> pending`，人工审核路径只能执行一次
`available -> frozen`；Provider 路径同理，只能在 provider 资金桶内移动。
如果并发请求导致条件更新影响行数为 0，必须拒绝本次创建，不得签 ticket。

## 4. 原子事务边界

金融路径的写入必须是事务内闭环。

### 4.1 Deposit Confirm 事务

必须同事务完成：

1. update `synapse_vault_deposits.status`
2. update `synapse_account_balances`
3. insert `synapse_ledger_entries`
4. insert `synapse_audit_events`

### 4.2 Invocation Settle 事务

必须同事务完成：

1. insert `synapse_budget_events(capture or release)`
2. insert `synapse_ledger_entries`
3. update `synapse_account_balances`
4. update `synapse_invocations`
5. insert `synapse_audit_events`

### 4.3 Withdrawal Intent 事务

必须同事务完成：

1. insert `synapse_vault_withdrawals`
2. update `synapse_account_balances.available/pending/frozen`
3. insert `synapse_ledger_entries`
4. insert `synapse_audit_events`

自动通过提现的 ticket 签发必须发生在余额原子锁仓成功之后。人工审核提现只有在
`APPROVE` 成功完成 `frozen -> pending` 后才能签发 ticket。任何重复 approve、
reject、complete 或 fail 回调都不得让同一笔余额重复释放或重复消费。

## 5. 状态机一致性

数据库里的状态必须满足单向推进，不允许任意跳转。

### 5.1 Deposit

只允许：

1. `PENDING_CONFIRMATION -> CONFIRMED`
2. `PENDING_CONFIRMATION -> FAILED`

### 5.2 Quote

只允许：

1. `OPEN -> CONSUMED`
2. `OPEN -> EXPIRED`
3. `OPEN -> CANCELLED`

### 5.3 Invocation

只允许沿执行路径推进，不允许已 `SETTLED` 的 invocation 回到 `RUNNING`。

### 5.4 Withdrawal

Consumer withdrawal 只允许：

1. `REQUESTED -> COMPLETED`
2. `REQUESTED -> FAILED`
3. `REQUESTED -> FAILED_EXPIRED`
4. `PENDING_MANUAL_REVIEW -> REQUESTED`
5. `PENDING_MANUAL_REVIEW -> REJECTED`
6. `PENDING_MANUAL_REVIEW -> FAILED_EXPIRED`

Provider withdrawal 只允许：

1. `APPROVED_AUTO -> COMPLETED`
2. `APPROVED_AUTO -> CANCELLED` 或 `FAILED_EXPIRED`
3. `PENDING_MANUAL_REVIEW -> APPROVED_AUTO`
4. `PENDING_MANUAL_REVIEW -> REJECTED`
5. `PENDING_MANUAL_REVIEW -> FAILED_EXPIRED`

状态机单向推进的意义是：

1. 审计可解释
2. 回放和修复有边界
3. 过期释放在终态落库成功后天然幂等，不会重复把同一笔 pending/frozen/locked 余额释放回 available
4. 不会靠“修改历史状态”掩盖事故

## 6. 对账一致性

数据库必须支持至少三类对账：

### 6.1 Deposit 对账

对比：

1. `synapse_vault_deposits`
2. 链上 receipt / event
3. `consumer_wallet` 账户快照

### 6.2 Invocation 对账

对比：

1. `synapse_invocations`
2. `synapse_budget_events`
3. `synapse_ledger_entries`
4. `synapse_audit_events`

### 6.3 Withdrawal 对账

对比：

1. `synapse_vault_withdrawals`
2. 链上 tx hash
3. `provider_wallet` 或 `consumer_wallet` 的冻结与释放分录

## 7. Typed Sidecar 的一致性作用

`synapse_runtime_state` 不承担主账务真相，但承担两类关键辅助职责：

1. 保存不适合塞进主表的流程补充数据
2. 保存回放、索引器、提款票据等 typed sidecar 状态

它不能替代：

1. `synapse_vault_deposits`
2. `synapse_vault_withdrawals`
3. `synapse_invocations`
4. `synapse_ledger_entries`

但它能减少主表被大量流程态字段污染。

## 8. 数据库层必须防住的事故清单

1. 同一 `tx_hash` 重复登记 deposit
2. 同一 `idempotency_key` 重复生成 invocation
3. quote 过期后仍允许 capture
4. failed invocation 未 release 预算
5. provider withdrawal 未锁仓先签名
6. consumer withdrawal 未过 T+1 成熟期却被提现
7. provider withdrawal 未过 T+7 争议期却被提现
8. 并发 create 造成多条有效 withdrawal 或多次锁仓
9. 并发 approve/reject 同时落到两个终态
10. 并发 complete 重复消费 pending/locked 余额
11. 同一 `ticketHash` 链上 replay 成功
12. refund 错动 provider bucket
13. ledger entry 成功但 balance snapshot 未更新
14. balance snapshot 更新了但没有 ledger / audit 证据

## 9. 文档结论

Synapse 的数据库设计不是“结构化存几张表”这么简单，它本质上是：

**用唯一约束、状态机、悲观锁、原子事务和对账关系，把资金和调用的真相钉死。**

如果这些约束不先落地，所有上层 API 和前端控制台都会建立在不可信的账本之上。
