# Consumer Withdrawal and Risk Gates

## 1. 目标

Consumer Withdrawal 链路定义 Owner（买家）如何把**未消费的预存 USDC** 提回自己的链上钱包。

这条链路与 Provider Withdrawal（05 号文档）并行存在，但严格隔离：
- 资金来源：`consumer_wallet` 账户，不得碰 `provider_wallet`
- 出金依据：未被消耗的 `available_balance`（即充值进来扣减掉 API 消费费用后剩余部分）
- 风控规则：独立一套，阈值可配置

## 2. 参与者

| 参与者 | 职责 |
| --- | --- |
| `Owner (Consumer Role)` | 发起提现申请，链上执行 `SynapseCore.withdraw()` |
| `Platform Gateway` | 风控校验、余额冻结、幂等控制、EIP-712 签票、记录存储 |
| `SynapseCore` (Vault Contract) | 链上出金执行：验证 EIP-712 签名，转 USDC 给用户，收取平台费 |
| `Background Event Watcher` | 安全网：监控链上 `WithdrawInfo` 事件，自动补全遗漏的 COMPLETED 状态 |
| `PostgreSQL` | 持久化余额变更、提现记录、审计事件 |

## 3. 核心表

| 表 | 作用 |
| --- | --- |
| `synapse_account_balances` | 保存 `available_balance / pending_balance / frozen_balance` |
| `synapse_ledger_accounts` | 定义 consumer_wallet 账户，关联 owner |
| `synapse_vault_withdrawals` | 提现主记录（`withdrawal_kind = 'consumer_refund'`）|
| `synapse_runtime_state` | 存储 `refundType = CONSUMER_BALANCE_WITHDRAW` 等元数据 |
| `synapse_audit_events` | 保存审计链 |

## 4. 状态机

```
REQUESTED                    ← 小额自动通过（< threshold）
PENDING_MANUAL_REVIEW        ← 大额或频率超限，人工审核
REJECTED                     ← 人工拒绝，资金归还 available
COMPLETED                    ← 出金已完成
CANCELLED                    ← 已超时或手动取消，资金归还 available
```

**REQUESTED** 下资金：`available -= amount`, `pending += amount`
**PENDING_MANUAL_REVIEW** 下资金：`available -= amount`, `frozen += amount`

## 5. 风险三段阀门

### 5.1 第一段：业务资格阀门

| 检查项 | 条件 |
| --- | --- |
| 连接钱包 | `isConnected = true` |
| 已签名会话 | JWT / wallet session 有效 |
| 账户存在 | `consumer_wallet` 账户已建立 |
| 余额充足 | `consumer_available_balance >= amountUsdc` |
| 最小金额 | `amountUsdc >= CONSUMER_WITHDRAW_MIN_USDC` (默认 $1) |

### 5.2 第二段：频率与幂等阀门

| 检查项 | 规则 |
| --- | --- |
| 24h 日限额 | 同一钱包 24 小时内最多 `CONSUMER_WITHDRAW_MAX_DAILY_COUNT` 笔（默认 3） |
| 幂等保护 | 相同 `X-Idempotency-Key` + `request_hash` → 返回缓存响应，不重复扣款 |
| 活跃单保护 | 已有 REQUESTED / PENDING_MANUAL_REVIEW 状态的单 → 直接返回已有记录，不重复扣款 |

### 5.3 第三段：金额阈值阀门（**可配置**）

| 条件 | 结果 |
| --- | --- |
| `amount < CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC` | `status = REQUESTED`（自动通过）|
| `amount >= CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC` | `status = PENDING_MANUAL_REVIEW`（人工审核）|
| `daily_count >= CONSUMER_WITHDRAW_MAX_DAILY_COUNT` | `status = PENDING_MANUAL_REVIEW`（频率超限）|

> **可配置入口：** 环境变量 `CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC`（默认 500），
> 运行时通过 `finance_constants.py` 注入，无需重新部署代码，只需重启 Gateway。

## 6. 资金锁仓规则

提现**必须先锁仓**，再记录意图：

```
自动通过单：
  available_balance -= amount
  pending_balance   += amount

人工审核单：
  available_balance -= amount
  frozen_balance    += amount
```

