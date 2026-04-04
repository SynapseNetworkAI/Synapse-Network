# Gateway Admin Projection Views SQL 设计文档

本文对应文件：`docker-compose/postgres/init/gateway-admin/003_gateway_admin_projection_views.sql`

目标：

- 把 `synapse_gateway` 真相表加工成只读控制面投影视图
- 保持 gateway-admin 只能读 projection，不直接拼真相表
- 让 target-state 新命名和旧控制面字段名可以同时存在，平滑升级

## 1. 设计原则

### 1.1 为什么必须用 projection view

- `gateway-admin` 是控制面，不应该直接读资金真相表去拼业务语义
- dashboard 需要的是“稳定读模型”，不是底层账本细节
- SQL view 可以把多个真相表、运行态状态、审计聚合成一个稳定只读接口层

### 1.2 为什么要保留兼容别名

target-state 表结构已经从旧的 owner/refund/withdrawal 语义，升级到更准确的 consumer/provider 语义：

- `consumer_refund`
- `provider_withdrawal`
- `consumer_liability`

但历史 `gateway-admin` 代码仍可能读取这些旧列名：

- `today_refund_usdc`
- `today_withdrawal_usdc`
- `owner_liability_usdc`
- `refund_usdc`
- `withdrawal_usdc`
- `pending_withdrawal_count`

因此当前 SQL 的策略是：

- canonical 列继续使用 target-state 新命名
- 同一视图内追加旧别名列
- 新代码优先读 canonical 列，旧代码靠 alias 不炸

这不是双真相，而是单一计算、多名称暴露。

## 2. 视图总览

`gateway-admin/003_gateway_admin_projection_views.sql` 在 `synapse_gateway_db` 条件下创建 4 个只读对象：

1. `synapse_admin_dashboard_finance_projection`
2. `synapse_admin_dashboard_activity_trend_projection`
3. `synapse_admin_dashboard_operations_projection`
4. `synapse_admin_dashboard_projection`

前三个是主题视图，最后一个是聚合兼容视图。

## 3. synapse_admin_dashboard_finance_projection

用途：

- 给后台资金总览卡片提供稳定快照
- 暴露当天充值、扣费、调用次数、平台新增手续费、Provider 新增收入、退款、提现、负债、应付、平台收入、对账差额和待处理计数

### 3.1 CTE: `day_window`

```sql
SELECT date_trunc('day', NOW()) AS day_start
```

作用：

- 定义“今天”的起点
- 给 deposit / refund / withdrawal / charge 的日累计窗口复用

字段：

- `day_start`：当前 UTC 时间截断到当天零点

### 3.2 CTE: `reconciliation`

来源：`synapse_runtime_state`

作用：

- 读取 `deposit_reconciliation_state`
- 暴露最近一次 vault 对账差额和更新时间

字段：

- `vault_ledger_delta_usdc`：从 `payload.deltaUsdc` 取出的差额，空值时回退 `0`
- `reconciliation_updated_at`：该 runtime state 记录更新时间

### 3.3 CTE: `balance_snapshot`

来源：

- `synapse_account_balances`
- `synapse_ledger_accounts`

作用：

- 汇总不同账本账户类型的当前余额快照

字段：

- `consumer_liability_usdc`：`consumer_wallet` 账户 `available + pending` 总和
- `provider_payable_usdc`：`provider_wallet` 账户 `available + pending` 总和
- `platform_fee_balance_usdc`：`platform_revenue` 账户 `available + pending` 总和
- `balances_updated_at`：参与聚合余额行里的最新更新时间

### 3.4 CTE: `deposit_window`

来源：`synapse_vault_deposits`

作用：

- 统计当天充值金额
- 统计待确认充值数量

字段：

- `today_deposit_usdc`：当天创建且 `status != FAILED` 的金额总和
- `pending_deposit_count`：当前 `PENDING_CONFIRMATION` 的充值数量
- `deposits_updated_at`：相关充值记录的最新更新时间

### 3.5 CTE: `consumer_refund_window`

