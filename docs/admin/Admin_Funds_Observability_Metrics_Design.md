# 管理后台资金链路数据观测指标设计

本文回答三个问题：

1. 是否应该增加一组按 `Consumer / Platform / Provider` 分层的数据展示卡片。
2. 这组卡片是否适合放在 `dashboard/overview`。
3. 整个平台从充值、消费、退款、分账、提现到总账对齐，完整的资金链路观测指标应该如何设计。

结论先行：

**需要增加这组指标，但不应该以“8 张新的顶层 overview metric cards”直接塞进 overview 哨兵区。更合理的做法是：**

1. `overview` 只增加一个紧凑的 `Capital Pulse / 资金链路摘要` 分组面板，用于回答“今天 Consumer / Platform / Provider 三侧资金活动是否符合预期”。
2. 完整的资金链路指标体系应以 `/finance` 为主页面承载，`overview` 只保留摘要和跳转。
3. 现有后端读模型已经覆盖一部分金额指标，但缺少 `今日调用次数`、`今日平台新增手续费收入`、`今日 Provider 新增收入`、`今日 Provider 提现手续费` 这类真正能把三侧资金责任面摊平的字段，需要由 `gateway-admin` 基于 projection 新增稳定字段后再上 UI。

---

## 1. 为什么要补这组指标

当前后台 Finance 已经能回答三类问题：

- 平台总账是否对齐
- 充值 / 扣费 / 退款 / 提现的总量有多大
- 当前有哪些 pending deposits / pending withdrawals / delta 风险

但它还缺一个非常关键的 operator 视角：

- **Consumer 今天充了多少、花了多少、退了多少、调用了多少次**
- **Platform 今天新增赚了多少手续费**
- **Provider 今天新增赚了多少、今天提走了多少、今天为提现支付了多少费用**

如果没有这层分面，值班人员看到的仍然是“金额块”，但不是“责任面”。

这会带来三个问题：

1. 无法快速判断今天的增长来自消费活跃、平台抽成，还是 provider 端结算变动。
2. 无法用统一口径解释 `Consumer -> Platform -> Provider -> Chain Vault` 之间的资金流向。
3. `/finance` 容易停留在“总账判断页”，却没有形成“经营观测 + 资金调查”的完整闭环。

所以，这组卡片不是装饰，而是把资金观测从“账务视图”升级为“业务责任视图”的必要一步。

---

## 2. 是否适合加在 `overview`

答案分两层。

### 2.1 不适合的做法

**不适合**把下面这些指标直接作为新的顶层 overview 卡片并列塞到哨兵区：

- 今日用户充值
- 今日用户消费
- 今日用户退款
- 今日调用次数
- 今日平台赚取手续费
- 今日 Provider 新增收入
- 今日 Provider 提现金额
- 今日 Provider 提现手续费

原因很直接：

1. `overview` 的职责是分诊，不是第二个 Finance Desk。
2. 顶层哨兵区应该只放“值班结论 / 总账风险 / 审批压力”这种指导下一跳的信号。
3. 如果把 8 张经营类卡片放进去，overview 会重新膨胀成“大而全首页”，再次破坏已经收敛好的 IA 边界。

### 2.2 适合的做法

**适合**在 `overview` 增加一个独立的、紧凑的分组面板，例如：

- Surface 名称：`Capital Pulse`
- 中文名称：`资金链路摘要`
- 位置建议：
  - 在 `当前值班结论 / 平台总账差额 / 待处理审批` 下面
  - 在 `今日资金概览` 和 `队列压力` 之上
  - 作为一个单独 Surface，而不是 8 张顶层 MetricCard

这个面板只承担两件事：

1. 快速回答三侧资金活动今天是否正常展开。
2. 把用户引导到 `/finance` 做完整观察和调查。

### 2.3 Overview 推荐呈现方式

推荐做成 **1 个 Surface + 3 个责任面分组**：

1. `Consumer`
2. `Platform`
3. `Provider`

每个分组只展示 2 到 4 个最关键的今日指标，不放长说明，不放调查按钮，只放一个统一 CTA：

- `打开 Finance Desk`

这样 overview 仍然是分诊首页，但值班人员第一次打开页面，就能立刻知道“今天资金活动发生在哪一侧”。

---

## 3. 整体设计原则

完整的资金链路观测必须遵守下面 6 条原则：

