# Dashboard 产品引导与信息架构设计（Buyer/Seller 双模式）

> 目标：让用户在进入 Dashboard 后 30 秒内清楚知道：
> 1) 平台能做什么；2) 我是买家怎么接入调用；3) 我是卖家怎么接入服务；
> 4) 怎么充值消费；5) 怎么赚收益；6) 平台怎么收费。

---

## 1. 设计原则

- **先认知，后操作**：先告诉用户“平台价值与两种角色”，再展示按钮。
- **路径可见**：买家路径、卖家路径、充值路径、收益路径都要有明确入口。
- **费用透明**：每笔调用、平台费、卖家净收入在 UI 上必须可解释。
- **统一口径**：沿用字段 `available_balance`、`unit_price`、`platform_fee`、`seller_net`、`request_id`。

---

## 2. Dashboard 首屏信息架构

## 2.1 顶部导航（保持精简）

- `Overview`（默认首页）
- `Buy Services`（买家接入/调用）
- `Provide Services`（卖家接入/API 管理）
- `Credentials`（凭据管理）
- `Billing`（充值/消费流水）
- `Settlement`（收益/提现）

> 若当前版本不拆多页，可先在单页内用分区锚点实现同等体验。

## 2.2 首屏 Hero（必须）

标题建议：
- **Synapse Network：让 Agent 安全调用 API，并自动完成扣费与结算**

副标题建议：
- 买家：充值后即可用凭据发起高频调用。  
- 卖家：接入 API 后按调用量获得收益。  
- 平台：按费率自动抽取服务费。

首屏 CTA（双入口）：
- `我是买家：充值并开始调用`
- `我是卖家：接入服务并开始赚钱`

---

## 3. 关键功能分区（Overview 页面）

## 3.1 平台提供什么功能（认知卡片）

用 4 张卡片解释核心能力：

1. **Deposit 预充值**：链上充值到 Vault，离链高速消费。
2. **Credential 授信**：给 Agent 签发 `X-Agent-Credential` 控制调用权限与额度。
3. **Gateway 扣费转发**：调用先过网关，原子扣费、失败可回滚。
4. **Settlement 结算提现**：卖家收益可提现，买家剩余余额可退款。

## 3.2 买家路径（How to Buy）

步骤条（4 步）：
1. 连接钱包登录
2. 充值 USDC（Deposit）
3. 创建/领取 Agent Credential
4. 调用服务并查看消费明细

按钮：
- `去充值`
- `去凭据管理`
- `去调用服务`

## 3.3 卖家路径（How to Earn）

步骤条（4 步）：
1. 注册 Agent
2. 注册 Service（`endpoint + unit_price`）
3. 接收网关转发调用
4. 查看收益并提现

按钮：
- `去注册服务`
- `查看调用记录`
- `去结算提现`

---

## 4. 充值与消费体验设计（买家）

## 4.1 充值卡（Deposit）

显示字段：
- `available_balance`
- 最近一次充值金额与时间
- 充值确认状态（`pending_confirmations / confirmed`）

交互：
- 输入充值金额 → 发起 `deposit(amount)` → 显示链上 tx 状态 → 入账成功提示

关键提示：
- “链上确认完成前，该余额不可消费”。

## 4.2 消费卡（Spend）

显示字段：
- 今日消费
- 本月消费
- 最近 10 笔调用（含 `request_id`, `unit_price`, `status`）

每笔明细展示：
- `unit_price`
- `platform_fee`
- `seller_net`
- `X-Synapse-Balance`（扣后余额）

---

## 5. 收益与结算体验设计（卖家）

## 5.1 收益总览

显示字段：
- 累计调用次数
- `seller_receivable`（待结算）
- 已结算金额
- 最近结算 `tx_hash`

## 5.2 提现流程

按钮：`申请提现`

文案说明：
- 平台校验后签发结算签名（EIP-712）。
- 卖家钱包发起链上 `claim` 并承担 Gas。

---

## 6. 平台费用展示（必须透明）

## 6.1 费用公式（固定展示）

