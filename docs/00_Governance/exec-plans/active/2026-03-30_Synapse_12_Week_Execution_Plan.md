# Synapse 12-Week Execution Plan

## 0. Metadata

- Status: active
- Owner: Alex / Synapse founding team
- Date: 2026-03-30
- Related systems: `Synapse-Network`, `Agents-Memory`, `Spec2Flow`
- Related docs:
  - `docs/exec-plans/active/2026-03-30_Malaysia_AI_Event_and_Portfolio_GTM_Plan.md`
  - `docs/exec-plans/active/2026-03-30_Synapse_Execution_Boards.md`
  - `docs/exec-plans/active/2026-03-30_Week1_Today_Checklist.md`
  - `docs/01_Product_Vision/MVP.md`
  - `docs/01_Product_Vision/ROADMAP.md`
  - `docs/01_Product_Vision/Business_Plan.md`
  - `docs/01_Product_Vision/Pitch_Deck_Material.md`
  - `docs/03_Projects/gateway/README.md`
  - `docs/03_Projects/provider-service/README.md`
  - `docs/03_Projects/sdk-python/README.md`

## 1. Background

`2026-03-30_Malaysia_AI_Event_and_Portfolio_GTM_Plan.md` 已经明确三件事：

1. `Synapse-Network` 是 2026 年唯一主线。
2. 目标不是继续扩产品线，而是把 Synapse 打造成可演示、可接入、可成交、可融资的基础设施项目。
3. 2026 年 5 月到 8 月的活动窗口已经明确，尤其是 `FutureX Ventures Fest 2026` 与 `AIMX 2026`。

接下来需要把战略话术压缩成每周可执行动作，避免团队掉进“看起来很忙，但没有一周一周打穿关键节点”的陷阱。

## 2. Goal

在未来 12 周内完成以下结果：

1. 让 Synapse 具备稳定公网测试环境。
2. 让 Hero Demo 进入可对外反复展示状态。
3. 让 Python SDK 与 MCP MVP 达到可接入水位。
4. 让 Provider 货架与真实调用数据足够支撑融资叙事。
5. 让活动参会和投资人推进进入有节奏的 pipeline。

## 3. Non-Goals

1. 不把 12 周拆成过细的日程管理。
2. 不在本计划中展开每个功能点的工程任务清单。
3. 不扩大 `Agents-Memory` 和 `Spec2Flow` 的对外商业化范围。
4. 不引入第四个外部产品。

## 4. Scope

本计划覆盖四条周节奏主线：

1. Product and infrastructure
2. SDK and MCP delivery
3. GTM, events, and design partners
4. Investor pipeline and data room

## 5. Prerequisite Reading

1. `docs/exec-plans/active/2026-03-30_Malaysia_AI_Event_and_Portfolio_GTM_Plan.md`
2. `docs/AGENTS.md`
3. `docs/ARCHITECTURE.md`
4. `docs/01_Product_Vision/MVP.md`
5. `docs/03_Projects/README.md`

## 6. Implementation Steps

### 6.1 Operating Rhythm

固定周节奏：

1. Monday
   - 更新周目标
   - 锁定本周 3 个 must-win outcomes
   - 清理阻塞项
2. Tuesday to Thursday
   - 以 maker time 为主
   - 所有非必要会议压缩到 30 分钟以内
3. Friday
   - 复盘本周产出
   - 更新 CRM、投资人名单、活动名单
   - 记录演示、接入、收入、线索四类数据
4. Sunday night or Monday morning
   - 写下周版本的 scoreboard

### 6.2 Team Allocation Guardrails

时间分配必须硬控：

1. `Synapse-Network` 占每周总投入的 70% 到 80%
2. `Agents-Memory` 占 10% 到 15%
3. `Spec2Flow` 占 10% 到 15%
4. 只有当 `Agents-Memory` 或 `Spec2Flow` 能直接增强 Synapse demo、交付或团队效率时，才允许本周追加投入

### 6.3 Scoreboard

每周固定追踪：

1. 公网环境可用性
2. 可卖 Provider 服务数
3. 成功端到端调用次数
4. Demo 成功率
5. 设计伙伴会话数
6. 投资人 warm intros 数量
7. 已安排活动会议数

### 6.4 Week-by-Week Plan

#### Week 1: 2026-03-30 to 2026-04-05

Mission:
把大图变成真实作战系统，先收口，不再战略飘移。

Must-win outcomes:

1. 建立统一 portfolio board
2. 完成 Synapse 当前状态审计
3. 锁定 12 周 scoreboard 与角色帽子

Execution:

1. 建立 portfolio board
   - 列出四条 lane：Product, GTM, Investor, Ops
   - 每个 lane 指定 owner hat
2. 审计 Synapse 当前 readiness
   - 测试网部署状态
   - SDK readiness
   - MCP 是否已有代码骨架
   - Provider 货架哪些已可卖，哪些只是 demo
3. 确定每周 review 节奏和 KPI 面板
4. 确认 `FutureX`, `PDX2026`, `AIMX` 的报名、门票、赞助、申请窗口