锁仓通过单笔 SQL 原子 UPDATE（`WHERE available_balance >= amount`）完成，
若并发写导致余额低于请求金额，UPDATE 行数为 0，立即抛出 `INSUFFICIENT_CONSUMER_BALANCE_ATOMIC`。

**已冻结 / pending 的余额不计入 `consumer_available_balance`，因此：**
- 不能再用于 API 消费计费
- 不能被二次提现
- 不能被任何其他出金路径消耗

## 7. 主流程

> **统一 Withdraw 模型**：Consumer 和 Provider 提现复用同一条链上路径 `SynapseCore.withdraw()`。
> Gateway 签发 EIP-712 票据（含手续费），前端执行链上交易，用户付 gas。

```mermaid
sequenceDiagram
    participant U as Owner (Consumer)
    participant FE as Frontend
    participant GW as Gateway API
    participant DB as PostgreSQL
    participant SC as SynapseCore (Chain)

    U->>FE: Click "Withdraw"
    FE->>GW: POST /api/v1/balance/consumer/withdraw\n{amountUsdc, reason}
    GW->>DB: Check consumer_available_balance
    GW->>DB: Check active withdrawals (idempotency)
    GW->>DB: Classify risk (auto / manual)
    GW->>DB: ATOMIC UPDATE: available -= amount, pending += amount
    GW->>DB: INSERT synapse_vault_withdrawals (status=REQUESTED)
    GW->>GW: Sign EIP-712 Withdraw ticket\n(amount=net, fee=fee, nonce, deadline)
    GW-->>FE: {status, ticket: {amount, fee, nonce, deadline, signature, chainId, contractAddress}}

    FE->>SC: SynapseCore.withdraw(amount, fee, nonce, deadline, signature)\n(msg.sender = Owner, Owner pays gas)
    SC->>SC: Verify EIP-712 signature (platformSigner)
    SC->>SC: userNonces[user]++ | platformFeePool += fee
    SC->>U: safeTransfer(USDC, amount) → Owner wallet
    SC-->>FE: tx confirmed (WithdrawInfo event)

    FE->>GW: POST /api/v1/refunds/{withdrawId}/complete\n{txHash}
    GW->>DB: UPDATE status=COMPLETED, pending -= amount, txHash
    GW-->>FE: 200 OK

    FE->>FE: 300ms delay (DB write settle)
    FE->>GW: GET /api/v1/balance
    GW-->>FE: {ownerBalance: 更新后余额}
    FE->>U: 更新余额显示

    Note over GW,SC: 安全网：Background Event Watcher 扫描<br/>WithdrawInfo 事件，补全遗漏的 COMPLETED

    alt status = PENDING_MANUAL_REVIEW
        Note over GW,DB: 人工审核路径
        GW->>DB: APPROVE → frozen -> pending → 签发 ticket
        GW->>DB: REJECT  → frozen -> available → REJECTED
    end
```

### 7.1 手续费模型

| 项目 | 值 |
| --- | --- |
| `CONSUMER_WITHDRAW_FEE_USDC` | 0.50 (默认) |
| 合约处理 | `amount` (净额) 转给用户，`fee` 累加到 `platformFeePool` |
| gas 费 | 用户自付（`msg.sender = Owner`） |

合约视角：`withdraw(net_wei, fee_wei, nonce, deadline, sig)`
- `safeTransfer(msg.sender, net_wei)` → 用户收到净额
- `platformFeePool += fee_wei` → 平台手续费留在合约内
- Vault 总减少 = `net_wei`（fee 不离开合约，仅重新分配）

### 7.2 Background Event Watcher（安全网）

`consumer_withdraw_processor.py` 不再直接执行链上交易。改为 **事件监听器**：

1. 每 10 秒扫描 REQUESTED 状态的消费者提现记录
2. 检查链上 `userNonces[owner]` 是否已超过 ticket nonce
3. 扫描 `WithdrawInfo(user, amount, fee)` 事件匹配
4. 找到匹配 → 自动标记 COMPLETED（含 txHash）

这覆盖了"前端在链上交易成功后崩溃，未调用 /complete"的极端场景。

## 8. 为什么提现后 UI 余额没有变化

**根本原因（已修复，commit `a4aecc77`）：**

1. `onSuccess` prop 类型是 `() => void`，但传入的是 async 函数
2. `handleSubmit` 调用 `onSuccess()` 时**没有 `await`**
3. 导致：modal 关闭时 `handleRefresh()` 根本没有被执行，页面余额停留在旧值

