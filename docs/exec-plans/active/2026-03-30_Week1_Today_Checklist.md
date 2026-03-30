# Week 1 Today Checklist

## 0. Metadata

- Status: active
- Owner: Alex / Synapse founding team
- Date: 2026-03-30
- Related systems: `Synapse-Network`, `Agents-Memory`, `Spec2Flow`
- Related docs:
  - `docs/exec-plans/active/2026-03-30_Malaysia_AI_Event_and_Portfolio_GTM_Plan.md`
  - `docs/exec-plans/active/2026-03-30_Synapse_12_Week_Execution_Plan.md`
  - `docs/exec-plans/active/2026-03-30_Synapse_Execution_Boards.md`

## 1. Background

Week 1 的目标已经明确：

1. 建立统一 portfolio board
2. 完成 Synapse 当前状态审计
3. 锁定 12 周 scoreboard 与角色帽子

这份文档只做一件事：

**把这三个目标压成今天就能完成的 checklist。**

## 2. Goal

在今天收工前产出 5 个能看得见的东西：

1. 一份 portfolio board 骨架
2. 一份 readiness gap list
3. 一份 event action list
4. 一份 owner hats and time budget 表
5. 一份明天开工的 top 3 列表

## 3. Non-Goals

1. 今天不做深工程实现。
2. 今天不展开 FutureX 之后的融资流程细节。
3. 今天不做 Week 2 之后的功能交付。
4. 今天不再写新战略长文。

## 4. Scope

今天只处理四类动作：

1. 看板搭建
2. 现状审计
3. 活动和融资台账初始化
4. 人员与时间分配收口

## 5. Prerequisite Reading

1. `docs/exec-plans/active/2026-03-30_Synapse_12_Week_Execution_Plan.md`
2. `docs/exec-plans/active/2026-03-30_Synapse_Execution_Boards.md`

## 6. Implementation Steps

### 6.1 Morning Checklist

- [ ] 建一个统一 portfolio board
  - 产物：四条 lane `Product / Fundraising / Events / Staffing`
  - 验收：每条 lane 都有 `Now / Next / Blocked / Watch / Done`
- [ ] 写 owner hats
  - 产物：`Founder/CEO`, `Founder/CTO`, `Product/Design`, `GTM/Ops`
  - 验收：每条 lane 都指定 owner hat
- [ ] 写 weekly time budget
  - 产物：`Synapse 70%-80%`, `Agents-Memory 10%-15%`, `Spec2Flow 10%-15%`
  - 验收：明确本周不得突破的带宽护栏

### 6.2 Midday Checklist

- [ ] 审计公网环境现状
  - 产物：一张环境状态表
  - 必填字段：`frontend`, `gateway`, `provider_service`, `database`, `contract`, `domain`, `testnet`
  - 验收：每一项都标记 `ready / partial / missing`
- [ ] 审计 Provider 货架现状
  - 产物：一张服务状态表
  - 必填服务：`web3 sentiment`, `smart contract audit`, `whale-flow monitor`
  - 验收：每个服务都标记 `discover`, `invoke`, `pricing`, `demo response`
- [ ] 审计 SDK / MCP / Demo 现状
  - 产物：一张 readiness 表
  - 必填项：`Python SDK Quickstart`, `MCP skeleton`, `Hero Demo script`, `three-role isolation`, `demo video`
  - 验收：每一项都标记 `ready / partial / missing`

### 6.3 Afternoon Checklist

- [ ] 建活动 action list
  - 产物：三场活动跟进表
  - 必填活动：`FutureX Ventures Fest 2026`, `PDX2026`, `AIMX 2026`
  - 必填字段：`报名状态`, `门票/赞助`, `演讲申请`, `目标对象`, `下一动作`, `截止日期`
  - 验收：每场活动都至少有一个 next action
- [ ] 建投资人主名单骨架
  - 产物：一张 investor sheet
  - 必填字段：`基金/机构`, `类型`, `地区`, `联系人`, `warm intro source`, `状态`, `下一动作`
  - 验收：先放入第一批 15 个目标，而不是等 50 个全齐才开表
- [ ] 写三套 pitch 骨架
  - 产物：`30 秒`, `5 分钟`, `15 分钟`
  - 验收：每套都能回答 `problem / solution / why now / demo / ask`

### 6.4 End-of-Day Checklist

- [ ] 形成 readiness gap list
  - 产物：一页 gap list
  - 必须分成：`P0 this week`, `P1 next two weeks`, `not now`
  - 验收：不超过 10 条，必须能排序
- [ ] 更新四看板的 `Now`
  - 产物：四张板每张最多 3 张 `Now` 卡
  - 验收：没有 owner hat 同时背超过 3 张 `Now` 卡
- [ ] 写明天 top 3
  - 产物：明天唯一最重要的 3 个动作
  - 验收：每个动作都对应今天产出的 gap list

## 7. Definition Of Done For Today

今天收工前，必须看到以下 5 个可验证产物：

1. `portfolio board`
2. `owner hats and time budget`
3. `readiness gap list`
4. `event action list`
5. `investor sheet V0`

如果今天只做了一堆讨论，没有留下这 5 个东西，就等于今天没打穿。

## 8. Do Not Do Today

1. 不要今天就写完整 deck。
2. 不要今天就做 MCP 全实现。
3. 不要今天就做多链和多币种扩张。
4. 不要今天被 `Agents-Memory` 和 `Spec2Flow` 吸走主线时间。

## 9. Decision Log

### 2026-03-30

- Decision: 把 Week 1 的 `Now` 卡片压缩成单日 checklist。
- Reason: 需要把战略落成今天就能执行的动作，不然容易继续停留在规划状态。
- Rejected alternatives:
  - 继续只看 12 周计划
  - 继续只看四张看板

## 10. Validation Log

### 2026-03-30

- Command or check: 承接 Week 1 的目标与四看板 `Now` 卡片
- Result: 已生成当日执行 checklist
- Follow-up: 明天可继续拆 `Week 1 Day 2` checklist

## 11. Completion Notes

这份文档就是今天的清单，不是长期文档博物馆。

今天打完这 5 个产物，Week 1 才算真正起飞。
