# Hero Demo Runbook

## 0. Metadata

- Status: active
- Owner: Product / Design hat + Founder / CTO hat
- Date: 2026-03-30
- Related systems: `apps/frontend`, `gateway`, `provider_service`, `sdk/python`, `contracts`
- Related docs:
  - `docs/exec-plans/active/2026-03-30_Readiness_Gap_List.md`
  - `docs/exec-plans/active/2026-03-30_3_Minute_Demo_Recording_Script.md`
  - `docs/01_Product_Vision/Pitch_Deck_Material.md`
  - `docs/feature_designs/路演准备.md`

## 1. Purpose

这份 runbook 只解决一个问题：

**怎么把 Synapse 的“机器自己买服务并完成结算”演示成 3 分钟内能打人的画面。**

## 2. Demo Objective

在一次完整演示里，让观众同时看到：

1. Agent 发现服务
2. Agent 创建报价
3. Agent 执行付费调用
4. 平台余额变化
5. Provider 收益变化
6. 提现能力存在

## 3. Demo Setup

### 3.1 Roles

必须使用三个角色，禁止串号：

1. `Buyer / Owner`
   - 控制台里看余额、充值、创建 credential
2. `Agent`
   - 在终端或脚本里发起 discover / quote / invoke
3. `Provider`
   - 看 provider 收益与提现

### 3.2 Surfaces On Screen

建议双屏或并排录制：

1. 左侧：终端
2. 右侧：Synapse 控制台

如果能切第三个视角：

3. Provider workspace / provider settlement 页面

### 3.3 Preferred Chain

优先：

1. `Arbitrum Sepolia`

备选：

2. `Base Sepolia`

## 4. Demo Flow

### Step 1. Show the pain

旁白：

“AI Agent 已经会调用工具了，但它们还不会自己付款。没有支付轨道，它们就干不了真正的工作。”

画面：

1. 终端展示一次没有可用 credential 或没有余额的失败调用
2. 屏幕上明确看到失败结果，而不是报一串难看 traceback

目标：

1. 先把问题讲出来

### Step 2. Show funding and authorization

旁白：

“现在老板给这个 Agent 一张带预算的赛博信用卡。”

画面：

1. Buyer / Owner 在控制台上展示余额或充值记录
2. 展示 Agent credential 已存在
3. 展示预算不是无限的，而是受控的

目标：

1. 把支付权和预算权讲清楚

### Step 3. Show discover

画面：

1. 终端执行 discover
2. 输出候选服务
3. 最终选中一个样板服务

建议使用服务：

1. `web3 sentiment`
2. `smart contract audit`
3. `whale-flow-monitor`

目标：

1. 观众看到这不是硬编码 URL，而是网络发现

### Step 4. Show quote

画面：

1. 终端输出 quote 结果
2. 明确展示价格和约束

目标：

1. 让观众理解这是“先报价，再调用”，不是黑盒扣费

### Step 5. Show invoke

画面：

1. 终端执行 invoke
2. 终端输出结果
3. 同步展示调用成功

目标：

1. 让观众看到 Agent 真正买到了服务结果

### Step 6. Show settlement effect

画面：

1. Buyer 余额减少
2. Provider 收益增加
3. 平台可抽取协议费

目标：

1. 让商业模式可视化

### Step 7. Show withdrawal path

画面：

1. Provider 视角进入提现页面或展示提现记录
2. 如果现场不实际提现吗，至少展示 withdrawal flow 已存在

目标：

1. 证明收入不是数据库幻觉

## 5. Suggested Script

### 30-second version

“AI Agent 今天会工作，但还不会自己付钱。Synapse 做的是它们的 payment rail。老板先充值、给 Agent 一个带预算的 credential，Agent 再 discover 服务、拿 quote、发起 invoke，调用成功时链下秒扣，Provider 收益增长，最后还能提现。我们不是在做另一个 AI app，我们是在做 Agent Economy 的结算底座。”

### 90-second version

“这里左边是一个 Agent，右边是 Synapse 控制台。先看失败路径，没有支付能力的 Agent 什么都干不了。现在老板给它一张带预算的赛博信用卡。它先 discover 到一个可用服务，再拿到报价，再执行 invoke。各位注意看，终端拿到真实结果的同时，右侧控制台余额减少，Provider 收益上升，平台也完成协议抽成。整个过程高频调用走链下网关，资金担保和提现边界走链上。这个组合让 Agent 可以真正自主购买 API，而不是永远依赖人工绑信用卡。”

## 6. Recommended Command Surface

优先使用：

1. `sdk/python` 的最短 quickstart 或 `gateway/examples/synapse_client_quickstart.py`

要求：

1. 命令必须短
2. 输出必须好看
3. 不要让观众看太多内部实现细节

