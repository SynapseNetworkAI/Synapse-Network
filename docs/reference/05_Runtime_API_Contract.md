# Runtime API Contract

- Status: canonical
- Code paths: `gateway/src/`, `gateway/tests/`, `apps/frontend/src/`, `sdk/python/`
- Verified with: `npm run ci:gateway`, `npm run ci:sdk-python`, `npm run ci:frontend`, `npm run ci:docs`
- DB sources: `docs/04_Database_Design/`, `docker-compose/postgres/init/gateway/001_synapse_schema.sql`
- Supersedes: `docs/api.md`
- Last verified against code: `2026-04-01`

> 核心定位：这是面向 build-for-agent Runtime 的平台 API 合约总表，不再按旧控制台角色或旧字段命名组织。

## 1. API 分类

### 1.1 Authentication APIs

1. `GET /api/v1/auth/challenge`
2. `POST /api/v1/auth/verify`
3. `POST /api/v1/auth/logout`
4. `GET /api/v1/auth/me`
5. `POST /api/v1/auth/me/profile/challenge`
6. `PUT /api/v1/auth/me/profile`

### 1.2 Owner Session Business APIs

1. `GET /api/v1/balance`
2. `POST /api/v1/balance/deposit/attempts`
3. `POST /api/v1/balance/deposit/intent`
4. `GET /api/v1/balance/deposit/intents`
5. `POST /api/v1/balance/consumer/withdraw` ← consumer 提现剩余余额
6. `GET /api/v1/balance/consumer/withdrawals` ← consumer 提现记录
7. `POST /api/v1/refund`
8. `GET /api/v1/refunds`
7. `GET /api/v1/usage/logs`
8. `POST /api/v1/providers/withdrawals/intent`
9. `GET /api/v1/providers/withdrawals/capability`
10. `GET /api/v1/providers/withdrawals`
11. `POST /api/v1/providers/withdrawals/{withdrawalId}/complete`
12. `POST /api/v1/admin/providers/withdrawals/{withdrawalId}/review`
13. `GET /api/v1/router/config`
14. `POST /api/v1/router/config`
15. `GET /api/v1/finance/audit-logs`
16. `GET /api/v1/balance/spending-limit`
17. `PUT /api/v1/balance/spending-limit`
18. `POST /api/v1/balance/vouchers/redeem`
18. `GET /api/v1/admin/fee-policy`
19. `PUT /api/v1/admin/fee-policy`
20. `POST /api/v1/admin/deposits/replay`
21. `GET|POST|PUT|DELETE /api/v1/services*` except public discover

### 1.3 Public or Runtime APIs

1. `GET /api/v1/services/discover`
2. `GET /api/v1/services/network-stats`
3. `POST /api/v1/services/quote`
4. `POST /api/v1/gateway/generate`
5. `GET /api/v1/indexer/status`

### 1.4 Runtime timeout profiles

Gateway 同步调用按 service profile 执行 bounded timeout：

1. 普通 API：`GATEWAY_DEFAULT_TIMEOUT_MS=15000`，`GATEWAY_MAX_TIMEOUT_MS=60000`。
2. LLM / token-metered：`GATEWAY_LLM_DEFAULT_TIMEOUT_MS=120000`，`GATEWAY_LLM_MAX_TIMEOUT_MS=300000`。
3. `timeoutMs=0` 禁止表示无限等待；注册和运行时都会拒绝或 clamp。
4. 大模型响应超过 5 分钟的场景必须走 async invocation / callback，不能继续扩大同步 HTTP timeout。
5. Streaming LLM V1 仍然不支持，因为 Gateway 必须拿到 final usage 才能安全计费。

## 2. Identity Semantics

统一身份原则：

1. `Owner` 是 session 根身份。
2. `Agent Credential` 是 Runtime 调用凭据。
3. `Provider` 是 Owner 的供给侧业务角色，不是另一套根账户。
4. 同一个 Owner 可以同时拥有消费侧资金桶和供给侧收益桶。