1. **责任面先于金额面**：先按 Consumer / Platform / Provider / Treasury 切视角，再看金额。
2. **总账优先于局部差额**：局部偏差可以正常存在，但 Treasury absolute delta 必须优先判断。
3. **经营指标与调查指标分层**：`overview` 看经营摘要，`/finance` 看完整资金观测，`/finance/reconciliation` 看调查证据。
4. **后端提供语义，前端不发明语义**：所有今日收入、调用次数、Provider 收益等字段必须来自 `gateway-admin` 稳定 projection。
5. **金额与次数并存**：仅看金额无法判断活跃度，仅看次数无法判断商业质量，二者必须成对出现。
6. **新增字段必须可审计、可回放、可解释**：尤其是平台收入和 Provider 收益，必须有明确定义和聚合口径。

---

## 4. 资金链路的四层观测模型

建议把整个资金链路指标体系拆成四层。

### 4.1 第一层：Sentinel Layer

回答：**今天平台是否偏离安全经营状态。**

页面归属：`/dashboard/overview`

只包含：

- 当前值班结论
- 平台总账差额
- 待处理审批
- 必要时的充值异常 / 审计告警摘要

这一层不扩展成经营数据墙。

### 4.2 第二层：Capital Pulse Layer

回答：**今天三侧资金活动是什么样。**

页面归属：

- 摘要：`/dashboard/overview`
- 完整版：`/finance`

这是本次建议新增的核心层。

### 4.3 第三层：Treasury Control Layer

回答：**平台总账是否对齐，哪一侧负债或收入导致偏差。**

页面归属：`/finance`

包含：

- chain vault
- owner / consumer liability
- provider payable
- platform fee balance
- treasury signed difference
- treasury absolute delta

### 4.4 第四层：Reconciliation Investigation Layer

回答：**偏差到底从哪来、要处理什么 backlog。**

页面归属：`/finance/reconciliation`

包含：

- signed difference
- deposit repair backlog
- withdrawal review backlog
- priority approvals
- cross-locator evidence

---

## 5. 推荐新增的三侧展示卡片

下面是建议的第一版分面卡片。

## 5.1 Consumer 侧

目标：回答 **用户今天在平台里充了多少、花了多少、退了多少、用了多少次。**

推荐指标：

1. `今日用户充值`
   - canonical: `today_consumer_deposit_usdc`
   - 兼容 alias: `todayDepositUsdc`
   - 定义：统计窗口内已确认进入平台账本的 Consumer 充值金额

2. `今日用户消费`
   - canonical: `today_consumer_charge_usdc`
   - 兼容 alias: `todayChargeUsdc`
   - 定义：统计窗口内已计量确认的 Consumer usage 扣费金额

3. `今日用户退款`
   - canonical: `today_consumer_refund_usdc`
   - 兼容 alias: `todayRefundUsdc`
   - 定义：统计窗口内已确认的 Consumer refund 金额

4. `今日调用次数`
   - canonical: `today_invocation_count`
   - 定义：统计窗口内成功进入计费链路的 invocation 次数
   - 备注：这是当前后端缺失字段，需要新增 projection

### Consumer 侧的观测意义

- 充值高但消费低：可能代表资金沉淀、预充值活跃
- 消费高但充值低：可能代表在消耗既有余额
- 退款突然上升：可能代表服务质量问题、风控拒绝、误扣回滚
- 调用次数上升但消费金额平：可能代表低客单价服务增长

---

## 5.2 Platform 侧

目标：回答 **平台今天新增赚了多少，以及当前平台收入池处于什么状态。**

推荐指标：

1. `今日平台手续费收入`
   - canonical: `today_platform_fee_earned_usdc`
   - 定义：统计窗口内由 usage 结算新增记入平台收入池的手续费金额
   - 备注：当前后端缺失，需要新增 projection

2. `平台手续费余额`
   - canonical: `platform_fee_balance_usdc`
   - 现有字段：`platformFeeBalanceUsdc`
   - 定义：当前平台收入池累计余额

3. `平台 take rate`
   - canonical: `today_platform_take_rate_bps`
   - 定义：`today_platform_fee_earned_usdc / today_consumer_charge_usdc`
   - 备注：不是第一期必上，但很适合做二期经营观察

### Platform 侧的观测意义

- 今日平台手续费收入：看今天的新增商业结果
- 平台手续费余额：看当前累计可支配平台收入沉淀
- take rate：看平台分账策略是否按预期执行

