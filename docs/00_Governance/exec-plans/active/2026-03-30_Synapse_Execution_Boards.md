# Synapse Execution Boards

## 0. Metadata

- Status: active
- Owner: Alex / Synapse founding team
- Date: 2026-03-30
- Related systems: `Synapse-Network`, `Agents-Memory`, `Spec2Flow`
- Related docs:
  - `docs/exec-plans/active/2026-03-30_Malaysia_AI_Event_and_Portfolio_GTM_Plan.md`
  - `docs/exec-plans/active/2026-03-30_Synapse_12_Week_Execution_Plan.md`
  - `docs/exec-plans/active/2026-03-30_Week1_Today_Checklist.md`
  - `docs/01_Product_Vision/MVP.md`
  - `docs/01_Product_Vision/ROADMAP.md`
  - `docs/01_Product_Vision/Business_Plan.md`
  - `docs/01_Product_Vision/Pitch_Deck_Material.md`

## 1. Background

总计划已经明确战略方向，12 周计划已经明确周节奏。现在还缺一层真正适合周会、复盘和 daily execution 的控制面。

这份文档把未来 12 周的工作压缩成四张执行看板：

1. 产品看板
2. 融资看板
3. 活动看板
4. 人员安排看板

目的不是增加管理动作，而是把最重要的事情可视化，避免：

1. 团队每周不知道最重要的 3 件事是什么
2. 线索、活动、招聘和产品各自为战
3. `Agents-Memory` 和 `Spec2Flow` 无节制抢走主线带宽

## 2. Goal

把 12 周计划转化成四张可操作执行板，让团队可以在每周固定节奏下完成：

1. 同步优先级
2. 跟踪阻塞
3. 判断资源分配
4. 明确谁负责推进
5. 明确什么算完成

## 3. Non-Goals

1. 不替代 issue tracker 或 PR 列表。
2. 不替代更细的功能技术设计。
3. 不把四张板子做成庞大的 PMO 文档。
4. 不要求所有事项都写得像 Jira ticket。

## 4. Scope

这份文档只覆盖：

1. 未来 12 周的高优先级执行事项
2. 四张板子的泳道定义
3. 每张板子的 owner hat 和验收口径
4. 周会使用规则

## 5. Prerequisite Reading

1. `docs/exec-plans/active/2026-03-30_Malaysia_AI_Event_and_Portfolio_GTM_Plan.md`
2. `docs/exec-plans/active/2026-03-30_Synapse_12_Week_Execution_Plan.md`
3. `docs/AGENTS.md`
4. `docs/ARCHITECTURE.md`

## 6. Implementation Steps

### 6.1 Board Operating Rule

每张板统一使用五列：

1. `Now`
   - 本周必须推进
2. `Next`
   - 下周大概率进入
3. `Blocked`
   - 当前卡住，必须写清 blocker
4. `Watch`
   - 还不该全力开工，但需要盯着
5. `Done`
   - 已经完成，等待周复盘归档

统一规则：

1. 任何卡片必须有 owner hat
2. 任何 `Blocked` 卡片必须有 unblock action
3. 任何 `Done` 卡片必须有可验证产物
4. 一个 owner hat 同时处于 `Now` 的卡片不超过 3 张

### 6.2 Product Board

#### Goal

把 Synapse 从“技术可跑”推进到“可演示、可接入、可成交”。

#### Owner hats

1. Founder / CTO hat
2. Product / Design hat
3. Full-stack contractor hat if available

#### Success metrics

1. 公网 demo 环境在线
2. 可卖 Provider 服务数 >= 3
3. Hero Demo 成功率 >= 90%
4. Python SDK Quickstart 可稳定跑通
5. MCP MVP 可稳定演示

#### Board

`Now`

1. 公网测试环境审计与部署方案定稿
   - Owner hat: Founder / CTO
   - Exit: 前端、网关、Provider、数据库、测试网 mapping 明确
2. 三个样板服务收口
   - Owner hat: Founder / CTO
   - Exit: `web3 sentiment`、`smart contract audit`、`whale-flow monitor` 都可 discover 和 invoke
3. Hero Demo 剧本与 runbook
   - Owner hat: Product / Design
   - Exit: 三角色演示脚本定稿，可 3 分钟内跑完

`Next`

1. Python SDK Quickstart 打磨
   - Owner hat: Founder / CTO
   - Exit: 外部开发者 5 分钟内可跑通
2. MCP MVP
   - Owner hat: Founder / CTO
   - Exit: 支持 `discover`, `quote`, `invoke`, `balance`
3. 开发者 one-pager
   - Owner hat: Product / Design
   - Exit: 可对外发送

`Blocked`

1. 真实公网演示环境依赖云资源和部署时间
   - Owner hat: Founder / CTO
   - Unblock: 确认环境、域名、部署脚本