## 3. Finance API Semantics

### 3.0 `GET /api/v1/auth/me`

返回当前 Owner wallet 绑定的控制面 profile。

返回字段：

1. `ownerAddress`
2. `displayName`
3. `email`
4. `emailVerified`
5. `notifyMarketing`
6. `notifyAlerts`
7. `createdAt`
8. `updatedAt`

语义：

1. 如果当前 wallet 还没有 `synapse_owner_accounts` 行，Gateway 会先补一个 shell row 再返回 profile
2. `displayName` / `email` 都允许为空，不阻断支付主链

### 3.0.1 `POST /api/v1/auth/me/profile/challenge`

用途：为当前 Owner profile 更新生成一次性的 wallet 签名 challenge。

请求体：

1. `displayName`
2. `email`
3. `notifyMarketing`
4. `notifyAlerts`

返回字段：

1. `challenge`
2. `expiresInSec`

语义：

1. challenge 绑定 `owner wallet + profile payload hash + nonce + timestamp`
2. 后续 `PUT /api/v1/auth/me/profile` 必须提交同一 payload 和 challenge 的签名

### 3.0.2 `PUT /api/v1/auth/me/profile`

用途：把账户名称、邮箱和通知偏好绑定到当前 Owner wallet。

请求体：

1. `displayName`
2. `email`
3. `notifyMarketing`
4. `notifyAlerts`
5. `message`
6. `signature`

语义：

1. Gateway 必须重新验证这次 profile update 的 wallet signature，而不是只信 JWT
2. 如果 `email` 被修改，`emailVerified` 会被重置为 `false`
3. `email` 必须在全平台唯一
4. 新增或变更邮箱会异步发送 `email_verification` 邮件；保存设置本身不发送“保存成功”邮件
5. `GET /api/v1/auth/email/verify?v=<signed-token>` 验证邮箱后将 `emailVerified` 更新为 `true`
6. 资金类交易邮件只发送给已验证邮箱；该接口会写 system audit log，但不会影响 credits、deposit、invoke 等核心支付链路

### 3.1 `GET /api/v1/balance`

返回当前 Owner 的余额摘要。

目标态语义：

1. `consumerAvailableBalance`
2. `consumerPendingBalance`
3. `consumerFrozenBalance`
4. `providerReceivableBalance`
5. `providerLockedBalance`
6. `platformFeeAccrued`

如果实现中仍保留历史字段名，应视为兼容层细节，不改变这里的业务语义。

### 3.2 `POST /api/v1/balance/deposit/intent`

用途：登记 Owner 向 Vault 的入金事实。

约束：

1. 要求 `X-Idempotency-Key`
2. 要求唯一 `txHash`
3. 先进入 `PENDING_CONFIRMATION`
4. 资金先进入 `consumer_pending`
5. 确认后才转 `consumer_available`
6. 同一 `txHash` 在 replay-protection window 内重复提交时，返回已存在的 intent，保持稳定业务结果

### 3.2.1 `GET /api/v1/balance/deposit/sync?txHash=...`

这是前端轮询充值同步状态的只读接口。

返回约定：

1. `found = false`：后端当前还没看到这个 `owner + txHash` 的 deposit intent
2. `found = true, status = PENDING_CONFIRMATION`：后端已同步到 intent，但还没确认到账
3. `found = true, status = CONFIRMED`：后端已确认到账，可以刷新余额
4. `canRefreshBalance = true` 只在 `CONFIRMED` 时返回 true

核心字段：

1. `txHash`
2. `found`
3. `synced`
4. `status`
5. `confirmed`
6. `canRefreshBalance`
7. `depositIntentId`
8. `amountUsdc`
9. `creditedAmountUsdc`
10. `confirmations`
11. `eventKey`
12. `confirmedAt`
13. `updatedAt`