Exit criteria:

1. 有一份统一 board
2. 有一份 readiness gap list
3. 有一份 event action list

Today execution drill-down:

1. `docs/exec-plans/active/2026-03-30_Week1_Today_Checklist.md`

#### Week 2: 2026-04-06 to 2026-04-12

Mission:
让公网测试环境具备基础对外展示能力。

Must-win outcomes:

1. 前端、网关、Provider、数据库的公开环境路径明确
2. 合约测试网目标确定
3. Demo 域名和入口规划成型

Execution:

1. 选择并确认测试网
   - 优先 `Arbitrum Sepolia`
   - 备选 `Base Sepolia`
2. 确认云资源和部署方式
   - 前端域名
   - 网关公网入口
   - Provider service 公网入口
3. 明确 Demo 环境和日常开发环境隔离方式
4. 设计 Demo URL 结构和对外入口顺序

Exit criteria:

1. 公网部署架构定稿
2. 域名与环境 mapping 明确
3. Demo 环境不再依赖本地 localhost 讲故事

#### Week 3: 2026-04-13 to 2026-04-19

Mission:
补齐货架，让 Synapse 看起来像市场，不像空商场。

Must-win outcomes:

1. 至少 3 个 Provider 服务进入可演示状态
2. 服务定价和对外描述稳定
3. discover 页面与调用路径能打通

Execution:

1. 锁定官方样板服务
   - `web3 sentiment`
   - `smart contract audit`
   - `whale-flow monitor`
2. 为每个服务补齐
   - 服务描述
   - demo request / response
   - 定价
   - 成功与失败路径
3. 校验服务能出现在 discover 结果中
4. 补服务对外展示素材

Exit criteria:

1. 三个服务可 discover
2. 三个服务可 invoke
3. 三个服务都能出现在演示脚本里

#### Week 4: 2026-04-20 to 2026-04-26

Mission:
把 Hero Demo 从“能跑”打磨到“能惊艳”。

Must-win outcomes:

1. Hero Demo 剧本定稿
2. 买家、卖家、平台三角色隔离跑通
3. 录屏前的翻车点被清掉

Execution:

1. 固定 Demo 剧本
   - discover
   - quote
   - invoke
   - 扣费
   - receipt
   - provider income
   - withdrawal
2. 验证三角色隔离
3. 处理 UI 和错误提示的明显翻车点
4. 写 Demo runbook

Exit criteria:

1. 一次完整演示可在 3 分钟内跑完
2. 演示过程中无角色串号
3. 演示失败时有 recovery path

#### Week 5: 2026-04-27 to 2026-05-03

Mission:
把 Python SDK 变成真的“插头”。

Must-win outcomes:

1. SDK Quickstart 可一把梭跑通
2. 示例脚本稳定
3. 对外接入入口可以发给外部开发者

Execution:

1. 打磨 Python SDK Quickstart
2. 固定一份最短示例
3. 补齐常见错误与排查文档
4. 把 SDK 接入页放进 one-pager / 开发者页

Exit criteria:

1. 新开发者 5 分钟内能跑通一次调用
2. Quickstart 不依赖仓库内部隐式知识
3. SDK 成为对外分享链接的一部分

#### Week 6: 2026-05-04 to 2026-05-10

Mission:
上线 MCP MVP，让你不再只是“有 API”，而是“能被 Agent 原生接走”。

Must-win outcomes:

1. MCP MVP 范围锁定并完成
2. 至少支持 `discover`, `quote`, `invoke`, `balance`
3. 开发者演示脚本可切换 SDK 和 MCP 两种讲法

Execution:

1. 锁定 MCP 最小边界
2. 完成最小文档
3. 准备一个 Cursor / Claude Desktop 风格演示
4. 将 MCP 入口加入外部材料

Exit criteria:

1. MCP MVP 可演示
2. MCP 不是 PPT 中的空气名词
3. Agent 支付能力具备更强行业对位

#### Week 7: 2026-05-11 to 2026-05-17

Mission:
围绕 `FutureX Ventures Fest 2026` 打第一波融资和生态曝光。

Must-win outcomes:

1. FutureX 前的会面名单准备好
2. 10 页以内 deck 和 one-pager 可发
3. Demo 视频初版完成

Execution:

1. 整理投资人和伙伴名单
2. 安排 FutureX 会面节奏
3. 准备 5 分钟和 30 秒两个版本的话术
4. 输出 demo video V1

Exit criteria:

1. FutureX 前至少有 8 到 12 个目标会面对象
2. deck, one-pager, demo video 都可发
3. 活动不是临场 improvisation

#### Week 8: 2026-05-18 to 2026-05-24

Mission:
把 FutureX 带回来的温度变成真的 pipeline。

Must-win outcomes:

1. 所有会后线索在 72 小时内完成跟进
2. 投资人名单完成 A/B/C 分层
3. 设计伙伴名单开始预约深聊

Execution:

1. CRM 更新
2. 发送会后材料
3. 安排 follow-up call
4. 记录所有反馈中的重复问题

Exit criteria:

1. 没有一条高价值线索躺在微信和邮箱里腐烂
2. 至少约出一批第二次深聊
3. deck 和 demo 根据真实反馈更新一版

#### Week 9: 2026-05-25 to 2026-05-31

Mission:
从“可演示”推进到“有使用信号”。

Must-win outcomes:

1. 至少拿下第一批 design partner 深聊
2. 真实调用数据开始累计
3. 关键成功指标开始可追踪

Execution:

1. 跑 design partner interview
2. 记录试点需求
3. 跑真实调用样本
4. 补 demo 成功率和失败原因面板

Exit criteria:

1. 有至少 2 个明确试点需求
2. 有真实端到端调用数据
3. 有可给投资人看的初步 traction evidence

#### Week 10: 2026-06-01 to 2026-06-07

Mission:
把融资材料从“能看”升级到“能打”。

Must-win outcomes:

1. deck V2 完成
2. data room 初版完成
3. 投资人深聊脚本稳定

Execution:

1. 形成完整材料包
   - deck
   - one-pager
   - demo video
   - architecture diagram
   - traction snapshot
2. 准备 FAQ
3. 准备技术尽调常见问题答案

Exit criteria:

1. 材料包具备统一叙事
2. 你可以在 15 分钟内完整讲清楚项目
3. 你可以在 5 分钟内把人讲上头

#### Week 11: 2026-06-08 to 2026-06-14

Mission:
推进第二轮深聊和试点验证。

Must-win outcomes:

1. 一批投资人进入第二轮沟通
2. 一批设计伙伴进入试点方案讨论
3. PDX2026 前置准备启动

Execution:

1. 跟进重点投资人
2. 为重点伙伴准备定制版 demo
3. 开始整理 `PDX2026` 参会和会面清单
4. 复盘前 10 周执行偏差

Exit criteria:

1. 至少有一批持续互动对象，不是单次碰面
2. 产品叙事对企业和投资人两个版本都能讲
3. 7 月活动准备不再临时抱佛脚

#### Week 12: 2026-06-15 to 2026-06-21

Mission:
完成 Q2 收官，决定 Q3 的主攻节奏。

Must-win outcomes:

1. 做 Q2 复盘
2. 形成 Q3 版本路线图
3. 决定 `PDX2026` 和 `AIMX 2026` 的资源配置

Execution:

1. 汇总 12 周成果
2. 复盘失败项和拖延项
3. 确定 Q3 的 booth / 演讲 / 赞助 / 参会策略
4. 决定 7 月到 8 月的 GTM 和 fundraising 主节奏

Exit criteria:

1. 有一份 Q2 复盘文档
2. 有一份 Q3 目标文档
3. 所有人知道 7 月到 8 月打什么，不再飘

## 7. Acceptance Criteria

1. 已把总计划拆成按周执行的 12 周作战表。
2. 每周都有明确的 mission、must-win outcomes、执行项和 exit criteria。
3. 已明确小团队的角色帽子和时间分配护栏。
4. 已明确固定 scoreboard，便于周复盘和融资材料沉淀。
5. 本计划与上层 GTM 总计划保持一致，没有偏离主线。

## 8. Risks And Rollback

1. 风险：每周目标定太多，周周都完不成。
   - 应对：每周只允许 3 个 must-win outcomes。
2. 风险：活动和投资人会议挤占 builder time。
   - 应对：固定 Tuesday to Thursday 为 maker-heavy 时间。
3. 风险：`Agents-Memory` 和 `Spec2Flow` 抢占主线注意力。
   - 应对：对两个侧翼项目设置时间上限。
4. 风险：只忙于做 demo，没有真实使用数据。
   - 应对：Week 8 到 Week 10 必须强制转向 design partners 和真实调用。

## 9. Decision Log

### 2026-03-30

- Decision: 用 12 周节奏承接总计划，而不是继续停留在季度级口号。
- Reason: 当前阶段胜负手在执行密度，不在概念扩写。
- Rejected alternatives:
  - 继续只维护一个总计划
  - 直接拆成太细的日计划

### 2026-03-30

- Decision: 将 `FutureX` 放在 Week 7 节点，将设计伙伴和 traction 建设放在 Week 8 到 Week 10。
- Reason: 需要先有可发材料和可跑 demo，再把活动热度转成融资与试点。
- Rejected alternatives:
  - 先大规模融资，再补产品和 demo
  - 先做完所有功能，再开始见投资人

## 10. Validation Log

### 2026-03-30

- Command or check: 读取并承接 `2026-03-30_Malaysia_AI_Event_and_Portfolio_GTM_Plan.md`
- Result: 已将上层战略拆成 12 周执行节奏
- Follow-up: 后续可继续拆成 `Q2 weekly board` 或 issue-level backlog

## 11. Completion Notes

本文件是总计划的周执行层，不替代后续更细的 issue、PR、功能分解。

如果 12 周推进中出现重大变化，优先更新：

1. 本文件中的 week plan
2. 上层 GTM 总计划
3. 四张执行看板
4. 对应的功能执行计划