---

## 5.3 Provider 侧

目标：回答 **Provider 今天赚了多少、提走了多少、为提现付出了多少成本。**

推荐指标：

1. `今日 Provider 新增收入`
   - canonical: `today_provider_earned_usdc`
   - 定义：统计窗口内由 usage 结算新增记入 Provider payable 的金额
   - 备注：当前后端缺失，需要新增 projection

2. `今日 Provider 提现金额`
   - canonical: `today_provider_withdrawal_usdc`
   - 兼容 alias: `todayWithdrawalUsdc`
   - 定义：统计窗口内已确认完成的 Provider withdrawal 金额

3. `今日 Provider 提现手续费`
   - canonical: `today_provider_withdrawal_fee_usdc`
   - 定义：统计窗口内 Provider 提现产生并已确认入账的手续费金额
   - 备注：如果当前提现模型并不存在单独 fee，就不要硬上这张卡；不能拿“提现金额”冒充“提现手续费”

4. `待处理 Provider 提现数`
   - canonical: `pending_provider_withdrawal_count`
   - 兼容 alias: `pendingWithdrawalCount`
   - 定义：当前仍在请求 / 广播 / 审核中的 Provider 提现单数量

### Provider 侧的观测意义

- Provider 新增收入上升：服务供给和消费结算正在放大
- 提现金额上升：Provider 端在把账上收益变成链上实出金
- 提现手续费上升：需要关注提现成本、批量出账策略、fee policy 是否合理
- 待处理提现数上升：说明审核或链上执行队列存在压力

---

## 6. 完整的资金链路观测指标地图

下面给出完整的推荐指标地图，按阶段组织。

## 6.1 Inflow：Consumer 入金

核心指标：

- `today_consumer_deposit_usdc`
- `pending_deposit_count`
- `chain_confirmed_not_ledger_confirmed_count`
- `deposit_p95_sync_delay_ms`

回答问题：

- 今天用户往平台充进来了多少钱
- 还有多少充值未完成入账
- 链上确认和账本确认之间是否堵塞

## 6.2 Usage：Consumer 消费与调用

核心指标：

- `today_consumer_charge_usdc`
- `today_invocation_count`
- `avg_revenue_per_invocation_usdc`
- `failed_billable_invocation_count`

回答问题：

- 今天真实发生了多少付费调用
- 调用增长是否转化成收入增长
- 是否存在计量失败或漏计费

## 6.3 Reverse Flow：Consumer 退款

核心指标：

- `today_consumer_refund_usdc`
- `pending_consumer_refund_count`
- `refund_rate_bps`
- `refundable_consumer_balance_usdc`

回答问题：

- 今天逆向流出有多大
- 当前退款 backlog 有多重
- 退款是业务正常波动还是异常信号

## 6.4 Revenue Split：Platform / Provider 收益分配

核心指标：

- `today_platform_fee_earned_usdc`
- `platform_fee_balance_usdc`
- `today_provider_earned_usdc`
- `provider_payable_usdc`
- `today_platform_take_rate_bps`

回答问题：

- 今天新增收入如何在平台和 Provider 之间分配
- 当前账本里待结算给 Provider 的池子有多大
- 平台收入沉淀是否符合抽成策略

## 6.5 Outflow：Provider 提现

核心指标：

- `today_provider_withdrawal_usdc`
- `today_provider_withdrawal_fee_usdc`
- `pending_provider_withdrawal_count`
- `provider_available_to_withdraw_usdc`
- `provider_locked_balance_usdc`

回答问题：

- 今天 Provider 端拿走了多少钱
- 提现成本是否可控
- 还有多少收益锁在队列里

## 6.6 Treasury：平台总账与链上金库

核心指标：

- `chain_vault_usdc`
- `consumer_liability_usdc`
- `provider_payable_usdc`
- `platform_fee_balance_usdc`
- `treasury_signed_difference_usdc`
- `treasury_absolute_delta_usdc`

回答问题：

- 链上资金能否覆盖平台当前三侧义务
- 平台是不是已经全局对齐
- 当前需要先看 Finance 还是直接进入 Reconciliation

## 6.7 Investigation / Pressure：调查与处置压力

核心指标：

- `deposit_exceptions`
- `pending_approvals`
- `audit_alerts`
- `recent_gateway_failures`
- `reconciliation_alert`
- `reconciliation_last_error`