**修复内容：**

```tsx
// 修复 1：类型改为 () => Promise<void>
type WithdrawModalProps = {
  onSuccess: () => Promise<void>;
  ...
};

// 修复 2：加上 await
await onSuccess();
onClose();

// 修复 3：父组件加 300ms 等待让 DB 写入沉淀
onSuccess={async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  await Promise.all([handleRefresh(), fetchSpendingLimit()]);
}}
```

**数据流（修复后）：**

```
handleSubmit
  → requestConsumerWithdraw() → POST /api/v1/balance/consumer/withdraw
  → Platform: reserve_consumer_balance_for_withdrawal()
       SQL: available_balance = 0, pending_balance = 20
  → await onSuccess()
       → 300ms
       → handleRefresh()
            → getV2Balance() → GET /api/v1/balance
                 → read_balance_ledger() → SQL SELECT
                 → returns ownerBalance = 0
       → setStats({ ownerBalance: "0.00" })
  → UI 显示 $0.00
```

## 9. 提现记录在 Billing 页的显示

`useFundsData` hook 从两个来源合并记录到 Payments 表：

1. `listDepositIntents()` → 充值记录 (type = Deposit)
2. `listConsumerWithdrawals()` → 提现记录 (type = Withdraw)

提现记录的 `type` 字段通过 `typeLabelForRecord(row.type)` 映射为带颜色标签：

| type | 显示文字 | 颜色 |
| --- | --- | --- |
| `CONSUMER_BALANCE_WITHDRAW` | Withdraw | 橙色 |
| `SYSTEM_FAILURE` / `MANUAL_APPEAL` | Refund | 蓝色 |
| Claim | Claim | 紫色 |
| 其他 | Deposit | 绿色 |

## 10. 配置参数速查

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `CONSUMER_WITHDRAW_MIN_USDC` | 1.0 | 最小提现金额 (USDC) |
| `CONSUMER_WITHDRAW_FEE_USDC` | 0.50 | 平台手续费 (USDC)，从提现金额中扣除 |
| `CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC` | 500.0 | 超过此金额进人工审核 |
| `CONSUMER_WITHDRAW_MAX_DAILY_COUNT` | 3 | 24h 内最大提现次数 |
| `CONSUMER_WITHDRAW_PROCESSOR_INTERVAL_SEC` | 10.0 | 后台事件监听器扫描间隔 |

这些参数通过环境变量覆盖，无需代码变更。

## 11. 安全保障

| 威胁 | 防护手段 |
| --- | --- |
| 余额超提 | 原子 SQL UPDATE + `WHERE available >= amount` |
| 并发双花 | 互斥锁 `_mutation_lock.lock(f"{owner}:consumer_withdraw_intent")` |
| 重复提交 | Redis 幂等 + 活跃单保护（双重）|
| 大额快速出金 | 金额阈值 + 日频次限制 → PENDING_MANUAL_REVIEW |
| consumer 余额混用 | withdrawal_kind 强隔离，consumer 与 provider 路径完全独立 |
| 伪造签名 | 合约验证 `ECDSA.recover(hash, signature) == platformSigner` |
| 重放已用票据 | 合约 `userNonces[msg.sender]++` 强制递增，每张票仅能用一次 |
| 过期票据 | `require(block.timestamp <= deadline)` — 默认 15 分钟有效期 |
| 平台私钥泄露 | 二方协作：即使 signer key 泄露，攻击者仍需用户钱包私钥（msg.sender）才能执行 |

## 12. 文档结论

Consumer withdrawal 正确顺序：

**资格校验 → 频率/幂等校验 → 余额原子锁仓 → 创建意图记录 + EIP-712 签票 → 前端链上执行 → /complete 回调 → UI 刷新 → 审计闭环**

与 Provider withdrawal 的关系：
- **复用同一条链上路径**：`SynapseCore.withdraw()` — EIP-712 签名验证，用户执行
- 资金来自 `consumer_wallet` 而非 `provider_wallet`
- 风控阈值、日限额独立配置
- 手续费：Consumer 0.50 USDC / Provider 0 USDC（可分别配置）
- 安全模型：Gateway（platformSigner）签票 + User（msg.sender）执行，二方协作安全
