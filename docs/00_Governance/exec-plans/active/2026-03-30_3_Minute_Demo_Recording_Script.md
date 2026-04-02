# 3-Minute Demo Recording Script

## 0. Metadata

- Status: active
- Owner: Founder / CTO hat
- Date: 2026-03-30
- Target length: `2m30s - 3m00s`
- Related systems: `gateway`, `provider_service`, `sdk/python`, `apps/frontend`
- Related docs:
  - `docs/exec-plans/active/2026-03-30_Hero_Demo_Runbook.md`
  - `docs/exec-plans/active/2026-03-30_Readiness_Gap_List.md`
  - `docs/exec-plans/active/2026-03-30_Provider_Shelf_Status_Table.md`
  - `docs/exec-plans/active/2026-03-30_Pitch_Scripts.md`

## 1. Purpose

把已经本地跑通的两条链：

1. `svc_web3_sentiment_index`
2. `svc_smart_contract_audit`

压成一版投资人、活动现场、WhatsApp 转发都能直接打的 3 分钟录屏脚本。

## 2. Recording Goal

这支视频必须在 3 分钟内让人看懂 4 件事：

1. Agent 不是硬编码某个 API，而是在 Synapse 上 discover 服务
2. Agent 会先拿 quote，再执行 invoke，扣费不是黑箱
3. 一次低客单价服务和一次高价值服务都能成交
4. 结算结果会反映到 owner balance、provider income 和 platform fee

## 3. Screen Layout

推荐三栏或双栏切屏：

1. 左侧终端：跑 `discover -> quote -> invoke`
2. 右上控制台：owner balance / deposit history / credential
3. 右下控制台或截图：provider receivable / platform fee

如果只能双栏：

1. 左侧终端全程不动
2. 右侧按 `owner -> provider settlement` 两次切镜

## 4. Pre-Flight Checklist

录之前先确认：

1. `gateway` 在线：`http://127.0.0.1:8000/health`
2. `provider_service` 在线：`http://127.0.0.1:8100/health`
3. `SYNAPSE_API_KEY` 已可用，不会触发 `CREDENTIAL_EXPIRED`
4. owner balance 大于 `1 USDC`
5. `discover?intent=web3` 能看到 `svc_web3_sentiment_index`
6. `discover?intent=audit` 能看到 `svc_smart_contract_audit`
7. 右侧控制台提前打开 owner balance、provider receivable、platform fee

## 5. Timeline Script

### 0:00 - 0:20 Opening

画面：

1. 终端静止
2. 控制台显示 owner balance 和 credential

旁白：

“AI Agent 今天会工作，但还不会自己付钱。Synapse 做的是它们的 payment rail。老板先充值、给 Agent 一个带预算的 credential，接下来机器自己 discover 服务、拿 quote、发起 invoke，并在调用时完成结算。”

### 0:20 - 1:15 Chain 1: Web3 Sentiment

画面：

1. 终端执行 `discover`，展示 `svc_web3_sentiment_index`
2. 终端执行 `quote`，突出 `0.01 USDC`
3. 终端执行 `invoke`
4. 结果返回 `SUCCEEDED`

旁白：

“先看第一条低门槛链路。这个 Agent 不是写死某个 URL，而是在网络里 discover 一个 Web3 sentiment 服务。它先拿 quote，价格是 `0.01 USDC`，再发起 invoke。各位现在看到的不是 mock，是真实返回的结构化结果。”

必须打出来的关键信号：

1. `quoteId`: `quote-38ff2534b4cb4c8ba722bd34f262245d`
2. `invocationId`: `inv-18dc99a37d124ac7bb0326d2e5609579`
3. `chargedUsdc`: `0.0101`

### 1:15 - 2:15 Chain 2: Smart Contract Audit

画面：

1. 终端切到 `discover?intent=audit`
2. 展示 `svc_smart_contract_audit`
3. 终端执行 `quote`，突出 `0.5 USDC`
4. 终端执行 `invoke`
5. 返回 `riskScore / riskLevel / criticalFindings`

旁白：

“第二条链我们不讲便宜调用，而是讲高价值服务。这个 Agent discover 到一个 smart contract audit service，先拿到 `0.5 USDC` 的 quote，再提交一个包含 `delegatecall` 风险的 source bundle。调用成功后，它返回风险评分、风险等级和关键漏洞摘要。这就不是玩具 demo 了，这已经是一个能收费的专业服务。”

必须打出来的关键信号：

1. `quoteId`: `quote-907fd1bbc4fa49b5924ceb610c7ffdb9`
2. `invocationId`: `inv-9b2a498c8f984680af8629ea172743ae`
3. `chargedUsdc`: `0.5001`
4. `riskScore`: `35`
5. `riskLevel`: `medium`

### 2:15 - 2:45 Settlement Reveal

画面：

1. 右侧切 owner balance
2. 再切 provider receivable
3. 最后切 platform fee

旁白：

“这里是关键。Agent 拿到结果的同时，owner balance 下降，provider income 上升，platform fee 也同步积累。也就是说，Synapse 不是只帮你调 API，而是在帮 Agent Economy 完成真实结算。”

建议突出：

1. owner balance: `5.0 -> 4.4898`
2. provider receivable: `0.459`
3. platform fee accrued: `0.0512`

### 2:45 - 3:00 Close

画面：

1. 回到终端停在两次成功结果
2. 右侧保留 settlement 数字

旁白：

“这就是 Synapse。不是另一个 AI app，而是让 AI agents 能自己买服务、自己结算、自己扩张的底层 payment rail。”

## 6. Terminal Prompts To Keep

录屏时终端里尽量保留这些标题行，方便观众秒懂：

1. `=== discovery ===`
2. `=== quote ===`
3. `=== invoke ===`
4. `Invocation status: SUCCEEDED`
5. `chargedUsdc`

## 7. Editing Rules

后期剪辑遵守 4 条：

1. 不加花哨转场，保持一镜到底感
2. 每条链只保留一个最关键结果，不要滚太长日志
3. 数字信息必须停留至少 `2-3` 秒，特别是价格和结算结果
4. 视频封面标题只写一句：`AI Agents Can Now Pay for APIs`

## 8. Backup Cuts

如果要做两个版本：

1. `Full 3-minute version`
   - 保留双链和 settlement 镜头
2. `1-minute investor forward version`
   - 只保留 opening、第一条链和 settlement reveal

## 9. Validation Log

### 2026-03-30

- Check: 基于已真实跑通的 `web3 sentiment` 与 `smart contract audit` 两条链生成正式录屏脚本
- Result: 已形成可按秒表执行的 3 分钟 demo recording script
- Follow-up: 下一步按此脚本录 Hero Demo V1，并登记视频链接