2. MCP 交付依赖当前代码骨架确认
   - Owner hat: Founder / CTO
   - Unblock: Week 1 完成 readiness audit

`Watch`

1. TypeScript SDK / tool wrapper
   - Owner hat: Founder / CTO
   - Trigger: Python SDK 和 MCP MVP 稳定后再开
2. 更漂亮的 usage analytics
   - Owner hat: Product / Design
   - Trigger: 有真实使用数据后再深做

`Done`

1. 基础架构、结算、账本、审计、提现主线已具备文档和系统骨架
   - Owner hat: Synapse team
   - Evidence: 现有 GTM 总计划与项目文档

### 6.3 Fundraising Board

#### Goal

把投资人接触从临场聊天，变成一个可复制的 fundraising pipeline。

#### Owner hats

1. Founder / CEO hat
2. Founder / CTO hat
3. GTM / Ops hat

#### Success metrics

1. 目标投资人名单 >= 50
2. warm intros 数量持续增长
3. 已完成 first meeting 数量
4. 已进入 second meeting 数量
5. data room 材料完整度

#### Board

`Now`

1. 建投资人主名单
   - Owner hat: Founder / CEO
   - Exit: 至少 50 家，A/B/C 分层
2. 统一 30 秒、5 分钟、15 分钟三套 pitch
   - Owner hat: Founder / CEO
   - Exit: 有标准脚本
3. data room V1 清单
   - Owner hat: GTM / Ops
   - Exit: deck、one-pager、demo video、架构图、traction snapshot 目录齐

`Next`

1. FutureX 前会面安排
   - Owner hat: Founder / CEO
   - Exit: 8 到 12 个目标对象被预约或触达
2. deck V1
   - Owner hat: Product / Design
   - Exit: 10 页以内，能解释 why now / problem / solution / demo / market / moat / traction / ask
3. demo video V1
   - Owner hat: Product / Design
   - Exit: 可发链接版本完成

`Blocked`

1. traction 证据还不够强
   - Owner hat: Founder / CTO
   - Unblock: Week 8 到 Week 10 累积真实调用数据
2. 强投资人对话依赖 product readiness
   - Owner hat: Founder / CEO
   - Unblock: Hero Demo 与 SDK/MCP 先到位

`Watch`

1. term sheet 预期和估值区间
   - Owner hat: Founder / CEO
   - Trigger: 出现第二轮深聊后再重点处理
2. 更正式的财务模型
   - Owner hat: GTM / Ops
   - Trigger: 有初始试点和价格反馈后再加细

`Done`

1. 融资主叙事已完成收口
   - Owner hat: Founding team
   - Evidence: GTM 总计划中的 investor narrative 和 8 周 fundraising motion

### 6.4 Events Board

#### Goal

让活动成为“拿客户、拿投资人、拿伙伴”的工具，而不是无效打卡。

#### Owner hats

1. Founder / CEO hat
2. GTM / Ops hat
3. Product / Design hat

#### Success metrics

1. 每场活动的目标名单数
2. 已预约会议数
3. 会后 72 小时内跟进完成率
4. 转化到 investor / partner / customer pipeline 的数量

#### Board

`Now`

1. 确认 `FutureX Ventures Fest 2026`、`PDX2026`、`AIMX 2026` 的报名和时间线
   - Owner hat: GTM / Ops
   - Exit: 每场活动的报名、差旅、门票、赞助、演讲窗口已登记
2. 为每场活动定义目标
   - Owner hat: Founder / CEO
   - Exit: 清楚区分 investor / provider / enterprise 三类目标
3. 建会前名单和会后跟进模板
   - Owner hat: GTM / Ops
   - Exit: 有固定 outreach 和 follow-up 模板

`Next`

1. FutureX 会面排程
   - Owner hat: Founder / CEO
   - Exit: 活动前形成日程表
2. PDX 企业版话术
   - Owner hat: Product / Design
   - Exit: 偏企业数字化的版本完成
3. AIMX booth / 演示策略
   - Owner hat: Founder / CEO
   - Exit: 明确是 booth、会议密集型，还是只做高质量约见

`Blocked`

1. 活动 material 依赖 deck 和 demo 完成
   - Owner hat: Product / Design
   - Unblock: 先完成 Hero Demo 和 deck V1
2. 活动转化依赖 CRM discipline
   - Owner hat: GTM / Ops
   - Unblock: 固定 Friday update ritual

`Watch`

1. `SAMENTA AI Fest 2026`
   - Owner hat: Founder / CEO
   - Trigger: 若需要本地 SME Provider 和渠道线索再追加
2. MDEC 关系补建
   - Owner hat: Founder / CEO
   - Trigger: 在 FutureX 之后推进更合适