### 3.2.2 `POST /api/v1/balance/consumer/withdraw`

用途：Consumer 将账户中未消费的剩余预充值余额提现回自己的链上钱包。

> **关键区分**：本接口是提现剩余押金（unused deposit），与 `POST /api/v1/refund`（对单次调用发起争议退款）完全不同，**不需要 `originRequestId`**。

Headers:
- `Authorization: Bearer <token>` — 必须
- `X-Wallet-Address: <ownerAddress>` — 必须
- `X-Idempotency-Key: <uuid-or-hash>` — 必须（幂等保护）

请求体：

```json
{
  "amountUsdc": 9.95,
  "reason": "optional freeform reason (max 256 chars)"
}
```

返回字段：

1. `withdrawId` — 本次提现记录 ID
2. `amountUsdc` — 实际请求提现金额
3. `status` — 当前状态：`REQUESTED`（正常）| `PENDING_MANUAL_REVIEW`（需人工审核）
4. `riskLevel` — `green` | `yellow` | `red`
5. `riskReasonCode` — 风险原因码（green 时为空字符串）
6. `message` — 人类可读消息
7. `destination` — 目标地址（始终为 owner 自己的钱包）

风险规则：

| 条件 | riskLevel | status |
|---|---|---|
| 正常（≤ $500，24h 内 < 3 次）| `green` | `REQUESTED` |
| 金额 ≥ $500 USDC | `yellow` | `PENDING_MANUAL_REVIEW` |
| 24h 内已提现 3 次 | `red` | `PENDING_MANUAL_REVIEW` |

安全约束：

1. `amountUsdc` 不得超过当前 `consumerAvailableBalance`，否则返回 `400 INSUFFICIENT_CONSUMER_BALANCE`
2. 资金只能打回 owner 自己的钱包，不允许重定向到第三方地址
3. 幂等键（`X-Idempotency-Key`）在有效期内重复提交返回相同结果，不重复扣减余额
4. 最小提现金额：1.0 USDC

### 3.2.3 `GET /api/v1/balance/consumer/withdrawals`

用途：查询当前账户的所有提现记录（分页，最新优先）。

查询参数：`limit`（默认 50，最大 200）

返回字段：

1. `status` — `"success"`
2. `ownerAddress` — owner 钱包地址
3. `withdrawals` — 提现记录数组，每条包含 `withdrawId`, `amountUsdc`, `status`, `riskLevel`, `riskReasonCode`, `createdAt`

### 3.3 `POST /api/v1/refund`

用途：从当前 Owner 的消费侧余额发起退款。

约束：

1. 仅作用于消费侧资金桶
2. 必须绑定 origin request 或 origin tx
3. 默认退回 owner 原地址
4. 大额或异常拆分进入人工审核

### 3.4 `GET /api/v1/balance/spending-limit`

返回当前 Owner 的账户级 billing-cycle spend cap。

返回字段：

1. `ownerAddress`
2. `spendingLimitUsdc`
3. `allowUnlimited`
4. `cycleInterval`，当前固定为 `monthly`
5. `currentCycleSpendUsdc`
6. `remainingSpendUsdc`
7. `updatedAt`

### 3.5 `PUT /api/v1/balance/spending-limit`

用途：设置或清空当前 Owner 的账户级 billing-cycle spend cap。

请求体：

1. `spendingLimitUsdc`，当 `allowUnlimited = false` 时必填，且必须大于 0
2. `allowUnlimited`

语义：

1. `allowUnlimited = false` 时，Gateway 会把当前 Owner 的 monthly spend cap 持久化到 `synapse_owner_spend_limits`
2. `allowUnlimited = true` 时，Gateway 会把 `spendingLimitUsdc` 清空为 `NULL`
3. Runtime quote / invocation 都会读取同一份 Owner spend cap

### 3.5.1 `POST /api/v1/balance/vouchers/redeem`

用途：把 free-credit voucher 核销到当前 Owner 的消费侧余额。