来源：`synapse_vault_withdrawals`

过滤：

- `withdrawal_kind = 'consumer_refund'`

作用：

- 统计当天消费者退款完成金额
- 统计尚未完成的消费者退款数量

字段：

- `today_consumer_refund_usdc`：当天 `CONFIRMED` 的消费者退款金额
- `pending_consumer_refund_count`：`REQUESTED / SIGNED / BROADCASTED` 状态的消费者退款数量
- `consumer_refunds_updated_at`：相关记录最新更新时间

### 3.6 CTE: `provider_withdrawal_window`

来源：`synapse_vault_withdrawals`

过滤：

- `withdrawal_kind = 'provider_withdrawal'`

作用：

- 统计当天服务商提现完成金额
- 统计尚未完成的服务商提现数量

字段：

- `today_provider_withdrawal_usdc`：当天 `CONFIRMED` 的服务商提现金额
- `pending_provider_withdrawal_count`：`REQUESTED / SIGNED / BROADCASTED` 状态的服务商提现数量
- `provider_withdrawals_updated_at`：相关记录最新更新时间

### 3.7 CTE: `charge_window`

来源：`synapse_invocations`

作用：

- 统计当天成功或已结算调用的收费额

字段：

- `today_charge_usdc`：当天 `SUCCEEDED / SETTLED` 的 `charged_usdc` 总和
- `charge_updated_at`：相关调用记录最新更新时间

### 3.8 CTE: `invocation_billing_window`

来源：

- `synapse_invocations`
- `synapse_runtime_state(state_key like 'invocation_billing::%')`

作用：

- 统计当天成功进入计费链路的调用次数
- 统计当天平台新增手续费收入
- 统计当天 Provider 新增收入

字段：

- `today_invocation_count`：当天 `SUCCEEDED / SETTLED` 且 `businessType = charge` 的调用次数
- `today_platform_fee_earned_usdc`：当天 `protocolFee + routingTax` 的总和
- `today_provider_earned_usdc`：当天 `unitPrice - protocolFee` 的总和
- `invocation_billing_updated_at`：调用计费投影视图相关记录最新更新时间

### 3.9 最终 SELECT 字段说明

canonical 字段：

- `today_charge_usdc`：当天调用收费额
- `today_deposit_usdc`：当天充值额
- `today_consumer_refund_usdc`：当天消费者退款额
- `today_provider_withdrawal_usdc`：当天服务商提现额
- `today_invocation_count`：当天成功进入计费链路的调用次数
- `today_platform_fee_earned_usdc`：当天平台新增手续费收入
- `today_provider_earned_usdc`：当天 Provider 新增收入
- `consumer_liability_usdc`：消费者侧钱包负债
- `provider_payable_usdc`：服务商应付余额
- `platform_fee_balance_usdc`：平台收入余额
- `vault_ledger_delta_usdc`：最近对账差额
- `pending_deposit_count`：待确认充值数
- `pending_consumer_refund_count`：待完成消费者退款数
- `pending_provider_withdrawal_count`：待完成服务商提现数
- `projected_at`：整个 finance projection 的 freshness watermark

兼容 alias 字段：

- `today_refund_usdc` = `today_consumer_refund_usdc`
- `today_withdrawal_usdc` = `today_provider_withdrawal_usdc`
- `owner_liability_usdc` = `consumer_liability_usdc`
- `pending_withdrawal_count` = `pending_provider_withdrawal_count`

## 4. synapse_admin_dashboard_activity_trend_projection

用途：

- 提供最近 7 天按天聚合的充值、扣费、退款、提现、净流入趋势

### 4.1 CTE: `day_series`

作用：

- 生成从今天往前 6 天的连续日期序列
- 保证即使某天没有交易，图表也有 0 值行，不会断裂

字段：

- `bucket_date`：UTC 日桶日期

### 4.2 CTE: `deposit_daily`

来源：`synapse_vault_deposits`

字段：

- `bucket_date`：`created_at::date`
- `deposit_usdc`：当天非失败充值额

### 4.3 CTE: `charge_daily`

