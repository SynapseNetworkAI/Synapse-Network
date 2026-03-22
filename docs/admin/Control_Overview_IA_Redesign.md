# 控制总览 IA 重构设计

本文只回答一个问题：`控制总览` 下面的 `概览 / 运行态 / 系统健康 / 执行队列 / 系统运维` 是否存在职责重复，如果存在，应该如何重构成互不重叠的模块。

结论先行：**当前存在明显重复，尤其是 `dashboard/runtime`、`dashboard/health`、`/execution`、`/system` 四个面之间的边界不干净。需要把 `控制总览` 收敛成“值班分诊入口”，而不是多个相似运行态页面的并列堆叠。**

## 1. 当前重复点审计

### 1.1 `概览` 与其他模块的关系

当前 `概览` 的定位相对清晰：

- 全局哨兵摘要
- 今日流量摘要
- 队列压力摘要
- funnel 摘要

它的问题不大，关键是**不能再继续吸收 runtime、diagnostics、execution 明细**。

### 1.2 `运行态` 与 `/system` 的重复

当前 `dashboard/runtime` 包含：

- operations posture
- runtime snapshot
- projection marker
- threat stream

当前 `/system` 包含：

- system metrics
- runtime snapshot
- diagnostics
- reconciliation last error

重复点：

- 两边都在展示 runtime snapshot
- 两边都在展示 operations 状态
- 两边都把 reconciliation / gateway / indexer 这些系统运行信号拉进来

结果：

- 用户难以判断“运行态”和“系统运维”谁是主入口
- 页面之间只是同一批数据的不同排版，不是职责分工

### 1.3 `系统健康` 与 `/system` 的重复

当前 `dashboard/health` 包含：

- diagnostics
- operations posture
- projection marker

而 `/system` 也包含：

- diagnostics
- runtime cards
- failure counters
- reconciliation error

重复点更直接：

- 两边都在讲 health verdict
- 两边都在讲 diagnostics
- 两边都在讲系统健康状态解释

结果：

- `系统健康` 更像 `/system` 的浅拷贝版
- 两个页面缺少“摘要页”和“明细页”的明确上下游关系

### 1.4 `运行态` 与 `/execution` 的重复

当前 `dashboard/runtime` 的描述里包含：

- 执行队列
- 异常流
- 运行节点

而 `/execution` 本身是：

- execution jobs
- attempts
- retry
- failure clusters
- target system 分布

重复风险：

- 一旦 `运行态` 开始继续展示更多 queue 或 job 信息，就会和 `/execution` 冲突
- `运行态` 应该只告诉值班人员“哪条链路堵了”，不应该变成任务工作台

## 2. 重构原则

控制总览必须遵守下面 4 条原则：

1. `控制总览` 是值班分诊入口，不是第二个系统运维中心。
2. 每个子模块只回答一种问题，不允许两个页面回答同一个问题。
3. 摘要页只给决策方向，不承载深度调查和执行动作。
4. 深度调查、重试、补偿、诊断必须进入专门工作台。

## 3. 重构后的目标结构

建议把 `控制总览` 重新定义为下面 5 个独立模块：

1. `概览`
2. `业务运行态`
3. `系统健康摘要`
4. `执行队列`
5. `系统运维中心`

其中前 3 个属于 `控制总览` 子菜单，后 2 个继续作为同层独立页面。

## 4. 目标职责边界

### 4.1 `概览`

只回答：**今天平台整体是否偏离正常经营状态，值班人员下一步应该看哪个工作台。**

允许放：

- Control plane status
- Pending approvals
- Today deposit / charge / refund / withdrawal
- Pending deposits / withdrawals
- Deposit exceptions
- Audit alerts
- Deposit / Billing / Outflow funnel summary

禁止放：

- execution job 列表
- runtime 明细卡
- diagnostics 详细信号列表
- reconciliation error 原文
- 系统组件级 last processed / last scan / block 等字段

一句话定义：

**概览 = 值班首页，负责把人分流出去。**

### 4.2 `业务运行态`

只回答：**当前哪条业务链路在堵塞，堵塞发生在审批、充值还是出账。**

允许放：

- Approval lane status
- Deposit lane status
- Outflow lane status
- Threat stream / hot approval stream
- Queue pressure by workflow lane
- 只保留 lane 级别的状态摘要与升级建议

禁止放：

- indexer last processed
- backfill last scan
- gateway admin availability
- execution attempts / retry buttons
- diagnostics 全量信号卡

一句话定义：