请求头：

1. 必须携带 `X-Idempotency-Key`

请求体：

1. `voucherCode`，支持 `XXXX-XXXX-XXXX` 或 12 位紧凑字母数字格式

成功返回：

1. `redemption`
2. `balance`

`redemption` 字段：

1. `redemptionId`
2. `voucherCodeId`
3. `campaignId`
4. `campaignCode`
5. `campaignDisplayName`
6. `voucherCodeLast4`
7. `grantedAmountUsdc`
8. `ownerAddress`
9. `ledgerEntryId`
10. `targetAccountId`
11. `promoAccountId`
12. `status`
13. `beforeBalanceUsdc`
14. `afterBalanceUsdc`
15. `redeemedAt`

错误语义：

1. `INVALID_VOUCHER_CODE`
2. `VOUCHER_ALREADY_REDEEMED`
3. `VOUCHER_EXPIRED`
4. `VOUCHER_CAMPAIGN_INACTIVE`
5. `VOUCHER_CAMPAIGN_EXHAUSTED`
6. `OWNER_NOT_ELIGIBLE`
7. `OWNER_REDEMPTION_LIMIT_EXCEEDED`
8. `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`

### 3.6 `POST /api/v1/providers/withdrawals/intent`

用途：当前 Owner 在 Provider Workspace 发起收益提现。

约束：

1. 仅作用于 `provider_receivable`
2. 同一个 Owner 的退款与提现可并存，但不能混用资金桶
3. 风控输出 `green / yellow / red`
4. `yellow` 进入人工审核
5. `red` 直接拒绝并审计
6. 自动通过时，金额从 `provider_receivable` 进入 `provider_locked_balance`，并立即返回 EIP-712 ticket
7. 人工审核时，金额先进入 `provider_frozen_balance`，等待 admin approve / reject
8. `amountUsdc` 如果显式传入，必须大于 `0` 且最多支持小数点后 2 位；留空时表示提取当前全部可提现金额
9. 如果已签发的 withdrawal ticket 过期，Gateway 只有在本地时间超过 `deadline + WITHDRAW_TICKET_EXPIRY_BUFFER_SEC`、RPC 链头时间超过 `deadline + WITHDRAW_RPC_FINALITY_MARGIN_SEC`、且合约确认 `isTicketConsumed(ticketHash)=false` 后，才会把该单据推进到 `FAILED_EXPIRED`，并把对应 `provider_locked_balance` 释放回 `provider_receivable`
10. 如果 Gateway 当前无法连通链上 RPC 或无法校验金库 USDC 余额，接口必须返回 `503 WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE`，不能把内部堆栈暴露成 500。
11. 每笔 withdrawal 只会签发一次 `ticketId/ticketHash`；过期后不能刷新旧 ticket，用户必须重新创建新的提现申请。

### 3.6.1 `GET /api/v1/providers/withdrawals/capability`

用途：给 Provider Settlements 页面返回“网关当前能否签发 withdraw ticket”的能力探测结果。

返回约定：

1. `ticketSigningEnabled` 表示服务端是否具备签发 EIP-712 withdrawal ticket 的最小条件。
2. `code` / `message` 返回当前阻塞原因，例如 `WITHDRAW_SIGNER_NOT_CONFIGURED`。
3. 前端必须先读该接口，再决定是否允许点击 `Generate & Claim`，避免把配置错误直接暴露成 500 交互。

### 3.6.2 `POST /api/v1/admin/providers/withdrawals/{withdrawalId}/review`

用途：平台管理员处理 `PENDING_MANUAL_REVIEW` 的 Provider 提现单。

约束：