- `platform_fee = unit_price * fee_rate`
- `seller_net = unit_price - platform_fee`

## 6.2 UI 展示位置

- 服务详情页：显示该服务 `unit_price` 与 `fee_rate`。
- 调用结果弹层：显示“本次扣费拆分”。
- 账单页：按日聚合平台费收入。

## 6.3 示例文案

- “你本次支付 0.05 USDC，其中平台服务费 0.0005 USDC，卖家收入 0.0495 USDC。”

---

## 7. 新手引导（首次访问）

首次进入 Dashboard 触发引导条（非强制弹窗）：

- Step 1：选择身份（买家/卖家/双角色）
- Step 2：按身份推荐第一步按钮
- Step 3：显示 Demo 数据样例（调用、扣费、收益）

引导完成后仍保留“快速开始”模块，避免用户迷路。

---

## 8. 状态与错误文案规范

- 未连接钱包：`请先连接钱包以继续`
- 未完成签名登录：`请完成钱包签名登录`
- 余额不足：`available_balance 不足，请先充值`
- 凭据失效：`credential_status=expired/revoked，请重新签发`
- 充值未确认：`链上确认中，确认后可开始消费`

---

## 9. MVP 实现优先级（建议）

### P0（必须）
- Overview 双路径入口
- 充值卡 + 消费卡 + 收益卡
- 费用公式固定展示
- 调用明细中展示扣费拆分

### P1（增强）
- 首次访问新手引导条
- 角色个性化推荐（买家优先/卖家优先）
- 账单筛选（按服务、时间）

### P2（增长）
- 使用建议与预算预警
- 收益预测（基于近 7 日调用）
- 平台费率实验与 A/B 文案优化

---

## 10. 验收标准

1. 新用户在 30 秒内能回答“平台提供什么能力”。
2. 新用户在 60 秒内能找到“充值”和“注册服务”入口。
3. 用户可清楚看到“每笔扣费如何拆分到平台与卖家”。
4. 买家能独立完成“充值→签发凭据→调用一次服务”。
5. 卖家能独立完成“注册服务→看到收益→发起提现”。

---

## 11. 一句话结论

Dashboard 不只是数据面板，而是 **Synapse Network 的业务导航系统**：把“怎么用、怎么花、怎么赚、平台怎么收”一次讲清楚，才能提高转化与留存。

---

## 12. Router 页面：刷新后状态恢复设计（V2 Shared Credential）

### 12.1 问题背景

在 Router 页面中，用户完成 `Approve` 或 `Pay & Issue Credential` 后，如果刷新页面，UI 不能退化为“未完成”的纯内存态。页面应自动恢复并展示真实完成度，避免重复操作和错误判断。

### 12.2 设计目标

- 刷新后自动恢复 setup 状态。
- 明确告知用户“还差哪一步”。
- 当且仅当所有关键步骤完成时，展示可调用状态。

### 12.3 刷新恢复来源（Source of Truth）

1. **链上授权状态（实时读取，不落库）**
	- 读取 `USDC.allowance(owner, router)`。
	- 用于判定是否满足当前阈值（`allowance >= requiredAllowance`）。

2. **平台余额状态（后端账本）**
	- 读取 `GET /api/v2/balance` 的 `buyerBalance`。
	- 用于判定是否具备可消费余额。

3. **共享凭据状态（后端凭据表）**
	- 读取 `GET /api/v1/agent-credentials`。
	- 选取 owner 级、active、未过期的共享凭据（`agentId/serviceId 为空`）。

### 12.4 Checklist 交互规范

Router 页面固定展示 3 条 setup 状态：

- `Allowance`：✅/⏳ + 当前值与目标值。
- `V2 Buyer Balance`：✅/⏳ + 当前可用余额。
- `Shared Credential`：✅/⏳ + 是否 active 与过期时间。

综合判定：

- 全部 ✅：`Ready: agent can invoke APIs now.`
- 否则：`Not ready yet: complete remaining ⏳ steps above.`

### 12.5 对用户的动作引导