回答问题：

- 偏差来自哪类 backlog
- 当前值班需要优先推哪个队列
- 异常是业务问题还是系统问题

---

## 7. 页面落位建议

## 7.1 `/dashboard/overview`

建议保留：

- 哨兵结论区
- 一个紧凑版 `资金链路摘要` Surface
- 今日流量 / 队列压力 / funnel 摘要

不建议放：

- Treasury 全量卡片
- Reconciliation 调查证据
- 过多经营趋势图
- 过多队列详情

### Overview 推荐结构

1. `当前值班结论`
2. `平台总账差额`
3. `待处理审批`
4. `资金链路摘要` Surface
5. `今日资金概览`
6. `今日关注重点`
7. `充值 / 消费 / 出账 funnel`

## 7.2 `/finance`

应成为 **完整资金观测主页面**。

推荐结构：

1. `Treasury Core`
2. `Capital Pulse by Consumer / Platform / Provider`
3. `Treasury Delta`
4. `Flow Volume & Invocation Trend`
5. `Operational Pressure`
6. `Related Approvals`

也就是说，完整的三侧卡片最好放在 `/finance`，overview 只放紧凑摘要版。

## 7.3 `/finance/reconciliation`

继续只做调查，不吸收经营摘要。

这里不新增“今日用户消费 / 今日平台收入 / 今日 Provider 收益”这种经营指标，避免页面再度混层。

---

## 8. 后端字段建议

当前已经存在或可直接复用的字段：

- `todayDepositUsdc`
- `todayChargeUsdc`
- `todayRefundUsdc`
- `todayWithdrawalUsdc`
- `platformFeeBalanceUsdc`
- `providerPayableUsdc`
- `pendingDepositCount`
- `pendingWithdrawalCount`
- `refundableConsumerBalanceUsdc`
- `providerAvailableToWithdrawUsdc`
- `providerLockedBalanceUsdc`

当前建议新增的字段：

1. `todayInvocationCount`
2. `todayPlatformFeeEarnedUsdc`
3. `todayProviderEarnedUsdc`
4. `todayProviderWithdrawalFeeUsdc`  
   说明：只有当后端真实有 fee 模型时才新增；若没有，不要伪造这个字段。
5. `pendingConsumerRefundCount`
6. `depositP95SyncDelayMs`
7. `chainConfirmedNotLedgerConfirmedCount`
8. `avgRevenuePerInvocationUsdc`

### 推荐 API 承载方式

建议优先在 `GET /api/admin/v1/dashboard/finance-overview` 上扩展，而不是让前端再拼一个新接口。

原因：

1. 这些字段都属于稳定资金读模型
2. 与 `/finance` 和 overview 的 `Capital Pulse` 同源最稳妥
3. 可以保持 `gateway-admin` 是语义提供者，前端只是展示层

### 命名建议

为了减少歧义，建议未来逐步补齐 canonical 字段：

- `todayConsumerDepositUsdc`
- `todayConsumerChargeUsdc`
- `todayConsumerRefundUsdc`
- `todayProviderWithdrawalUsdc`

同时保留旧 alias：

- `todayDepositUsdc`
- `todayChargeUsdc`
- `todayRefundUsdc`
- `todayWithdrawalUsdc`

这样 API 语义会更清楚，也更方便三侧面板直接使用。

---

## 9. UI 结构建议

## 9.1 Overview 上的摘要版

建议样式：

- 一个 SurfaceCard
- 三列栅格：`Consumer / Platform / Provider`
- 每列 2 到 4 条 mini metrics
- 每条展示：label + value + 微型 secondary text
- 统一页脚 CTA：`Open Finance Desk`

不建议：

- 用大号数值卡平铺 8 张
- 在 overview 上加入过长说明文字
- 加第二层复杂趋势图

## 9.2 Finance 上的完整版

建议样式：

- 标题：`Capital Pulse`
- 第一行：Consumer / Platform / Provider 三个主分组
- 第二行：`Treasury Core / Delta`
- 第三行：`Trend + Pressure`

视觉上遵守现有 `Synapse Sentinel` 基线：

- 不搞彩色 BI 大屏
- 用中性卡片承载金额
- 只把 tone 用在风险信号、异常增幅、delta 上

---

## 10. 分阶段落地建议

## Phase 1：文档与口径统一

目标：把三侧指标的名字、定义、归属和页面边界讲清楚。