`Done`

1. 2026 马来西亚重点活动优先级已明确
   - Owner hat: Founding team
   - Evidence: GTM 总计划中的 event prioritization

### 6.5 Staffing Board

#### Goal

用最少的人，撑住产品、融资、活动三条线，不让创始团队被杂事拖死。

#### Owner hats

1. Founder / CEO hat
2. Founder / CTO hat
3. GTM / Ops hat

#### Success metrics

1. 创始人每周 maker time 是否被保护
2. 是否有明确 owner 负责四大 lane
3. 外包或 contractor 是否补到关键短板
4. 每周是否完成资源分配复盘

#### Board

`Now`

1. 锁定四个 owner hats
   - Owner hat: Founding team
   - Exit: Product, Fundraising, Events, Ops 都有人扛
2. 建立每周时间预算
   - Owner hat: Founder / CEO
   - Exit: `Synapse 70%-80%`、`Agents-Memory 10%-15%`、`Spec2Flow 10%-15%`
3. 确认第一批外部支持角色缺口
   - Owner hat: Founder / CEO
   - Exit: 明确是否需要 contractor / design / solution engineer

`Next`

1. 找全栈 contractor
   - Owner hat: Founder / CTO
   - Exit: 能接 SDK / MCP / frontend onboarding
2. 找设计 / 内容外包
   - Owner hat: Founder / CEO
   - Exit: 能接 deck、官网、视频包装
3. 建立周例会模板
   - Owner hat: GTM / Ops
   - Exit: 周一定目标，周五做复盘

`Blocked`

1. 创始人戴太多帽子，容易出现高频切换损耗
   - Owner hat: Founding team
   - Unblock: 尽快把设计包装和部分前端接给外部支持
2. 侧翼项目容易蚕食主线注意力
   - Owner hat: Founder / CEO
   - Unblock: 每周审查投入占比

`Watch`

1. 是否需要独立 PMO / operating repo
   - Owner hat: Founder / CEO
   - Trigger: 只有当团队人数和并行项目复杂度显著上升时再考虑
2. 是否需要专职 GTM / BD
   - Owner hat: Founder / CEO
   - Trigger: 当 investor / partner / customer pipeline 同时升温时再补

`Done`

1. 当前“不新建第四个外部产品，只建立组合管理层”的原则已经明确
   - Owner hat: Founding team
   - Evidence: GTM 总计划中的 decision log

### 6.6 Weekly Meeting Script

每周会只问 8 个问题：

1. 产品板 `Now` 的 3 张卡本周是否推进了
2. 哪张卡进入 `Blocked`
3. 哪张卡可以进 `Done`
4. 融资板有没有新增 warm intro 和 follow-up
5. 活动板有没有新增预约和会后转化
6. 人员板有没有新的带宽问题
7. 本周是否有人被侧翼任务吸血
8. 下周四张板各自最重要的一张 `Now` 卡是什么

## 7. Acceptance Criteria

1. 已将 12 周计划拆成 `产品 / 融资 / 活动 / 人员安排` 四张执行看板。
2. 每张看板都有 goal、owner hats、success metrics 和 board 状态。
3. 每张板都能直接用于周会和执行复盘。
4. 文档与现有 GTM 总计划和 12 周计划完成回链。

## 8. Risks And Rollback

1. 风险：看板写太多，执行反而更慢。
   - 应对：所有板子都只保留高价值事项，不做 ticket 海洋。
2. 风险：四张看板变成四个孤岛。
   - 应对：统一用每周 8 问脚本联动。
3. 风险：`Done` 没有证据，造成假进度。
   - 应对：任何完成项必须带 evidence。

## 9. Decision Log

### 2026-03-30

- Decision: 在总计划和 12 周计划之下，再增加四看板执行层。
- Reason: 当前最需要的是执行控制面，而不是更多概念描述。
- Rejected alternatives:
  - 继续只用长文档推进
  - 直接跳到 issue 海洋

## 10. Validation Log

### 2026-03-30

- Command or check: 承接 `2026-03-30_Malaysia_AI_Event_and_Portfolio_GTM_Plan.md` 与 `2026-03-30_Synapse_12_Week_Execution_Plan.md`
- Result: 已拆成四张看板，覆盖 product, fundraising, events, staffing 四条执行面
- Follow-up: 后续可继续拆到 GitHub Projects / Notion / Linear

## 11. Completion Notes

这份文档最适合拿来做每周 operating review。

推荐用法：

1. 总计划决定方向
2. 12 周计划决定节奏
3. 四看板决定本周谁干什么、卡在哪里、什么时候算打穿
4. `2026-03-30_Week1_Today_Checklist.md` 负责把 Week 1 压成今天就能执行的动作