## 6.1 Proven Local Runtime Path

2026-03-30 已在本地跑通两条真实链路，当前最稳的 demo services 是：

1. `svc_web3_sentiment_index`
2. `svc_smart_contract_audit`

本地验证环境：

1. `gateway`: `http://127.0.0.1:8000`
2. `provider_service`: `http://127.0.0.1:8100`

已验证成功的链路：

1. `discover`
2. `quote`
3. `invoke`

第一条链关键结果：

1. `quoteId`: `quote-38ff2534b4cb4c8ba722bd34f262245d`
2. `invocationId`: `inv-18dc99a37d124ac7bb0326d2e5609579`
3. `chargedUsdc`: `0.0101`

第二条链关键结果：

1. `quoteId`: `quote-907fd1bbc4fa49b5924ceb610c7ffdb9`
2. `invocationId`: `inv-9b2a498c8f984680af8629ea172743ae`
3. `chargedUsdc`: `0.5001`

## 6.2 Recommended Live Demo Sequence

建议现场按这个顺序打：

1. 先展示 `discover?intent=web3`
2. 再展示 `quote` 返回 `0.01 USDC`
3. 最后执行 `invoke`
4. 同步展示 owner balance 从 `5.0` 下降

如果要做第二条备选链：

1. 切到 `discover?intent=audit`
2. 展示 `Smart Contract Audit Model`
3. 展示 `quote` 返回 `0.5 USDC`
4. 发送一个带 `delegatecall` 的 `source_bundle`
5. 展示返回的 `riskScore / riskLevel / criticalFindings`

## 6.3 Demo Notes From Real Run

这次真实联调暴露出的 4 个要点：

1. `web3 sentiment` 是当前最稳的首发 demo 服务
2. owner balance 必须先有可用余额，否则 `invoke` 会返回 `INSUFFICIENT_BALANCE`
3. 当前 agent credential 存在本地时区偏差问题，刚签发后可能被误判 `CREDENTIAL_EXPIRED`
4. `smart contract audit` 是当前最强的第二条“可讲价值”链，因为输出更像高客单价服务

建议现场录屏前：

1. 先确认 credential 可用
2. 先确认 owner balance 大于 `1 USDC`
3. 先确认 `discover` 能查到 `svc_web3_sentiment_index`
4. 如果做双链 demo，先确认 `discover?intent=audit` 能查到 `svc_smart_contract_audit`

## 7. Demo Readiness Checklist

- [ ] 买家、Agent、Provider 三角色隔离
- [ ] 至少一个服务 discover 成功
- [ ] 至少一个 quote 成功
- [ ] 至少一个 invoke 成功
- [ ] 控制台余额变化可见
- [ ] Provider 收益变化可见
- [ ] 录屏版本可离线播放
- [ ] 如果链上步骤失败，有备用录屏

## 7.1 Recording Script

正式录屏脚本见：

1. `docs/exec-plans/active/2026-03-30_3_Minute_Demo_Recording_Script.md`

建议执行策略：

1. 主镜头用 `web3 sentiment`
2. 第二镜头用 `smart contract audit`
3. 结尾固定回到 settlement reveal

## 8. Failure Recovery

如果现场出问题，按这个顺序降级：

1. 实时演示失败，切备用录屏
2. 链上步骤失败，只展示链下发现、报价、调用和结算
3. 如果 discover 不稳，切硬编码服务 ID 的备份剧本

## 9. Validation Log

### 2026-03-30

- Check: 承接 Week 1 readiness gap 中的 `Hero Demo script` 缺口
- Result: 已落首版 Hero Demo runbook
- Follow-up: 下一步需要补真实命令、真实 credential、真实录屏链接

### 2026-03-30 Runtime Verification

- Check: 本地完成 `discover -> quote -> invoke` 端到端联调
- Result: `svc_web3_sentiment_index` 已完成真实成功调用，`chargedUsdc=0.0101`
- Follow-up: 把这条本地成功链路录成 Hero Demo V1，并把 owner balance / provider income 画面一起录进去

### 2026-03-30 Second Demo Chain Verification

- Check: 本地完成 `svc_smart_contract_audit` 的 `discover -> quote -> invoke`
- Result: 第二条 demo 链真实成功，`chargedUsdc=0.5001`，并返回 `riskScore / riskLevel / criticalFindings`
- Follow-up: 把这条链整理成 Hero Demo 备选剧本，用于投资人或高客单价服务场景

### 2026-03-30 Recording Script Lock

- Check: 把两条本地已成功链路压缩成正式 `3-minute` 录屏脚本
- Result: 已新增独立录屏脚本，可直接用于 Hero Demo V1 录制
- Follow-up: 下一步按脚本录制 V1，并登记公开视频与备用离线视频