来源：`synapse_invocations`

字段：

- `bucket_date`：`created_at::date`
- `charge_usdc`：当天 `SUCCEEDED / SETTLED` 收费额

### 4.4 CTE: `invocation_billing_daily`

来源：

- `synapse_invocations`
- `synapse_runtime_state(state_key like 'invocation_billing::%')`

字段：

- `bucket_date`：`created_at::date`
- `invocation_count`：当天进入计费链路的调用次数
- `platform_fee_earned_usdc`：当天平台新增手续费收入
- `provider_earned_usdc`：当天 Provider 新增收入

### 4.5 CTE: `consumer_refund_daily`

来源：`synapse_vault_withdrawals`

字段：

- `bucket_date`：`updated_at::date`
- `consumer_refund_usdc`：当天确认的消费者退款额

### 4.6 CTE: `provider_withdrawal_daily`

来源：`synapse_vault_withdrawals`

字段：

- `bucket_date`：`updated_at::date`
- `provider_withdrawal_usdc`：当天确认的服务商提现额

### 4.7 最终 SELECT 字段说明

canonical 字段：

- `bucket_date`：日桶日期
- `deposit_usdc`：充值额
- `charge_usdc`：收费额
- `invocation_count`：成功进入计费链路的调用次数
- `platform_fee_earned_usdc`：平台新增手续费收入
- `provider_earned_usdc`：Provider 新增收入
- `consumer_refund_usdc`：消费者退款额
- `provider_withdrawal_usdc`：服务商提现额
- `net_flow_usdc`：`deposit - consumer_refund - provider_withdrawal`

兼容 alias 字段：

- `refund_usdc` = `consumer_refund_usdc`
- `withdrawal_usdc` = `provider_withdrawal_usdc`

## 5. synapse_admin_dashboard_operations_projection

用途：

- 暴露运行态健康、回填进度、审计告警、失败充值、对账状态摘要

### 5.1 CTE: `indexer_runtime`

来源：`synapse_runtime_state(state_key='deposit_indexer_runtime_state')`

字段：

- `indexer_running`：indexer 主循环是否处于运行态
- `indexer_last_processed_at`：最近一次成功推进 pending intent 的时间
- `indexer_last_heartbeat_at`：最近一次任务心跳时间
- `indexer_last_error`：最近一次 indexer 主循环错误码
- `indexer_poll_interval_sec`：indexer 轮询间隔
- `backfill_enabled`：backfill 是否开启
- `backfill_last_scan_at`：最近一次 backfill 扫描时间
- `backfill_last_scanned_block`：最近一次完成扫描的区块高度
- `backfill_last_recovered`：最近一次 backfill 扫描追回的充值数量
- `backfill_last_error`：最近一次 backfill 失败错误码
- `reconciliation_enabled`：reconciliation 是否开启
- `last_reconciliation_at`：最近一次 reconciliation 执行时间
- `reconciliation_delta_usdc`：最近一次 reconciliation 差额
- `reconciliation_alert`：最近一次 reconciliation 是否打开告警
- `reconciliation_last_error`：最近一次 reconciliation 任务错误码
- `indexer_runtime_updated_at`：持久化任务状态记录更新时间

### 5.2 CTE: `reconciliation`

来源：`synapse_runtime_state`

字段：

- `last_reconciliation_at`：最近一次对账时间
- `reconciliation_delta_usdc`：最近对账差额
- `reconciliation_alert`：是否触发对账告警
- `reconciliation_last_error`：最近对账错误
- `reconciliation_updated_at`：runtime state 更新时间

该 CTE 仅作为兼容回退来源，在新字段未回填到 `deposit_indexer_runtime_state` 时提供旧对账时间/差额。

### 5.3 CTE: `runtime_projection`

来源：`synapse_runtime_state`

字段：

- `runtime_projection_updated_at`：运行态投影最近更新时间

当前只作为 legacy fallback 使用：如果 `deposit_indexer_runtime_state` 尚未生成，旧 reader 仍可得到最近投影更新时间。

