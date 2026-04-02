# Pitch Scripts

## 0. Metadata

- Status: active
- Owner: Founder / CEO hat
- Date: 2026-03-30
- Related systems: `Synapse-Network`
- Related docs:
  - `docs/exec-plans/active/2026-03-30_Investor_Sheet_V0.md`
  - `docs/01_Product_Vision/Pitch_Deck_Material.md`
  - `docs/exec-plans/active/2026-03-30_Malaysia_AI_Event_and_Portfolio_GTM_Plan.md`

## 1. Purpose

把 Week 1 清单里要求的 `30 秒 / 5 分钟 / 15 分钟` 话术直接落成首版。

## 2. 30-Second Script

“Synapse 是 AI agents 的支付和结算底座。今天的 Agent 会工作，但还不会自己付款，传统 API 支付默认服务人类，不服务机器。我们做的是链上资金担保加链下高频结算网关，让 Agent 可以 discover 服务、拿 quote、自动 invoke，并在调用时完成毫秒级扣费和可审计结算。简单说，我们不是另一个 AI app，我们是 Agent Economy 的 payment rail。”

## 3. 5-Minute Script

“现在 AI agent 的问题不是它们不会推理，而是它们不会买东西。世界上大多数高质量 API 和工具都躲在信用卡、订阅制和人工授权后面，这对机器不友好。Synapse 解决的是这个支付死结。

我们的方式很简单：老板先把 USDC 充进金库，再给 Agent 一个带预算的 credential。Agent 运行时先 discover 可用服务，再拿到 quote，再发起 invoke。高频调用和扣费在链下网关完成，速度快、没有每次上链 gas 的问题；链上只保留资金担保和最终提现边界。这样我们同时拿到了速度、成本和可审计性。

从产品上看，这不是一个普通 dashboard 项目。我们的核心是 runtime 接入能力，所以我们把重点放在三件事：可卖服务货架、Python SDK、MCP 接入。这样外部开发者和 Agent 平台可以真正接上我们的支付能力。

商业模式也非常直接：每一笔 Agent 调用，我们收一层协议费和路由费。只要 Agent 开始自主购买 API，这条支付轨道就天然有抽成能力。

现在我们已经有结算主链路、provider runtime 样板、多种下载/分析类服务和 SDK 基础。下一步的重点是 Hero Demo、公开测试网部署、MCP MVP 和第一批真实 design partner。我们现在找的是能帮助我们加速全球开发者和生态进入的投资人，而不是只给钱不带资源的人。” 

## 4. 15-Minute Script

### Opening

“我们相信，未来最大的支付网络之一，不是服务人类点击按钮，而是服务机器自动购买服务。AI agent 会成为新的经济参与者，但今天它们还没有原生支付轨道。Synapse 就是为这个时代准备的结算层。”

### Problem

“现在的支付系统对 Agent 很别扭。大多数 API 和工具默认人类绑信用卡、点订阅、管权限。机器可以工作，却不能自己完成购买。结果是整个 Agent economy 卡在支付层，而不是卡在模型层。”

### Solution

“我们把问题拆成两层。链上只负责资金担保和提现边界，保证资金安全和可验证；链下网关负责 discover、quote、invoke、扣费、账本和审计，把高频调用留在高性能路径上。这让 Agent 可以像调用函数一样购买服务，而不是等待人类介入。”

### Demo Narrative

“演示里你会看到三件事。第一，Agent 不是硬编码 URL，而是 discover 到可用服务。第二，它会先拿 quote 再调用，所以扣费不是黑箱。第三，调用成功时平台余额和 provider 收益同步变化，证明结算不是 PPT，而是可以跑的基础设施。”

### Product Wedge

“我们的切入点不是做一个大而全的 To C AI 产品。我们瞄准的是 Agent 开发者、Agent 平台和企业自动化系统。先给他们一个能接入的支付轨道，再逐步扩展服务网络和生态。”

### Current Product State

“现在仓库里已经有 gateway、contracts、provider_service、frontend、sdk/python 和 admin control plane 的骨架。provider side 已经有多类样板服务，包括 Web3 sentiment、smart contract audit、whale flow，以及多种下载类 runtime。SDK 已经能跑 discover/quote/invoke 主链路。接下来最重要的是把这些能力收口成公网 demo、Hero Demo、MCP MVP 和一批真实试点。”

### Business Model

“我们的收入模式非常干净：每次 Agent 调用，我们收协议费和路由费。随着更多 provider 和更多调用进入网络，这个收入模型天然随交易量增长。”

### Why Now

“Why now 非常简单。模型能力已经足够强，Agent 的任务复杂度也在升高，但支付和调用结算还停留在旧世界。谁先把这个支付轨道建出来，谁就先占住 Agent economy 的关键基础设施位置。”

### Ask

“我们现在找的是一轮能帮助我们从 demo 走向公开测试网和第一批 design partners 的资金与资源。钱当然重要，但更重要的是开发者生态、企业试点资源和区域扩张支持。如果你理解 AI infra、payments、stablecoin 或东南亚市场，我们很愿意继续深入。” 

## 5. Talk Track Rules

每次讲都要守住：

1. 先讲问题，不先讲技术栈
2. 先讲支付死结，不先讲区块链细节
3. 先讲 Agent economy，不先讲 dashboard 页面
4. 先讲结算闭环，再讲下载服务和 SDK

## 6. Validation Log

### 2026-03-30

- Check: 承接 Week 1 清单中 `三套 pitch 骨架` 要求
- Result: 已形成 30 秒 / 5 分钟 / 15 分钟首版话术
- Follow-up: 下一步可继续压缩成 deck 页面文案和活动现场版本