交付物：

- 本文档
- `docs/admin` 索引更新

## Phase 2：后端读模型补字段

目标：让 `gateway-admin` 能稳定返回缺失字段。

优先级最高：

1. `todayInvocationCount`
2. `todayPlatformFeeEarnedUsdc`
3. `todayProviderEarnedUsdc`

有真实 fee 模型再做：

4. `todayProviderWithdrawalFeeUsdc`

## Phase 3：Overview 摘要 + Finance 完整版

目标：

- overview 上线 `Capital Pulse` 摘要版
- `/finance` 上线完整三侧资金观测区

## Phase 4：经营效率与异常率

目标：补齐更高阶指标，例如：

- take rate
- refund rate
- average revenue per invocation
- deposit sync delay
- provider payout efficiency

---

## 11. 最终建议

如果只回答一句话：

**这组卡片值得加，但应该以“资金链路摘要 Surface”进入 overview，以“完整三侧资金观测面板”进入 `/finance`；不要把 overview 重新做成第二个财务工作台。**

如果只回答实现优先级：

1. 先补文档和指标口径
2. 再补后端 projection 字段
3. 然后在 `/finance` 做完整版
4. 最后在 `overview` 放紧凑摘要版

这样做，资金链路就不再只是几块金额，而会成为一张真正能解释 `Consumer -> Platform -> Provider -> Treasury` 的观测地图。

---

## 12. 实现计划

下面给出按前端、后端、单元测试、数据库四条线拆开的可执行实现计划。

### 12.1 本轮增量已落下的数据库动作

为了让后续前后端接线有稳定投影可读，本轮先在 SQL projection 上补了三类可以由现有真相表和持久化 runtime state 稳定推导的字段：

1. `today_invocation_count`
2. `today_platform_fee_earned_usdc`
3. `today_provider_earned_usdc`

落点：

- `synapse_admin_dashboard_finance_projection`
- `synapse_admin_dashboard_activity_trend_projection`

并且同时补了一个增量 migration 文件：

- `docker-compose/postgres/init/gateway-admin/004_admin_funds_observability_projection_upgrade.sql`

这样新库 bootstrap 和已有库增量升级，都有明确 SQL 入口。

### 12.2 数据库实现计划

#### Phase A：Projection SQL

目标：先把后端需要的稳定读模型字段补出来。

本次应落地：

1. 在 `finance_projection` 中新增：
   - `today_invocation_count`
   - `today_platform_fee_earned_usdc`
   - `today_provider_earned_usdc`
2. 在 `activity_trend_projection` 中新增：
   - `invocation_count`
   - `platform_fee_earned_usdc`
   - `provider_earned_usdc`
3. `projected_at` freshness watermark 需要纳入 invocation billing projection 更新时间

实现方式：

1. 继续保持“gateway 真相表 + persisted runtime state -> admin projection view”的架构，不新增前端拼装逻辑
2. 通过 `synapse_invocations + synapse_runtime_state(invocation_billing::*)` 聚合调用次数、平台手续费、Provider 新增收入
3. 保持 canonical 字段命名，不新增旧 alias，避免把新语义再做旧包袱

#### Phase B：暂不落地的字段

下面这些字段当前不建议直接在 SQL 里硬推：

1. `today_provider_withdrawal_fee_usdc`
2. `refund_rate_bps`
3. `today_platform_take_rate_bps`
4. `avg_revenue_per_invocation_usdc`
5. `failed_billable_invocation_count`

原因：

1. 其中有些依赖提现 fee 真相字段，目前 SQL 和已确认文档里没有稳定列
2. 有些是派生率值，更适合放在后端 service 层算，避免 SQL view 变成公式墙

### 12.3 后端实现计划

目标：让 `gateway-admin` 把新增 projection 字段稳定暴露给 `admin-front`。

#### Step 1：Storage 层

修改：

- `admin/gateway-admin/src/storage/analytics/gateway_dashboard.py`

动作：

1. 扩展 `GatewayFinanceSnapshot`
   - `today_invocation_count`
   - `today_platform_fee_earned_usdc`
   - `today_provider_earned_usdc`
2. 扩展 `GatewayActivityTrendPoint`
   - `invocation_count`
   - `platform_fee_earned_usdc`
   - `provider_earned_usdc`
