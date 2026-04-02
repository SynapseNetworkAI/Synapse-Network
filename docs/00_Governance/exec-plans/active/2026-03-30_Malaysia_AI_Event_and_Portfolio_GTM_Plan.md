# 2026 Malaysia AI Event and Portfolio GTM Plan

## 0. Metadata

- Status: active
- Owner: Alex / Synapse founding team
- Date: 2026-03-30
- Related systems: `Synapse-Network`, `Agents-Memory`, `Spec2Flow`
- Related docs:
  - `docs/AGENTS.md`
  - `docs/ARCHITECTURE.md`
  - `docs/exec-plans/active/2026-03-30_Synapse_12_Week_Execution_Plan.md`
  - `docs/exec-plans/active/2026-03-30_Synapse_Execution_Boards.md`
  - `docs/01_Product_Vision/MVP.md`
  - `docs/01_Product_Vision/ROADMAP.md`
  - `docs/01_Product_Vision/Business_Plan.md`
  - `docs/01_Product_Vision/Pitch_Deck_Material.md`
  - `docs/03_Projects/README.md`
  - `docs/03_Projects/gateway/README.md`
  - `docs/03_Projects/provider-service/README.md`
  - `docs/03_Projects/sdk-python/README.md`

## 1. Background

Synapse 当前已经不是一句空 PPT。仓库文档显示，`gateway`、`contracts`、`provider_service`、`sdk/python`、`frontend`、`gateway-admin` 和 `admin-front` 的职责边界都已经明确，主线产品已经具备“链上充值担保 + 链下 discover/quote/invoke + 账本审计 + Provider 提现审核”的基础骨架。

当前真正的问题已经不是“要不要继续造底层”，而是三个更现实的判断：

1. 2026 年在马来西亚，应该去哪些 AI 相关活动拿客户、拿伙伴、拿投资人。
2. 你手上的三个项目里，哪一个必须成为绝对主线。
3. 在融资前，Synapse 还缺哪些功能、哪些证明、哪些叙事材料。

基于 2026-03-30 的外部公开信息，当前值得跟踪的马来西亚 AI / AI 邻近活动如下：

