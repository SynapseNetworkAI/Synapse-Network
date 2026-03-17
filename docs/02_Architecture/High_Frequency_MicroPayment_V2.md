# Build-for-Agent High Frequency Micropayment V2

> 目标：让 `Owner 入金 -> Agent 自主付费调用 -> Provider 收益沉淀 -> Owner 以 Provider 角色提现` 成为一条统一、低摩擦、可审计的资金与执行主路径。

## 1. 一句话架构

Synapse 的核心范式是：

1. `Owner` 把 USDC 充进链上 Vault。
2. `Platform Gateway` 在链下维护 append-only 账本与预算边界。
3. `Agent` 在预算内自主完成 Discovery / Quote / Invoke。
4. `Provider` 交付服务结果并累积 receivable。
5. `Owner` 在 Provider 工作区里发起收益提现，平台对提现做风控和审核。

这套设计不追求“每次调用都上链付款”，而追求：

1. 高频调用不碰链。
2. 资金托管在链上。
3. 账务结论在 PostgreSQL 账本中原子落地。
4. 提现和退款统一走受控出金通道。

## 2. 角色与资金边界

### 2.1 Owner

Owner 是根租户身份，负责：

1. 连接钱包并建立 session。
2. 向 Vault 入金。
3. 创建 Agent Profile 与 Credential。
4. 配置 Budget Policy。
5. 进入 Provider Workspace 运营服务和申请收益提现。

### 2.2 Agent

Agent 是运行时主体，负责：

1. 发现服务。
2. 请求报价。
3. 发起调用。
4. 消耗 Owner 授权给它的预算。

### 2.3 Provider

Provider 不是独立账户体系，而是 Owner 的供给侧业务角色，负责：

1. 注册 Service Manifest。
2. 声明定价、输入输出契约、健康探测路径。
3. 交付真实服务结果。
4. 查看累计收益并申请提现。

### 2.4 Platform

Platform 是系统执行层，负责：

1. 鉴权与 owner binding。
2. 预算校验、限流、预扣费、回滚。
3. Provider 路由、健康探测、防绕过认证。
4. append-only 账本、审计、风控、清算。

## 3. 账本模型

目标态账本不再用“账户情绪角色”记账，而用 `owner + bucket + business event` 记账。

统一资金桶：

1. `consumer_available`
2. `consumer_pending`
3. `consumer_frozen`
4. `provider_receivable`
5. `provider_locked`
6. `platform_fee`

统一业务事件：

1. `deposit_registered`
2. `deposit_confirmed`
3. `invoke_reserved`
4. `invoke_captured`
5. `refund_requested`
6. `refund_completed`
7. `provider_earning_accrued`
8. `provider_withdraw_requested`
9. `provider_withdraw_reviewed`
10. `provider_withdraw_completed`

## 4. 主流程

### 4.1 Owner 入金

1. Owner 在前端完成 Permit 或等价签名授权。
2. Vault 合约接收 USDC，链上发出 Deposit 事件。
3. Gateway Indexer 识别唯一 `tx_hash`，把金额先记入 `consumer_pending`。
4. 达到确认阈值后，再把金额从 `consumer_pending -> consumer_available`。

### 4.2 Agent 自主付费调用

1. Agent 带着 `Agent Credential` 发起 Discovery / Quote / Invoke。
2. Gateway 基于 owner scope、credential 状态、budget policy、service policy 做校验。
3. 平台先做预算预占或价格确认，再执行上游调用。
4. 调用成功后，一次事务内完成：
   - `consumer_available` 扣减
   - `provider_receivable` 增加
   - `platform_fee` 增加
   - invocation / ledger / audit 一次性落库
5. 调用失败则释放预占，不允许留下半笔账。

### 4.3 Provider 收益沉淀

1. Provider 真实交付后，收益先沉淀到 `provider_receivable`。
2. 这笔钱仍然处于平台账本控制下，不会立即链上转出。
3. Provider Workspace 展示的是 receivable、withdrawable、locked、review status，而不是一条裸余额。

### 4.4 Owner 以 Provider 角色提现

1. 同一个 Owner 进入 Provider Workspace 发起提现。
2. 平台只允许从 `provider_receivable` 或 `provider_locked` 相关桶出金，不触碰消费侧桶。
3. 风控引擎根据金额、频率、账户年龄、净收入沉淀、地址风险、流动性状态给出 `green / yellow / red` 决策。
4. `green` 走自动签发，`yellow` 进入人工审核，`red` 直接拒绝并告警。

## 5. 为什么同一个 Owner 可以同时消费和供给

因为平台看的是账本桶，不是“这个钱包此刻像不像调用方”。

同一个 Owner 可以同时拥有：

1. Agent / Consumer Workspace
2. Provider Workspace
3. 多个 Agent Runtime

只要三件事是分离的，就不会打架：

1. `owner scope` 一致
2. `ledger bucket` 分离
3. `business action` 明确

## 6. 核心工程铁律

1. 合约只做 Vault，不做高频预算和并发控制。
2. 高频结算必须在后端事务中完成，不能靠内存快照拼装。
3. 任何资金变动都必须伴随 ledger entry + audit event。
4. 幂等键、唯一索引、行级锁、风控状态必须同时存在。
5. Provider 提现不是“余额导出”，而是受风控和流动性约束的出金动作。

## 7. 设计结论

build-for-agent 的北极星不是“让人类点更多按钮”，而是让 Agent 在 Owner 授权边界内完成首次自主付费调用，同时让 Provider 收益、退款、审计、提现全部回到同一套 Owner-rooted 账务体系。