- Allowance 未满足 → 执行 `Approve Router`。
- Balance 不足 → 执行 `Pay & Issue Credential`。
- Shared Credential 缺失/过期 → 重新执行 `Pay & Issue Credential`（或后续提供单独签发按钮）。

---

## 13. 数据库边界：哪些需要存，哪些不需要存

### 13.1 不需要存数据库（链上真相）

- ERC20 `allowance`
- ERC20 `balanceOf`（可选只做展示）

理由：链上数据天然可验证，前端应实时读取，不应维护二份状态避免偏差。

### 13.2 需要存数据库（平台业务真相）

- `agent_credentials`：凭据状态、过期时间、配额。
- `deposit_intents`：充值确认流水（pending/confirmed/failed）。
- `balance_ledger / buyerBalance`：可消费余额账本。

理由：这些是平台业务状态，必须支持审计、恢复和跨端一致。

---

## 14. Router 页面最终验收标准（Shared Credential 模式）

1. 刷新页面后，3 条 setup 状态自动恢复，不依赖本地内存。
2. 用户无需手动选择 serviceId。
3. 支付成功后可生成 owner 级共享凭据，并可用于所有 buyer agents。
4. 页面明确给出“是否可调用”的最终结论。
5. 当用户未完成任一步骤时，页面能指示下一动作。

---

## 15. Auth Token 与登录状态展示设计 ("Shell First" 渐进式展开)

### 15.1 设计理念：信任感拉满，优雅降级
不要一开始就用“全屏铁墙（WalletAuthGuard）”把用户挡在门外。我们希望用户在**未连接钱包**或**登录态（Token）过期**时，依然能看到 Dashboard 的“壳子”（导航、页面结构、说明文案），只在真正需要敏感数据的地方进行“局部遮罩（Glassmorphism Blur）”引导授权。

### 15.2 状态矩阵与 UI 响应

我们把状态分为两层：
1. **Wallet Connected** (Wagmi 状态) - 是否连接了钱包。
2. **Session Authenticated** (Backend Token) - 是否有有效的 EIP-4361 签名登录态。

| 钱包状态 | 登录态 (Token) | UI 展示表现 | 行为引导 |
| :--- | :--- | :--- | :--- |
| ❌ 未连接 | ❌ 无/过期 | **展示页面框架**。敏感数据（如 API Key 列表、余额、调用流水）使用高斯模糊（Blur）遮罩。右上角显示 `Connect Wallet`。 | 点击遮罩层上的按钮，弹出 `Connect Wallet`，然后连带触发 `Sign to Verify`。 |
| ✅ 已连接 | ❌ 无/过期 | **展示页面框架**。右上角显示钱包地址，但数据区依然被 Blur 遮罩。因为只能读链上数据，无法调后端 API。 | 遮罩层提示 `Session Expired`，提供 `Sign in to view data` 按钮触发签名更新 Token。 |
| ✅ 已连接 | ✅ 有效 | **完全展示**。所有私密数据正常加载，右上角正常显示连接状态。 | 正常使用。 |

### 15.3 局部组件级遮罩 (Glassmorphism Blur) 规范
- **视觉层面**: 对于 `Buyer Console`, `Developer Console`, `Billing` 等页面的核心数据区域（如 Table, Card 列表），在无 Token 时渲染真实组件结构但叠加一层 `backdrop-blur-sm` 的磨砂玻璃效果层。
- **文案提示**: 在磨砂层中央放置醒目提示框：
  - 未连钱包时：`Connect your wallet to manage API keys and view credentials.`
  - 已连钱包未签名时：`Please sign the message to verify your identity and view your data.`
- **操作闭环**: 遮罩层上的按钮直接触发对应的 Wallet Modal 或 Signature Modal，完成后自动刷新当前组件数据。

### 15.4 技术实现重构方向
废除原有的全局阻断式 `WalletAuthGuard`（单纯的 `if (!isAuthenticated) return <ConnectWall />`），改为提供 `AuthContext` 状态给各个内部组件。由具体的业务组件（如 `ApiKeyList`, `BalanceCard`）根据当前认证状态决定是渲染真实数据还是渲染“遮罩层”。