### 5.4 CTE: `failed_deposits`

来源：`synapse_vault_deposits`

字段：

- `failed_deposit_count`：失败充值数量
- `failed_deposits_updated_at`：相关记录最新更新时间

### 5.5 CTE: `audit_window`

来源：`synapse_audit_events`

字段：

- `recent_audit_alerts`：24 小时内带失败/告警语义或有 `error_code` 的审计数
- `audit_updated_at`：相关审计最近更新时间

### 5.6 CTE: `system_window`

来源：`synapse_audit_events`

字段：

- `recent_gateway_failures`：30 分钟内网关失败/错误/降级类事件数
- `system_updated_at`：相关系统事件最近更新时间

### 5.7 最终 SELECT 字段说明

- `gateway_status`：如果存在对账告警、indexer/backfill/reconciliation 任务错误、indexer 停止或近期网关失败，则为 `degraded`，否则 `healthy`
- `indexer_running`：真实 indexer 主循环运行态
- `indexer_last_processed_at`：优先取真实 indexer 处理时间，缺失时回退到 runtime projection 更新时间
- `indexer_last_heartbeat_at`：真实 indexer 心跳时间
- `indexer_last_error`：真实 indexer 主循环错误码
- `indexer_poll_interval_sec`：indexer 轮询周期
- `backfill_enabled`：真实 backfill 开关状态
- `backfill_last_scan_at`：优先取真实 backfill 扫描时间，缺失时回退到 runtime projection 更新时间
- `backfill_last_scanned_block`：真实 backfill 最近扫到的区块高度
- `backfill_last_recovered`：真实 backfill 最近追回的充值数量
- `backfill_last_error`：真实 backfill 错误码
- `recent_gateway_failures`：最近 30 分钟失败事件数
- `failed_deposit_count`：失败充值数
- `recent_audit_alerts`：最近 24 小时审计告警数
- `reconciliation_enabled`：真实 reconciliation 开关状态
- `last_reconciliation_at`：优先取真实 reconciliation 最近执行时间，缺失时回退到旧 runtime state
- `reconciliation_alert`：真实 reconciliation 告警状态
- `reconciliation_delta_usdc`：真实 reconciliation 最近差额
- `reconciliation_last_error`：真实 reconciliation 任务错误信息
- `projected_at`：operations projection 的 freshness watermark

## 6. synapse_admin_dashboard_projection

用途：

- 给 `overview` 和 `system-status` 这种旧摘要接口提供统一聚合入口

来源：

- `synapse_admin_dashboard_finance_projection`
- `synapse_admin_dashboard_operations_projection`

字段：

- `deposit_exceptions`：映射自 `operations.failed_deposit_count`
- `audit_alerts`：映射自 `operations.recent_audit_alerts`
- `vault_ledger_delta_usdc`：映射自 finance 对账差额
- `gateway_status`：映射自 operations 健康状态
- `last_reconciliation_at`：映射自 operations 对账时间
- `reconciliation_alert`：映射自 operations 对账告警
- `reconciliation_last_error`：映射自 operations 对账错误
- `projected_at`：finance 和 operations 两者最新时间戳中的较大值

## 7. 升级与兼容建议

### 7.1 新代码约束

新写的 gateway-admin 代码优先读取 canonical 列：

- finance：`today_consumer_refund_usdc`、`today_provider_withdrawal_usdc`、`consumer_liability_usdc`
- activity：`consumer_refund_usdc`、`provider_withdrawal_usdc`

### 7.2 旧代码过渡

如果旧版本 admin 仍读取这些列，也不会炸：

- `today_refund_usdc`
- `today_withdrawal_usdc`
- `owner_liability_usdc`
- `refund_usdc`
- `withdrawal_usdc`
- `pending_withdrawal_count`

### 7.3 为什么不直接删旧字段

因为视图升级和控制面代码升级经常不是同一时刻完成。先在 SQL 层保留 alias，可以避免“库先升级，admin 直接白屏/500”。这是基础设施该有的降维打击，不是妥协。