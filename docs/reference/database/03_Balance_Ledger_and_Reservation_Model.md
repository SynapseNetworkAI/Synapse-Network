# Balance, Ledger, and Reservation Model

## 1. 目标

本文件解释 Synapse 最容易写错的部分：

1. 余额到底是什么
2. 预算预占和资金冻结的关系是什么
3. 为什么 ledger entry 才是最终真相
4. 平台抽成、Provider 收益、Owner 消费为什么必须分桶

## 2. 账户模型

最新 schema 的账户主表是 `synapse_ledger_accounts`。

当前只允许四类账户：

1. `consumer_wallet`
2. `provider_wallet`
3. `platform_revenue`
4. `budget_hold`

这四类已经足够支撑 V1 的资金主线。

## 3. 余额快照不是最终真相

`synapse_account_balances` 只有三个数字：

1. `available_balance`
2. `pending_balance`
3. `frozen_balance`

这三个数字的作用是：

1. 给高频查询提供快速读
2. 给控制台、风控、后台提供当前快照

它们不承担的职责是：

1. 定义业务发生了什么
2. 替代 ledger entry 做最终对账
3. 让业务代码随意直接覆盖余额

## 4. 四类资金桶

### 4.1 Owner Consumer Bucket

对应 `consumer_wallet`。

用途：

1. Deposit 确认后资金进入这里
2. Agent 成功调用后从这里支出
3. Refund 从这里冻结并出金

### 4.2 Provider Earnings Bucket

对应 `provider_wallet`。

用途：

1. 成功结算后的 Provider 应收进入这里
2. Withdrawal 从这里冻结并出金

### 4.3 Platform Revenue Bucket

对应 `platform_revenue`。

用途：

1. 平台服务费、路由费或抽成进入这里
2. 不属于任何单个 Owner 的消费或收益余额

### 4.4 Budget Hold Bucket

对应 `budget_hold`。

用途：

1. Quote 阶段做预占
2. Invoke 执行中承载 reserve 到 capture / release 的中间态

它是 Runtime commerce 正确工作的关键，因为没有预占池，就没有安全的并发预算控制。

## 5. Reservation Model

预算事件使用 `synapse_budget_events` 表达。

这里的预算边界与 runtime risk 文档需要一起理解：`reserve / capture / release` 不是余额字段上的临时减法，而是 Credential / Budget Policy 在数据库中的显式事件流。

### 5.1 `reserve`

用途：

1. Quote 成功后预占预算窗口
2. 避免多次并发 invoke 透支同一 credential

### 5.2 `capture`

用途：

1. 调用成功交付后正式计费
2. 从 budget hold 走向最终资金结算

### 5.3 `release`

用途：

1. 调用失败、超时或 quote 过期后释放预占
2. 确保冻结预算不会一直泄漏

### 5.4 `adjust`

用途：

1. 平台内部人工修正预算或额度
2. 必须伴随审计事件，不允许静默修改

## 6. Ledger Entry Model

`synapse_ledger_entries` 定义了每次真实资金转移。

最关键的思想是：

1. 不直接“改某个余额”作为系统真相
2. 先形成借贷分录
3. 再由分录聚合或驱动快照更新

### 6.1 一次成功调用的业务效果

从业务角度看，一次成功调用至少包含三类结果：

1. Owner 消费减少
2. Provider 应收增加
3. Platform revenue 增加

因为 `synapse_ledger_entries` 是双边分录结构，实际落账可以拆成多条 pair，但数学上必须保持总额守恒。

### 6.2 一次 confirmed deposit 的业务效果

业务上至少要完成：

1. Owner 对应 `consumer_wallet.pending_balance` 减少
2. `consumer_wallet.available_balance` 增加
3. 对应 deposit reference 的 ledger entry 成立

### 6.3 一次 provider withdrawal 的业务效果

业务上至少要完成：

1. `provider_wallet.available_balance` 减少
2. `provider_wallet.frozen_balance` 增加，再在确认后释放出账
3. withdrawal reference 对应的 ledger entry 和 audit event 成立

## 7. 三类典型链路如何落到账户层

### 7.1 Deposit

1. 登记 intent 时：增加 `pending_balance`
2. 确认成功后：`pending -> available`

### 7.2 Quote / Invoke

1. quote 时：预算 `reserve`
2. invoke 成功：预算 `capture`，同时进入 consumer/provider/platform 三桶账务结算
3. invoke 失败：预算 `release`

### 7.3 Withdrawal / Refund

1. 创建 intent 时：`available -> frozen`
2. 链上确认后：从冻结态完成最终出金
3. 失败时：冻结金额必须回滚释放

## 8. 为什么必须严格桶隔离

如果桶不隔离，系统会立刻退化出三类严重问题：

1. Owner 消费余额可能被错误提现成 Provider 收益
2. Provider 收益可能被错误用于 Agent 调用
3. 平台收入可能被误记成用户资产

这不是 UI 命名问题，而是资金错账问题。

## 9. 快照更新原则

`synapse_account_balances` 的更新必须遵守：

1. 与 ledger entry 同事务提交
2. 失败即回滚
3. 不允许分录成功、快照失败
4. 不允许快照成功、分录缺失

否则系统会出现“能看到余额变化，但找不到流水”的金融级事故。

## 10. 文档结论

Synapse 的余额模型不是一个钱包数字，而是：

**Account Kind + Balance Snapshot + Budget Reservation + Ledger Entries**

共同组成的多层资金真相。

只有把这四层都做实，平台才能同时支持：

1. Owner 入金
2. Agent 自动消费
3. Provider 收益累积
4. Platform 抽成
5. Refund 和 Withdrawal 的严格隔离