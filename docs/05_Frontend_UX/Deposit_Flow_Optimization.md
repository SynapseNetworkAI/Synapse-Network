# 🏦 Synapse Network: Deposit Flow & Intent Tracking Optimization

## 1. 现状痛点与架构警报 (Current Pain Points)

兄弟，目前的充值体验存在重大的“黑盒效应”，这对基础设施（Infra）来说是致命的：
1. **两步操作无感知 (Blind 2-Step Process)**：用户点击充值后，会连续弹出两次小狐狸钱包（一次是 Permit 支出上限签名，一次是真正的 Gas 交易）。很多用户不知道自己在干什么，以为签名报错或者被骗了。
2. **缺乏 Native Token (ETH) 校验**：如果用户测试网没有 ETH 作为 Gas 费，在第二步（支付 Gas）时会直接卡死、估算失败或被拒绝（如截图所示的 Network Fee: Unavailable）。更严重的是，前端没有任何友好的提示。
3. **失败交易“人间蒸发” (Lost Failed Txs)**：充值失败（例如因没有 ETH 导致上链失败）时，这笔操作就像没发生过一样。宏观资金表 `USDC Funds Ledger` 仅拉取了链上的 `DepositInfo` 成功事件，用户的“失败充值”成了赛博黑洞。

---

## 2. 前端设计与流程重构 (Frontend UX & Flow Restructure)

为了让充值体验达到 Stripe 级别的丝滑且极度通透，我们需要重构 `Developer Console` 里的充值弹窗（Top Up Modal）以及底层的资金聚合。

### 2.1. “明牌式”两阶段充值弹窗 (Transparent Stepper Modal)

将干瘪的「充值」按钮拆解为显性的两步状态机（Stepper）：
- **状态栏展示**：
  - [ ] **Step 1: 免 Gas 授权签名 (Sign Permit)** - 明确告诉用户这一步是链下签名，不需要 Gas。
  - [ ] **Step 2: 执行充值交易 (Submit Deposit)** - 明确告诉用户这一步会上链，需要消耗测试网 ETH。
- **ETH 余额前置阻断 (Native Gas Check)**：
  - 弹窗加载时，立刻使用 Wagmi 读取用户的 Native 余额（GoChain Testnet ETH）。
  - 若 `ETH < 0.001`，按钮上方强制展示红色的警告框：“⚠️ 您当前没有足够的 ETH 支付 Gas，充值将失败。[进入 Discord 领取测试币]”。

### 2.2. “影子账本”：失败意图的本地追踪 (Local Intent Tracking)

既然失败的充值不会产生真实 `txHash`（没有上链），后端的 `listDepositIntents` 也无法抓取到。我们需要利用 **前端影子账本（localStorage）** 来捕获这些“未遂的企图”。
- **拦截异常**：在 `writeContractAsync` 抛出 `User rejected` 或 `insufficient funds` 时，前端主动构建一个伪造的 `txHash`（例如 `failed_170123...`）。
- **注入失败日志**：将带明确 `failureReason` 的记录写入 localStorage（Key: `synapse_failed_deposits`）。
- **账本聚合渲染**：在 `useFundsData.ts` 中，除了拉取链上的 `depositLogs` 外，还要把 `localStorage` 中的失败记录抓出来，一并按照时间戳降序合并，并在 `FundsLedgerTable` 中打上醒目的 🔴 **FAILED** 标签。

---

## 3. 核心改造点 (Implementation Plan)

- [ ] **1. `useFundsData.ts` 升级**：增加对 `localStorage` 的读取机制，把 failed_deposits 洗成 `LedgerRecord` 塞进返回列表。
- [ ] **2. `FundsLedgerTable.tsx` 改造**：给 `Status` 列增加对 `FAILED` 的支持，将金额置灰并显示划线，附带失败原因提示（Tooltip）。
- [ ] **3. `console/page.tsx` 弹窗动刀**：
  - 引入 Wagmi `useBalance` 读取原生 ETH 余额。
  - 内部切割出 `step: 1 | 2`。
  - 增加对错误栈（Error Stack）的捕获和本地存储（localStorage 写入逻辑）。

## 总结
**“即使失败，也要死得明明白白。”**
这套重构方案不仅解决了小白用户对 Gas 不明所以的恐慌，还将把所有丢失的“黑洞操作”悉数召回资金流水表。兄弟，这才是未来金融级 Infra 的用户体验！