1. 仅 fee admin 可调用。
2. `reviewDecision` 只能是 `APPROVE` 或 `REJECT`。
3. `APPROVE` 时，系统把金额从 `provider_frozen_balance` 移到 `provider_locked_balance`，并生成 EIP-712 ticket，状态推进到 `APPROVED_AUTO`。
4. `REJECT` 时，系统把金额从 `provider_frozen_balance` 释放回 `provider_receivable`，状态推进到 `REJECTED`。
5. 审核动作必须记录 `reviewerAddress`、`reviewerNote` 与 owner-scoped audit event。

## 4. Runtime Invocation Semantics

### 4.1 `GET /api/v1/services/discover`

用途：向 Agent 暴露可调用服务目录。

要求：

1. 返回 service、schema、price、health、routing contract
2. 不暴露 Provider 内部结算字段
3. 只返回当前健康可路由服务

### 4.1.1 `GET /api/v1/services/network-stats`

用途：给首页与公开营销页提供最小公共网络摘要。

要求：

1. 只返回聚合后的公共计数，不返回 wallet、request 级明细。
2. 至少包含 `registeredServices`、`discoverableServices`、`staleServices`、`runtimeReadyServices`、`totalCalls`、`connectedAgents`。
3. `totalCalls` 必须基于已接受/已成功的 charge 记录做 `requestId` 去重。
4. `connectedAgents` 只统计至少完成过一次已接受/已成功调用的 consumer 去重数量。
5. `registeredServices` 表示已注册且处于公开 active 生命周期的服务数；`discoverableServices` 表示当前处于健康窗口内、Agent 可发现的服务数；`staleServices` 表示仍处于 active 生命周期但健康快照已过期的服务数。
6. `runtimeReadyServices` 为兼容旧前端保留，当前等同于 `discoverableServices`。
7. 该接口服务首页的 live counters，不得扩张成泄露结算面的公开分析接口。

### 4.2 `POST /api/v1/services/quote`

用途：基于 service 和请求上下文生成价格确认。

要求：

1. 绑定 credential 和 service
2. 带有效期
3. 作为后续 invoke 的价格锚点

### 4.3 `POST /api/v1/gateway/generate`

用途：执行同步 Gateway invoke。

调用前：

1. 校验 owner scope
2. 校验 agent credential
3. 校验 budget policy
4. 校验 quote 或 service pricing policy
5. 校验 rate limit
6. 校验消费侧余额

调用后：

1. 成功则 capture
2. 原子完成消费侧扣减、供给侧收益累积、平台费累积、ledger、audit
3. 失败则 release 或 rollback

### 4.4 `POST /api/v1/agent/invoke` for LLM token-metered services

用途：让 Agent 调用 Provider 注册到平台的 LLM 服务，例如 DeepSeek Chat。

请求约定：

1. `serviceKind=llm` 或 `priceModel=token_metered` 时进入 LLM 计费路径。
2. Caller 可传 `maxCostUsdc` 作为显式冻结上限。
3. Caller 不传 `maxCostUsdc` 时，Gateway 根据 prompt 字符数、`max_tokens`、Provider 声明的每百万 token 单价自动计算 hold。
4. `costUsdc` 对 LLM token-metered 调用不是必填；普通 fixed/per-call API 仍必须传 observed `costUsdc`。
5. `stream=true` 必须返回 `400 LLM_STREAMING_NOT_SUPPORTED`，不能静默改写。

自动预授权公式：

```text
input_estimated_tokens = ceil(prompt_character_count / 3)
output_estimated_tokens = request.max_tokens || service.defaultMaxOutputTokens || 2048
estimated_cost =
  input_estimated_tokens * inputPricePer1MTokensUsdc / 1_000_000
  + output_estimated_tokens * outputPricePer1MTokensUsdc / 1_000_000
holdUsdc = ceil_to_6_decimals(estimated_cost * holdBufferMultiplier)
```

成功响应必须包含：

```json
{
  "usage": {
    "inputTokens": 1200,
    "outputTokens": 300,
    "totalTokens": 1500
  },
  "synapse": {
    "priceModel": "token_metered",
    "holdUsdc": "0.001000",
    "chargedUsdc": "0.000253",
    "releasedUsdc": "0.000747",
    "providerRevenueUsdc": "0.000228",
    "platformFeeUsdc": "0.000025",
    "preAuthMode": "auto"
  }
}
```