3. `PostgresGatewayDashboardProjectionRepository` 增加读取这些列的逻辑
4. `InMemoryGatewayDashboardProjectionRepository.seed_demo()` 同步补 demo 值，避免测试和本地 demo 断裂

#### Step 2：Service 层

修改：

- `admin/gateway-admin/src/services/dashboard/service.py`

动作：

1. `get_finance_overview()` 返回新增字段：
   - `todayInvocationCount`
   - `todayPlatformFeeEarnedUsdc`
   - `todayProviderEarnedUsdc`
2. `get_activity_trends()` 返回新增字段：
   - `invocationCount`
   - `platformFeeEarnedUsdc`
   - `providerEarnedUsdc`
3. 保持语义来源完全来自 projection，不在 service 里额外猜值

#### Step 3：Schema 层

修改：

- `admin/gateway-admin/src/api/schemas/dashboard.py`

动作：

1. 扩展 `FinanceOverview`
2. 扩展 `ActivityTrendPoint`
3. 保持 alias 显式，避免 contract 漂移

#### Step 4：API Contract 文档

修改：

- `docs/admin/Admin_API_Contract_Phase1.md`

动作：

1. 更新 `GET /api/admin/v1/dashboard/finance-overview` 返回示例
2. 更新 `GET /api/admin/v1/dashboard/activity-trends` 返回示例
3. 写清楚这三个字段的来源：
   - `synapse_invocations`
   - `synapse_runtime_state(invocation_billing::*)`

### 12.4 前端实现计划

目标：先在 `/finance` 上线完整版，再把摘要压缩到 `overview`。

#### Phase 1：Finance 完整版

修改：

- `admin/admin-front/src/features/finance/finance-presenters.ts`
- `admin/admin-front/src/features/finance/finance-glossary.ts`
- `admin/admin-front/src/app/finance/page.tsx`

动作：

1. 新增 `Capital Pulse` presenter 组装逻辑
2. 按三列输出：
   - Consumer
   - Platform
   - Provider
3. 第一版建议展示：
   - Consumer：今日充值、今日消费、今日退款、今日调用次数
   - Platform：今日平台手续费收入、平台手续费余额
   - Provider：今日新增收入、今日提现金额、待处理提现数
4. `今日 Provider 提现手续费` 暂不在 UI 落，直到后端有真实字段

#### Phase 2：Overview 摘要版

修改：

- `admin/admin-front/src/features/dashboard/dashboard-presenters.ts`
- `admin/admin-front/src/features/dashboard/dashboard-surfaces.tsx`
- `admin/admin-front/src/features/dashboard/dashboard-overview-screen.tsx`

动作：

1. 增加一个 `Capital Pulse / 资金链路摘要` Surface
2. 不新增顶层哨兵卡
3. 摘要版每侧只保留最关键的 2 到 3 条指标
4. 统一 CTA 跳转 `/finance`

### 12.5 单元测试实现计划

目标：保证 contract、presenter、projection 三层同时可回归。

#### 后端测试

修改：

- `admin/gateway-admin/tests/test_app.py`
- 若已有更细 dashboard 测试文件，也应同步补充

至少新增断言：

1. `finance-overview` 返回新增字段
2. `activity-trends` 每个 point 返回新增字段
3. 空 projection 场景下字段回退到 `0 / 0.00`
4. 老 alias 不受影响

#### 前端测试

修改：

- `admin/admin-front/src/features/finance/*`
- `admin/admin-front/src/features/dashboard/*`

至少新增断言：

1. `/finance` 三侧面板渲染正确
2. overview 摘要面板不挤占顶层哨兵区
3. 字段缺失时显示降级文案或 `待接线`

### 12.6 发布顺序

建议按下面顺序执行：

1. 数据库：先发 projection SQL
2. 后端：再扩展 schema / service / contract
3. 后端测试：确保 `finance-overview` 和 `activity-trends` 已稳定
4. 前端：先上 `/finance` 完整版
5. 前端：最后把摘要版压缩进 `overview`

这样可以避免前端先写死字段，反过来逼后端兜底。

### 12.7 验证清单

数据库层：

1. 新增 SQL migration 可重复执行
2. projection view 能成功 `SELECT`
3. 新列在空数据场景下回退为 0，不返回 `NULL` 风暴

后端层：

1. `pytest tests/test_app.py -q`
2. API 返回新增字段且 alias 正确

前端层：

1. `npm run lint`
2. `npm run test`
3. `npm run build`