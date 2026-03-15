# 卖家收益提现（Seller Withdrawal）生产级设计

## 1. 目标与边界

本设计用于 Provider 在赚取收益后进行提现，遵循以下硬约束：

- 卖家自己发起链上交易并承担 Gas。
- 网关只负责离链账本结算与 EIP-712 票据签发，不代付 Gas。
- 提现必须金融级安全：
  - 幂等（同一请求不重复执行）
  - 防重放（链上 nonce + deadline）
  - 防重复提现（离链锁仓 + 单 PENDING 票据）
  - 可审计（全链路审计日志）

## 2. 核心流程

### Step 1: 卖家创建提现意图（离链）

前端调用：`POST /api/v1/providers/withdrawals/intent`。

- Header 必须包含 `X-Idempotency-Key`。
- 请求金额 `amountUsdc` 可选：
  - 为空表示“全额提现当前可用应收”
  - 非空则必须满足 `0 < amountUsdc <= sellerReceivable`

网关在同一临界区完成：

1. 校验 owner 会话与请求合法性。
2. 校验同 owner 当前不存在其他 `PENDING` 提现单。
3. 从 `balance_ledger.sellers[owner]` 扣减并锁定到 `balance_ledger.sellersLocked[owner]`。
4. 读取链上 `userNonces(owner)`，拼装 EIP-712 Withdraw 结构并签名。
5. 写入 `provider_withdrawal_intents`，状态 `PENDING`。

### Step 2: 卖家钱包发链上提现（卖家付 Gas）

前端用票据调用 `SynapseCore.withdraw(amount, fee, nonce, deadline, signature)`。

- 交易由卖家钱包签名并广播。
- Gas 费用由卖家支付。
- 合约层校验：
  - `deadline` 未过期
  - `nonce == userNonces[msg.sender]`
  - `signature` 由平台 signer 签发

### Step 3: 回执完成（离链）

交易上链成功后，前端调用：
`POST /api/v1/providers/withdrawals/{withdrawalId}/complete`

- 请求体：`{ txHash }`
- 网关更新提现单状态为 `COMPLETED`。
- 原子释放锁仓：`sellersLocked[owner] -= amountUsdc`。
- 写入审计日志（withdrawalId、txHash、amount、owner、时间）。

## 3. 状态机

- `PENDING`：票据已签发，离链应收已锁仓，等待链上提现。
- `COMPLETED`：链上提现成功并完成回执，锁仓已释放。

当前版本禁止同 owner 同时存在多个 `PENDING` 提现单，避免并发双提风险。

## 4. 幂等与防重放策略

### 4.1 API 幂等

- `POST /intent` 使用 `X-Idempotency-Key` + 请求哈希。
- 同 key 同 payload：返回同一逻辑结果。
- 同 key 不同 payload：返回 `409`。

### 4.2 链上防重放

- 票据包含 `nonce` 与 `deadline`。
- 合约严格校验 `userNonces[msg.sender]`。
- 使用过的 nonce 自动递增，旧票据不可重复使用。

### 4.3 离链防重复提现

- 创建提现意图时先锁定应收（`sellers -> sellersLocked`）。
- owner 仅允许一个 `PENDING` 提现单。
- 完成接口对 `COMPLETED` 状态做幂等保护，不可重复核销不同 txHash。

## 5. 金融级安全要点

- 默认拒绝：提现接口要求有效 session 与 owner 绑定。
- 最小权限：只允许 owner 操作自己的提现单。
- 严格输入校验：金额边界、txHash 格式、idempotency key 规则。
- 原子记账：所有余额迁移在锁内执行，避免并发超提。
- 审计可追踪：记录 `PROVIDER_WITHDRAW_INTENT_CREATED` 与 `PROVIDER_WITHDRAW_COMPLETED`。
- 错误最小披露：对外返回业务错误码，不泄露内部堆栈。

## 6. 前后端契约

### 6.1 创建提现意图

- 请求：`POST /api/v1/providers/withdrawals/intent`
- Header：`Authorization`、`X-User-Address`、`X-Idempotency-Key`
- Body：`{ "amountUsdc": 12.5 }`（可选）
- 返回：

```json
{
  "status": "success",
  "ownerAddress": "0x...",
  "withdrawalId": "uuid",
  "status": "PENDING",
  "amountUsdc": 12.5,
  "ticket": {
    "amount": "12500000000000000000",
    "fee": "0",
    "nonce": 3,
    "deadline": 1774000000,
    "signature": "0x...",
    "chainId": 31337,
    "contractAddress": "0x..."
  }
}
```

### 6.2 查询提现列表

- 请求：`GET /api/v1/providers/withdrawals`
- 返回：owner 作用域内提现记录（按创建时间倒序）。

### 6.3 完成提现

- 请求：`POST /api/v1/providers/withdrawals/{withdrawalId}/complete`
- Body：`{ "txHash": "0x..." }`
- 返回：

```json
{
  "status": "success",
  "ownerAddress": "0x...",
  "withdrawalId": "uuid",
  "status": "COMPLETED",
  "txHash": "0x..."
}
```

## 7. 前端交互要求

Provider Settlements 页面必须满足：

- 显示可提现余额（`sellerReceivable`）。
- 创建 ticket 后立即拉起钱包 `withdraw`。
- 显示 `PENDING/COMPLETED` 提现历史。
- 当存在 `PENDING` 时，阻断创建新 ticket，仅允许 `Resume Pending`。
- UI 明确提示“卖家承担链上 Gas”。

## 8. 测试覆盖

后端单元测试必须覆盖：

- 创建提现意图成功并锁仓。
- 同 idempotency key 重放返回同结果。
- 存在 PENDING 时创建新提现被拒绝。
- 完成提现后状态变更与锁仓释放。
- 已完成提现再次完成（不同 txHash）被拒绝。