**业务运行态 = 业务工作流链路是否顺畅。**

它关心的是 workflow health，不是 infrastructure health。

### 4.3 `系统健康摘要`

只回答：**系统层是否健康，是否需要进入系统运维中心。**

允许放：

- overall diagnostics verdict
- Top 3 critical signals
- gateway / admin / reconciliation 摘要状态
- last checked / projection timestamp
- Open system center 动作

禁止放：

- runtime workflow lane 状态
- hot approvals / threat stream
- execution queue hot jobs
- 详细 runtime cards
- 深度运维调查内容

一句话定义：

**系统健康摘要 = 系统级红绿灯。**

它是 `/system` 的摘要入口，不是 `/system` 的简化副本。

### 4.4 `执行队列`

只回答：**哪些受控命令执行失败、能不能重试、谁在 retry。**

允许放：

- jobs 列表
- attempts
- retry
- failure clusters
- target system 分布

禁止放：

- 全局 health verdict
- workflow lane summary
- business KPI summary

一句话定义：

**执行队列 = command execution workbench。**

### 4.5 `系统运维中心`

只回答：**系统组件为什么不健康，具体需要排查哪一个组件、哪一个时间点、哪一条错误。**

允许放：

- diagnostics full view
- runtime snapshot details
- indexer / backfill / reconciliation detail
- failure counters
- reconciliation last error
- system parameter snapshots
- future drilldown / runbook links

禁止放：

- business funnel summary
- hot approval stream
- finance summary cards
- execution retry controls

一句话定义：

**系统运维中心 = system investigation center。**

## 5. 新的去重矩阵

### 5.1 按问题归属

| 用户问题 | 唯一归属页面 |
| --- | --- |
| 今天平台总体有无异常，需要先看哪里 | 概览 |
| 哪条业务工作流堵塞了 | 业务运行态 |
| 系统层是否退化 | 系统健康摘要 |
| 哪个执行任务失败了、是否可重试 | 执行队列 |
| 为什么系统退化、具体哪个组件出问题 | 系统运维中心 |

### 5.2 按数据归属

| 数据/组件 | 唯一主页面 |
| --- | --- |
| Today flow summary | 概览 |
| Funnel summary | 概览 |
| Workflow lane status | 业务运行态 |
| Threat stream | 业务运行态 |
| Diagnostics verdict | 系统健康摘要 |
| Diagnostics full signals/actions | 系统运维中心 |
| Runtime cards | 系统运维中心 |
| Execution jobs / retry | 执行队列 |

## 6. 对当前页面的具体改造建议

### 6.1 `dashboard/overview`

保留，作为 `概览` 页面。

### 6.2 `dashboard/runtime`

重命名语义为 `业务运行态`，并做减法：

- 删除 `DashboardRuntimeSnapshotSurface`
- 删除 `DashboardOperationsStatusSurface`
- 删除 projection marker
- 删除任何 system component 级别卡片
- 保留 workflow lane summary 与 threat stream
- 如果需要看 execution 明细，只给跳转按钮去 `/execution`

### 6.3 `dashboard/health`

收敛成真正的 `系统健康摘要`：

- 只保留 diagnostics summary
- 只保留 top critical signals
- 只保留 gateway / admin / reconciliation 级摘要卡
- 只保留 `Open system center`
- 删除 operations posture 大块卡片
- 删除 projection marker 重复解释

### 6.4 `/system`

升级为唯一的系统调查中心：

- 承担 runtime snapshot 明细
- 承担 reconciliation last error
- 承担 diagnostics full list
- 后续接 runbook / drilldown

### 6.5 `/execution`

保持独立，不再让 `dashboard/runtime` 去复刻 queue 视图。

## 7. 推荐菜单文案

建议把 `控制总览` 下的子菜单文案改成下面这版，语义更独立：

1. `概览`
2. `业务运行态`
3. `系统健康`

说明：

- 第二项明确加上“业务”二字，避免和 `/system` 混淆
- 第三项保留“系统健康”，但产品定义是健康摘要，不是运维明细中心

## 8. 最终建议

`控制总览` 不应该继续长成 3 个长得很像的运行态页面。

正确的设计应该是：

1. `概览` 负责分诊
2. `业务运行态` 负责 workflow health
3. `系统健康` 负责 system verdict
4. `/execution` 负责 command execution
5. `/system` 负责 system investigation

只有这样，值班人员才不会在“运行态 / 系统健康 / 系统运维”之间来回横跳，却始终不知道哪个页面才是主入口。