资金不变量：

1. `chargedUsdc = ceil_to_6_decimals(inputTokens * inputPricePer1MTokensUsdc / 1_000_000 + outputTokens * outputPricePer1MTokensUsdc / 1_000_000)`。
2. `releasedUsdc = holdUsdc - chargedUsdc`。
3. `providerRevenueUsdc + platformFeeUsdc = chargedUsdc`。
4. Provider 成功但缺 usage 时必须释放完整 hold 且不扣费。
5. Provider 返回 SSE 或 Caller 请求 stream 时必须失败在扣费前。

## 5. Service Control Plane

### 5.1 `GET|POST|PUT|DELETE /api/v1/services*`

用途：Owner 在 Provider Workspace 管理自己的服务。

要求：

1. service ownership 绑定当前 owner scope
2. Provider 只是业务角色，不是独立账户体系
3. manifest 字段必须对齐 `docs/06_Reference/03_Service_Manifest_and_Runtime_Object_Reference.md`
4. `serviceId` 是机器路由主键；Build Service Manifest 页面中的 `Agent Tool Name` 会直接映射到它
5. `serviceId` 必须全局唯一；重复注册返回 `422 SERVICE_REGISTRATION_INVALID`
6. 当前实现没有独立的服务注册人工审核流；请求校验通过且健康探测完成后，服务立即写入 owner registry。公共 discover 是否可见仍取决于 `status=active` 且运行健康

## 6. Audit and Admin APIs

### 6.1 `GET /api/v1/finance/audit-logs`

用途：返回 owner-scoped 金融审计事件。

### 6.1.1 `GET /api/v1/usage/logs`

用途：返回 owner-scoped invocation / billing 日志，供 Dashboard Invocations、结算明细和 owner 自查使用。

查询参数：

1. `page`，从 `1` 开始，默认 `1`
2. `pageSize`，默认 `20`，最大 `100`
3. `status`，可选，按调用状态过滤
4. `query`，可选，按 `invocation id / request id / service id / wallet` 模糊过滤
5. `limit`，兼容旧客户端的简化参数；传入时返回前 N 条最新记录

返回约定：

1. `logs` 为当前页记录
2. `count` 为当前页记录数
3. `total` 为过滤后的总记录数
4. `page` / `pageSize` 为服务端实际分页参数
5. `hasMore` 表示是否仍有下一页
6. 记录会尽量返回 `agentId` 与 `latencyMs`，用于 Invocations 页面展示真实调用流水视图

### 6.2 `GET /api/v1/indexer/status`

用途：返回充值索引器、backfill、reconciliation 的运行状态。

### 6.3 Admin APIs

1. 费率策略管理
2. 入金回放
3. 对账与告警观察

这些接口属于平台控制面，不属于 Agent-facing Runtime 协议。

## 7. Design Rules

1. 文档优先表达目标态业务语义，不再以旧字段名为组织中心。
2. Runtime 协议默认只暴露 service-facing 信息，不暴露 Provider 结算面。
3. 任何资金接口变更都必须同步更新本文件和对应专题文档。
4. `synapse_vault_withdrawals.status` 有效值为 `REQUESTED` | `SIGNED` | `FAILED` | `APPROVED_AUTO` | `PENDING_MANUAL_REVIEW` | `REJECTED` | `COMPLETED` | `CANCELLED`。**不存在 `PENDING` 状态**（历史遗留，已于 2026-04-08 修正）。
5. Consumer 提现（`POST /api/v1/balance/consumer/withdraw`）与 Provider 提现（`POST /api/v1/providers/withdrawals/intent`）共用 `synapse_vault_withdrawals` 表，通过 `withdrawal_kind` 字段区分。