1. [SAMENTA Hyperlokal AI Fest 2026 - Penang - NTIC](https://eventsize.com/ja/event/samenta-sme-ai-fest-ai-hyperlokal-penang-ntic/p/1/)
   - 时间：2026-04-29
   - 地点：NCER Technology Innovation Centre, Bayan Lepas, Penang
   - 判断：偏 SME AI adoption，适合找潜在 Provider、渠道伙伴和本地企业试点，不是最强融资场。
2. [FutureX Ventures Fest 2026](https://eventsize.com/event/1769679987678-futurex-ventures-fest-2026)
   - 时间：2026-05-12
   - 地点：Bandar Sunway, Selangor
   - 判断：AI / deep tech + startups + investors + corporates 混合场，适合拿 warm intro 和 investor pipeline。
3. [PDX2026 Penang Digitalisation-AI Conference & Exhibition](https://penangdigitalisation.com/)
   - 时间：2026-07-15 至 2026-07-16
   - 地点：Setia SPICE Convention Centre, Penang
   - 判断：偏企业级 AI、数字化、政策与区域生态，适合企业客户和政府生态合作。
4. [AIMX 2026 Artificial Intelligence Malaysia Expo](https://aimalaysiaexpo.com/)
   - 时间：2026-08-18 至 2026-08-20
   - 地点：MITEC, Kuala Lumpur
   - 判断：这是 2026 年最像主战场的 AI 大展，适合 booth、demo、合作方、媒体和投资人一锅端。
5. [MDX State Leadership Summit 2026](https://www.mdec.my/media-release/news-press-release/413/mdx-state-leadership-summit-2026-brings-states-and-industry--together-to-drive-malaysia%E2%80%99s-ai-future)
   - 时间：2026-01-21 至 2026-01-23
   - 地点：George Town, Penang
   - 判断：本年度窗口已经过去；它更像政策和州级数字经济协同场，不是主销售展，但值得通过 MDEC 补关系。

## 2. Goal

输出一个可执行的 2026 组合策略：

1. 明确三个项目的优先级。
2. 给出 Synapse 2026 上下半年路线图。
3. 明确哪些马来西亚活动值得参加，以及每场活动的目标。
4. 定义上线前必须补齐的功能、证明和风控闸门。
5. 统一投资人叙事和融资推进路径。
6. 回答是否需要新建第四个“管理项目”来协调这三个项目。

## 3. Non-Goals

1. 本计划不替代更细的工程执行计划、issue 分解或 sprint backlog。
2. 本计划不提供法律、证券、牌照或税务意见。
3. 本计划不承诺所有外部活动一定能报名、获批演讲或获得 booth。
4. 本计划不把 `Agents-Memory` 或 `Spec2Flow` 立即包装成第二条融资主叙事。

## 4. Scope

本计划覆盖：

1. 三项目优先级与组合打法
2. Synapse 上下半年产品与增长路线图
3. 马来西亚活动选择与参会目标
4. 上线前的功能缺口与风控基线
5. 路演话术、融资打法、投资人画像
6. 角色分工、项目管理和人员安排建议

## 5. Prerequisite Reading

1. `docs/AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/01_Product_Vision/MVP.md`
4. `docs/01_Product_Vision/ROADMAP.md`
5. `docs/01_Product_Vision/Business_Plan.md`
6. `docs/01_Product_Vision/Pitch_Deck_Material.md`
7. `docs/03_Projects/README.md`
8. `docs/03_Projects/gateway/README.md`
9. `docs/03_Projects/provider-service/README.md`
10. `docs/03_Projects/sdk-python/README.md`

## 6. Implementation Steps

### Step 1. 确立组合优先级

组合优先级必须非常残酷：

1. `Synapse-Network` 是绝对一号位。
   - 原因：离收入、融资、生态合作最近。
   - 原因：叙事最完整，技术骨架最重，最像基础设施公司。
   - 原因：一旦跑出真实调用和资金流，其他两个项目都能反哺它。
2. `Agents-Memory` 是二号位，但定位为能力放大器，不是当前融资主角。
   - 适合作为开源信誉层、工程效率层、团队方法论样板。
   - 可以给你带来开发者流量、GitHub 信任、Agent 工程话语权。
   - 但它目前离“强商业闭环”没有 Synapse 近。
3. `Spec2Flow` 是三号位，继续孵化，不抢主叙事。
   - 它更像未来的 AI workflow orchestration / execution framework。
   - 现在最适合做内部提效器和中期产品储备，而不是当前资本故事的主轴。

一句话决策：

**今年对外只打一个主故事：Synapse 是 AI Agents 的支付与结算基础设施。**

`Agents-Memory` 和 `Spec2Flow` 只做两种角色：

1. 给 Synapse 提供内部效率和研发飞轮。
2. 作为开源信誉与创始团队“连续造产品能力”的证据。

### Step 2. 2026 上半年路线图（2026-04 到 2026-06）

上半年目标不是“功能越多越好”，而是把 Synapse 从可运行，推进到可路演、可接入、可成交。

#### 2.1 4 月：把产品变成可公开展示的机器

必须完成：

1. 测试网公开环境稳定化
   - 合约部署到公开测试网，优先 `Arbitrum Sepolia` 或 `Base Sepolia`
   - 前端、网关、数据库、Provider 样板服务具备可公开访问地址
2. Hero Demo 闭环
   - `discover -> quote -> invoke -> receipt -> provider income -> withdrawal`
   - 一镜到底录屏版本
   - 断网备用录屏版本
3. Provider 货架补齐
   - 至少 3 个可卖服务
   - 建议主打：`web3 sentiment`, `smart contract audit`, `whale-flow monitor`
4. Developer 接入页
   - 官方 Python SDK 安装与 5 分钟接入指南
   - 一页式 one-pager
   - Quickstart + curl + SDK sample

#### 2.2 5 月：把产品变成可以被开发者接走的标准插头

必须完成：

1. Python SDK 产品化
   - `pip install` 体验稳定
   - 示例脚本可一键跑通
   - 错误码与收据语义稳定
2. MCP 最小可用版
   - 当前仓库文档和前端文案已经多处提到 MCP，但未见明确完成态入口
   - 必须补一个最小可用 `Synapse MCP`，至少支持 `discover`, `quote`, `invoke`, `balance`
3. Demo 用例标准化
   - 固定一个买家角色、一个卖家角色、一个真实任务
   - 固定一个“预算不超过 X USDC”的 Agent 自动消费剧本
4. 数据室初版
   - 10 页以内 pitch deck
   - 1 页 one-pager
   - 2 分钟 demo video
   - 产品架构图
   - 路线图与资金用途

#### 2.3 6 月：把产品变成可转介绍、可种子成交的样子

必须完成：

1. 设计伙伴（design partners）获取
   - 至少 3 个潜在 Provider 或 AI builder
   - 至少 2 个真实试点需求
2. 真实调用数据
   - 不求大，但必须有真实调用、真实报价、真实收据
   - 至少 100 次以上完整调用样本，最好有重复使用
3. 运营可追踪
   - 调用成功率
   - 平均响应时间
   - 失败分类
   - 充值到首调转化率

### Step 3. 2026 下半年路线图（2026-07 到 2026-12）

#### 3.1 7 月到 8 月：围绕展会打爆品牌心智

1. `PDX2026` 前
   - 重点准备企业版本叙事
   - 强调 AI adoption + paid tools + agent budget control
   - 目标是企业试点、地方产业合作、政府生态关系
2. `AIMX 2026` 前
   - 准备 booth 级 demo
   - 准备开发者报名页、等待名单、试用申请表
   - 准备统一销售话术和 3 类场景包

#### 3.2 9 月到 10 月：用展会之后的流量推进融资和试点签约

1. 把展会线索分成三桶
   - 投资人
   - Provider / 生态伙伴
   - 企业买家 / Agent builder
2. 对投资人推进正式 fundraising sprint
3. 对企业推进试点
4. 对 Provider 推进上线和联合 demo

#### 3.3 11 月到 12 月：决定 2027 年是做区域扩张还是协议深化

只有在以下条件达到后，才考虑把更多资源投入 `Agents-Memory` 或 `Spec2Flow` 的独立对外商业化：

1. Synapse 已有稳定试点
2. Synapse 已形成明确付费路径
3. 创始团队带宽允许第二条产品线发力

### Step 4. 活动选择与参会策略

不建议“什么 AI 活动都去”，那会把团队撕碎。推荐分层如下：

#### 4.1 必去

1. `FutureX Ventures Fest 2026`
   - 目标：投资人 warm intro、AI/deep tech 圈层曝光、拿媒体/圈内关系
   - 你带去的不是 booth，而是故事、demo 和约会名单
2. `AIMX 2026`
   - 目标：作为全年主战场
   - 目标：拿客户、伙伴、Provider、媒体、投资人
   - 这是最值得准备 demo、展台和主视觉的一场

#### 4.2 应去

1. `PDX2026`
   - 如果你想切 Penang 企业、制造业、数字化升级和政策生态，这场很值
   - 更适合企业版叙事，不适合过度 Web3 黑话

#### 4.3 可选

1. `SAMENTA AI Fest 2026`
   - 如果目标是找本地 SME Provider、做渠道和本地 adoption 教育，可以去
   - 如果时间和预算有限，优先级低于 FutureX / PDX / AIMX

#### 4.4 已错过但要补关系

1. `MDX State Leadership Summit 2026`
   - 今年 2026-01-21 到 2026-01-23 已经过了
   - 但 MDEC 关系仍要补，因为这条线会影响政策、生态资源、对外背书和后续活动入口

### Step 5. 上线前必须补齐的功能与证明

#### 5.1 P0：上线和路演前不能缺

1. 公开测试网部署和稳定公网访问
2. 充值、discover、quote、invoke、receipt、withdraw 的完整闭环 demo
3. 至少 3 个真实可卖 Provider 服务
4. Python SDK 的稳定 Quickstart
5. MCP 最小可用版
6. 开发者 one-pager 和 demo video
7. 核心风控闸门
   - 幂等
   - 事务一致性
   - 余额锁
   - 审计可追踪
   - 备份和恢复演练

#### 5.2 P1：一旦有余力就补

1. TypeScript SDK 或 tool wrapper
2. 更完整的服务发现排序和推荐
3. Provider self-serve onboarding 更顺滑
4. 更漂亮的 usage analytics 和结算看板
5. 多链支持的研究，不是立即落地

#### 5.3 明确先不做

1. 新的第四个外部产品
2. 大而全 To C AI 应用界面
3. 多币种扩张
4. 重型合规和牌照工程，除非已经进入真实监管要求阶段

### Step 6. 投资人叙事

投资人话术不能从“我们代码很多”开始，必须从“市场死结”和“你如何解锁它”开始。

建议统一成 8 句：

1. AI Agents 已经能工作，但它们还不能像人类一样付款。
2. 现在的 API 付费系统默认服务人类，不服务机器。
3. 高频、低额、自动化调用场景，用信用卡和传统订阅制极其别扭。
4. Synapse 给 Agent 一个带预算的支付与结算底座。
5. 我们把高频调用放到链下网关，链上只保留资金担保和最终提现。
6. 所以我们同时拿到了速度、低成本和可审计性。
7. 我们不是单个 AI 应用，我们是 Agent Economy 的 payment rail。
8. 商业模式很直接：每一笔调用收路由费和协议费。

讲投资人的顺序建议：

1. Why now
2. Problem
3. Solution
4. Demo
5. Market
6. Moat
7. Traction
8. Ask

### Step 7. 如何拉投资

融资不靠“海投”，靠可复制的 process。

#### 7.1 投资人画像

优先找四类：

1. AI infra / agent economy 投资人
2. Fintech / payments 投资人
3. Web3 / stablecoin / settlement 投资人
4. 马来西亚与东南亚本地生态投资人或企业创新平台

#### 7.2 拉投资的顺序

1. 先拿温度，再开正式流程
   - 先通过展会、朋友、社区、顾问拿 warm intro
2. 先讲故事，再发资料
   - 先讲 5 分钟版本，再发 one-pager
3. 先看 demo，再谈估值
   - 没 demo 的 infra 项目容易被当 PPT 项目
4. 先收兴趣，再排 batch meeting
   - 不要一有一个会就觉得进入流程

#### 7.3 8 周融资动作

1. 第 1-2 周：整理名单 50 家，分层 A/B/C
2. 第 2-4 周：打 warm intro，约前 15 个会
3. 第 3-5 周：跑 demo，收反馈，打磨 deck
4. 第 5-7 周：推进第二轮深聊、技术审查、客户验证
5. 第 7-8 周：制造时间压力，收 term signal

#### 7.4 投资人真正想看什么

1. 产品不是空壳
2. 技术壁垒足够重
3. 你知道先打哪个市场
4. 团队不是只会写代码
5. 有早期使用信号，哪怕很小

### Step 8. 人员安排与管理方式

如果你现在还是小团队，不要按“岗位名称”理解，而要按“角色帽子”理解。

最低配置的角色分工：

1. Founder / CEO hat
   - 投资人、伙伴、客户、MDEC、活动、媒体
2. Founder / CTO hat
   - Synapse 主路线、架构、SDK/MCP、demo 稳定性、风控闸门
3. Product / Design hat
   - landing page、deck、one-pager、演示脚本、展会素材
4. GTM / Ops hat
   - CRM、名单管理、展会报名、会后跟进、数据室整理

若允许增加第一批支持力量，优先级如下：

1. 全栈工程师或 contractor
   - 负责 SDK / MCP / frontend onboarding
2. Solution engineer / BD hybrid
   - 负责 demo、集成、客户试点和会后跟进
3. 设计 / 内容外包
   - 负责 deck、官网、展会视觉和视频包装

### Step 9. 是否需要新建一个第四项目来管理这三个项目

当前判断：

**不建议现在再新建一个面向外部市场的第四产品。**

原因：

1. 会分散创始人注意力
2. 会稀释融资叙事
3. 会让三个项目都半成品化

但：

**建议建立一个“组合管理层”，而不是新产品。**

可选实现方式按轻重排序：

1. 最轻量：继续用现有仓库文档 + 看板管理
   - 在 Synapse 里维护总计划
   - 各项目维护自己的局部计划
2. 中量：建立统一 portfolio board
   - 可以是 Notion / Linear / GitHub Projects
   - 管理三类信息：目标、负责人、依赖关系
3. 重量：等团队扩大后，再考虑单独的内部运营仓库
   - 这不是产品仓库
   - 这是 PMO / operating system 仓库

最佳路线不是新建“第四个产品”，而是：

1. 用 `Agents-Memory` 承载工程记忆和标准
2. 用 `Spec2Flow` 承载执行流程和自动化
3. 用一个统一 portfolio board 承载项目规划、人物安排和周节奏

## 7. Acceptance Criteria

1. 已明确三个项目的优先级，且 Synapse 被确认为 2026 主线。
2. 已明确 2026 上下半年路线图。
3. 已明确马来西亚重点活动及其参会目的。
4. 已明确上线前必须补齐的功能与风控闸门。
5. 已明确投资人叙事和 8 周融资动作。
6. 已明确“不做第四个外部产品，但建立组合管理层”的结论。
7. 文档成功落入 `docs/exec-plans/active/`，不再使用 `docs/plan/` 作为新主计划入口。

## 8. Risks And Rollback

1. 风险：三个项目同时冲刺，导致没有一个项目达到可融资强度。
   - 应对：所有对外叙事统一收口到 Synapse。
2. 风险：活动参加太多，变成到处打卡，没有成交。
   - 应对：每场活动必须先定义目标名单、目标产出、会后跟进节奏。
3. 风险：产品功能做太散，MCP、SDK、Provider、后台都想一次做满。
   - 应对：只做能直接增强 demo、接入和成交的最小集合。
4. 风险：只讲故事，没有真实调用数据。
   - 应对：优先做 3 个样板服务和小规模真实调用。
5. 风险：为了管理而管理，提前再开第四仓库。
   - 应对：先用轻量 portfolio board，等团队复杂度上来再升级。

## 9. Decision Log

### 2026-03-30

- Decision: 2026 年对外主线只打 `Synapse-Network`，不并行讲三条融资故事。
- Reason: Synapse 最接近资金闭环、基础设施壁垒和资本故事。
- Rejected alternatives:
  - 三项目同时对外融资
  - 先把 `Agents-Memory` 做成主商业化产品
  - 先把 `Spec2Flow` 做成主商业化产品

### 2026-03-30

- Decision: 马来西亚活动优先级为 `FutureX` + `AIMX`，其次 `PDX2026`，再其次 `SAMENTA AI Fest`。
- Reason: 需要同时覆盖融资、企业客户、生态合作与品牌曝光。
- Rejected alternatives:
  - 所有活动都参加
  - 只参加政策场，不参加产业场
  - 只参加开发者场，不做 investor routing

### 2026-03-30

- Decision: 现阶段不新建第四个外部产品，而是建立组合管理层。
- Reason: 当前瓶颈是聚焦，不是项目数量不够。
- Rejected alternatives:
  - 再开一个新产品仓库专门管理三项目
  - 完全不做跨项目管理

### 2026-03-30

- Decision: 上线与路演前的优先补齐项是 `Hero Demo + Provider 货架 + Python SDK 产品化 + MCP MVP + 风控闸门`。
- Reason: 这些项直接决定能否演示、能否接入、能否讲融资故事。
- Rejected alternatives:
  - 先做多币种
  - 先做复杂 To C AI 界面
  - 先做第二主产品

## 10. Validation Log

### 2026-03-30

- Command or check: 阅读 `docs/AGENTS.md`、`llms.txt`、`docs/ARCHITECTURE.md`、`docs/plan/README.md`、`docs/plan/项目计划.md`、`docs/01_Product_Vision/*`、`docs/03_Projects/*`
- Result: 确认 `docs/plan/` 为 legacy archive，新主计划应进入 `docs/exec-plans/active/`
- Follow-up: 计划文件已迁移到 canonical 执行计划目录

### 2026-03-30

- Command or check: 读取 `/home/alex/Documents/cliff/Agents-Memory/README.md` 与 `/home/alex/Documents/cliff/Spec2Flow/README.md`
- Result: `Agents-Memory` 更适合作为工程效率和开源信誉层，`Spec2Flow` 更适合作为中期执行框架储备
- Follow-up: 组合优先级已写入本计划

### 2026-03-30

- Command or check: 联网核对 2026 马来西亚 AI / AI 邻近活动公开页面
- Result: 已收集 `SAMENTA AI Fest 2026`、`FutureX Ventures Fest 2026`、`PDX2026`、`AIMX 2026`、`MDX SLS 2026`
- Follow-up: 后续若报名或 booth 策略变化，需要单独建 event execution checklist

## 11. Completion Notes

本文件是组合战略与增长方向的总计划，不替代后续更细的执行计划。

当前已落地的下钻执行计划：

1. `docs/exec-plans/active/2026-03-30_Synapse_12_Week_Execution_Plan.md`
2. `docs/exec-plans/active/2026-03-30_Synapse_Execution_Boards.md`

建议下一步继续按这个总计划拆出 2 到 3 份子计划：

1. `Synapse Demo and Launch Readiness Plan`
2. `Malaysia Event Pipeline and Follow-up Plan`
3. `Investor Outreach and Data Room Plan`
