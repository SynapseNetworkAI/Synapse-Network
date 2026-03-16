# Synapse Network: Seller API 接口文档 (Gateway Router)

> 核心端点基网：`http://127.0.0.1:8000` (Dev) / `https://api.synapse.network` (Prod)
> 以下所有接口皆由 "Six-Layer Speed Gateway" 严格分离，并使用依赖注入。请求与并发严格通过 Redis/Memory 锁保护。

## 1. 认证与服务鉴权 (Authentication API)

### 1.0 鉴权速查 (Auth Quick Matrix)

- **Challenge-only login flow**:
  - `GET /api/v1/auth/challenge`
  - `POST /api/v1/auth/verify`
  - `POST /api/v1/auth/logout`

- **Session-required business APIs**:
  - `GET/POST/PUT/DELETE /api/v1/services*`（除 `/discover` 外）
  - `POST /api/v1/services/{id}/ping`
  - `POST /api/v1/services/parse-curl`
  - `GET /api/v1/balance`
  - `POST /api/v1/balance/deposit/attempts`
  - `POST /api/v1/balance/deposit/intent`
  - `GET /api/v1/balance/deposit/intents`
  - `POST /api/v1/refund`
  - `GET /api/v1/refunds`
  - `GET /api/v1/usage/logs`
  - `POST /api/v1/providers/withdrawals/intent`
  - `GET /api/v1/providers/withdrawals`
  - `POST /api/v1/providers/withdrawals/{withdrawalId}/complete`
  - `GET /api/v1/router/config`
  - `POST /api/v1/router/config`
  - `GET /api/v1/finance/audit-logs`
  - `GET /api/v1/admin/fee-policy`
  - `PUT /api/v1/admin/fee-policy`
  - `POST /api/v1/admin/deposits/replay`
  - `/api/v1/secrets/seller/*`
  - `/api/v1/credentials/buyer/*`

- **Public APIs**:
  - `GET /api/v1/services/discover`
  - `GET /api/v1/indexer/status`

### 1.1 获取登录挑战 (Get Challenge)
- **Path**: `GET /api/v1/auth/challenge`
- **Desc**: 针对以太坊钱包的登录认证挑战接口。返回供前端钱包签名（EIP-191 `personal_sign`）的一次性 challenge（含随机 Nonce）。
- **TTL**: challenge 为短时有效、一次性使用（由 `AUTH_CHALLENGE_TTL_SEC` 控制，默认 600 秒）。
- **Params**:
  - `address` (query, required): 用户的 `0x...` 以太坊钱包地址。
- **Returns (200 OK)**:
  ```json
  {
    "success": true,
    "challenge": "Login to A2A Pay Network\nWallet: 0x...\nNonce: xxx\nTimestamp: 123",
    "domain": "a2a-pay-network"
  }
  ```

### 1.2 校验签名并获取 Token (Verify Challenge)
- **Path**: `POST /api/v1/auth/verify`
- **Desc**: 前端提交 Wallet 签名结果进行验签。验签通过后签发平台会话 token（JWT）。
- **Body**: 
  ```json
  {
    "wallet_address": "0x...",
    "signature": "0xsign...",
    "message": "Login to A2A Pay Network..."
  }
  ```
- **Returns (200 OK)**:
  ```json
  {
    "success": true,
    "access_token": "ey...",
    "token_type": "bearer",
    "expires_in": 86400
  }
  ```

- **Notes**:
  - `expires_in` 为服务端配置值（`AUTH_TOKEN_TTL_SEC`），不是固定常量。
  - 当 challenge 过期或已失效时，接口返回 `401`，前端应重新请求 challenge 并重新签名。

### 1.3 会话登出 (Logout Session)
- **Path**: `POST /api/v1/auth/logout`
- **Desc**: 标记当前钱包在网关侧的会话状态为 `inactive`，用于控制台显式登出。
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **Returns (200 OK)**:
  ```json
  {
    "success": true
  }
  ```

---

## 2. 身份隔离与工作区管控 (Wallet Role Isolation)

### 2.1 获取工作区角色绑定
- **Path**: `GET /api/v1/wallet/role/{address}`
- **Desc**: 获取一个账户明确在 Gateway 层所被硬隔离赋予的角色身份。不具备跨区越权可能。
- **Returns (200 OK)**:
  ```json
  {
    "role": "CONSUMER"  // or "PROVIDER"
  }
  ```

### 2.2 工作区主动绑定
- **Path**: `POST /api/v1/wallet/role/{address}/bind`
- **Desc**: 为未登记的初次访问者绑定隔离域。一旦绑定，在智能合约中的身份以及数据库中的流水便终身隔绝。
- **Body**:
  ```json
  {
    "role": "CONSUMER" // or "PROVIDER"
  }
  ```
- **Returns (200 OK)**:
  ```json
  {
    "status": "success",
    "role": "CONSUMER"
  }
  ```

---

## 3. 金库与余额系统 (Bulletproof Vault & Balance)

### 3.1 跨库意向申报 (Deposit Intent Registration)
- **Path**: `POST /api/v1/balance/deposit/intent`
- **Desc**: 买家前端调用 Web3 智能合约 `Deposit` 函数后，将哈希告知 Gateway。网关会在后台挂起一只 `Web3 Daemon` 异步独立扫链核实后，加锁执行内部余额充值挂账。**此接口绝不接受伪造到账**。
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **Security Headers**: Requires `X-Idempotency-Key` (16-128 chars, allowed chars: `A-Z a-z 0-9 . _ : -`). Same key + same payload returns the same logical result; same key + different payload returns `409`.
- **Replay Protection**: duplicate `txHash` for same owner inside replay window is rejected with `409`.
- **PostgreSQL Hardening**:
  - Physical dedup is enforced by unique constraint (`synapse_deposit_dedup.tx_hash`).
  - Backend captures DB integrity conflicts and returns stable idempotent response (no duplicate credit).
  - 注册意图时先进入 `PENDING_CONFIRMATION`，并把金额记入 `pending_balance`（不直接进入可用余额）。
  - 确认通过后才执行 `pending_balance -> available_balance`。
- **Body**:
  ```json
  {
    "txHash": "0x...",
    "amountUsdc": 1.5,
    "buyerAddress": "0x..."
  }
  ```

### 3.1.1 充值尝试漏斗记录 (Deposit Attempt Funnel Tracking)
- **Path**: `POST /api/v1/balance/deposit/attempts`
- **Desc**: 记录同一笔买家充值尝试的阶段性事件，不直接驱动账本，不修改 `pending_balance` / `available_balance`。该接口只负责把前端行为漏斗持久化到 PostgreSQL 的 `synapse_deposit_attempts`。
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **PostgreSQL Hardening**:
  - Table is `synapse_deposit_attempts`.
  - Unique key is `(attempt_id, stage)` so refresh / retry / duplicated client submits remain idempotent per stage.
  - `ON CONFLICT` only updates metadata (`tx_hash`, `failure_reason`, `updated_at`, request context), and does not touch financial ledger tables.
- **Body**:
  ```json
  {
    "attemptId": "dep_attempt_7f5d...",
    "amountUsdc": 10,
    "stage": "TX_BROADCASTED",
    "txHash": "0x...",
    "failureReason": "optional",
    "clientRequestId": "optional"
  }
  ```
- **Supported Stages**:
  - `SIGN_REQUESTED`
  - `TX_BROADCASTED`
  - `RECEIPT_FAILED`
  - `RECEIPT_CONFIRMED`
  - `INTENT_REGISTERED`

### 3.2 余额查询对账 (Query Heat-Wallet Balance)
- **Path**: `GET /api/v1/balance`
- **Desc**: 读取当前会话 owner 的余额摘要（buyerBalance / sellerReceivable / platformFeeAccrued）。
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。

### 3.3 充值意图列表 (Deposit Intent List)
- **Path**: `GET /api/v1/balance/deposit/intents`
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **Desc**: 返回当前 owner 的充值意图列表，不返回其他 owner 数据。

### 3.3.1 充值确认（模拟确认）
- **Path**: `POST /api/v1/balance/deposit/intents/{depositIntentId}/confirm`
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **Desc**: 模拟确认链上到账完成，状态流转 `PENDING_CONFIRMATION -> CONFIRMED`，并执行余额迁移：
  - `buyer.pending_balance -= amount`
  - `buyer.available_balance += amount`
- **Body**:
  ```json
  {
    "eventKey": "txhash:logIndex",
    "confirmations": 2
  }
  ```

### 3.4 退款与账务流水 (Refund / Usage)
- **Paths**:
  - `POST /api/v1/refund`
  - `POST /api/v1/refunds/{refundId}/complete`
  - `GET /api/v1/refunds`
  - `GET /api/v1/usage/logs`
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **Desc**: 仅返回当前 owner 作用域内账务数据。
- **Security Headers**: `POST /api/v1/refund` requires `X-Idempotency-Key`.
- **Validation**:
  - `POST /api/v1/refund` requires `amountUsdc >= 10` (USDC) and `amountUsdc <= buyer available balance`.
  - `POST /api/v1/refund` requires origin binding: at least one of `originRequestId` / `originTxHash`.
  - `POST /api/v1/refund` enforces origin ceiling: refund amount cannot exceed remaining refundable amount derived from successful charge usage rows.
  - `POST /api/v1/refund` enforces one active refund per owner (`PENDING` or `PENDING_MANUAL_REVIEW`).
  - `POST /api/v1/refund` enforces destination consistency: `destinationAddress` (if provided) must equal owner address (route-back only).
  - `POST /api/v1/refund` supports `refundType` (`SYSTEM_FAILURE` / `MANUAL_APPEAL`) and emits `riskLevel` / `riskReasonCode` / `message`.
  - `POST /api/v1/refunds/{refundId}/complete` requires valid `txHash` and rejects cross-intent tx replay.
  - `POST /api/v1/refunds/{refundId}/complete` for manual-review refunds supports `reviewDecision` (`APPROVE|REJECT`), `reviewerAddress`, `reviewerNote`.
- **Ledger Safety**:
  - Refund intent creation atomically moves funds: `buyers[owner] -= amount`, `buyersLocked[owner] += amount`.
  - Refund completion consumes lock: `buyersLocked[owner] -= amount`.
  - Refund manual rejection releases lock back to buyer available balance (`buyersLocked[owner] -= amount`, `buyers[owner] += amount`) and marks intent `REJECTED`.
- **Gas Responsibility**: refund responses include `gasPayer=BUYER`, `gasModel=BUYER_PAYS_ONCHAIN`.
- **Pagination Guardrails**: list endpoints use strict limits (`1..200` for refunds/intents, `1..500` for usage logs).
- **Transaction Safety**:
  - Buyer charge/settlement path prefers PostgreSQL atomic transaction APIs (ledger update + usage log + audit in one commit).
  - Seller withdraw completion binds `owner + txHash + kind` in DB dedup table to block replay across retries/multi-instance races.

### 3.5 Router Config (Owner Scoped)
- **Paths**:
  - `GET /api/v1/router/config`
  - `POST /api/v1/router/config`
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **Desc**: Router config is owner-scoped; each owner can only read/write their own config.
- **Validation**: `dailyLimitUsdc` must be in `[0, 10000]`.
- **Meaning**: `dailyLimitUsdc` is the owner-level daily spend ceiling for routed financial operations; `0` means no spending allowed for that day.

### 3.6 资金审计日志 (Finance Audit Logs)
- **Path**: `GET /api/v1/finance/audit-logs`
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **Desc**: Returns owner-scoped financial audit events (deposit/refund/router/rate-limit).
- **Pagination**: `limit` in `1..500`.

### 3.7 索引器状态探针 (Indexer Health & Counters)
- **Path**: `GET /api/v1/indexer/status`
- **Desc**: 返回充值索引器实时健康度，包含当前监听合约地址、最近一轮处理计数、最后处理时间与最近错误，便于快速定位“链上已成功但余额未更新”问题。
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **Authorization**:
  - Owner must be included in `INDEXER_ADMIN_WALLETS`.
  - If `INDEXER_ADMIN_WALLETS` is empty, backend falls back to `PLATFORM_FEE_ADMIN_WALLETS`.
- **Error Surface**:
  - API only returns standardized error code strings in `lastError` fields.
  - Internal exception details are logged server-side and are not exposed in API payload.
- **Returns (200 OK)**:
  ```json
  {
    "status": "success",
    "indexer": {
      "running": true,
      "listenerAddress": "0xe7f1...",
      "lastCounters": {
        "credited": 1,
        "failed": 0,
        "pending": 2
      },
      "lastProcessedAt": 1773417000,
      "lastError": null,
      "pollIntervalSec": 2,
      "backfill": {
        "enabled": true,
        "lastScannedBlock": 123456,
        "lastScanAt": 1773582000,
        "lastRecovered": 2,
        "lastError": null
      },
      "reconciliation": {
        "enabled": true,
        "lastCheckAt": 1773582000,
        "chainVaultUsdc": 120.0,
        "ledgerObligationUsdc": 119.5,
        "deltaUsdc": 0.5,
        "alert": false,
        "lastError": null
      }
    }
  }
  ```
- **Standard Error Codes** (`lastError`):
  - top-level: `INDEXER_LOOP_FAILED`
  - backfill: `INDEXER_BACKFILL_SCAN_FAILED`
  - reconciliation: `INDEXER_RECONCILIATION_FAILED`

### 3.8 平台手续费策略管理 (Admin Fee Policy)

- **Paths**:
  - `GET /api/v1/admin/fee-policy`
  - `PUT /api/v1/admin/fee-policy`
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **Authorization**:
  - Owner must be included in `PLATFORM_FEE_ADMIN_WALLETS`.
  - Development fallback: when allow-list is empty and `ENVIRONMENT=development`, authenticated owner can manage policy for local debug.
- **Payload** (`PUT`): `{ defaultRate?: number, ownerRates?: Record<wallet, rate> }` with rate in `[0,1]`.
- **Effect**: controls internal settlement `feeRate` resolution priority on generate path.

### 3.8.1 充值补账回放 (Admin Deposit Replay)

- **Path**: `POST /api/v1/admin/deposits/replay`
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **Authorization**:
  - Owner must be included in `PLATFORM_FEE_ADMIN_WALLETS`.
  - Development fallback: when allow-list is empty and `ENVIRONMENT=development`, authenticated owner can trigger replay.
- **Body**:
  ```json
  {
    "txHash": "0x..."
  }
  ```
- **Behavior**:
  - Decode confirmed chain receipt.
  - Recover missing deposit intent if absent.
  - Replay confirmation path atomically to avoid manual DB edits.
- **Error Codes**:
  - `INVALID_TX_HASH`
  - `TX_NOT_CONFIRMED`
  - `TX_FAILED`
  - `MISSING_TX_RECEIPT`
  - `NO_MATCHING_DEPOSIT_EVENT`

### 3.9 Provider 收益汇总 (Provider Earnings Summary)

- **Path**: `GET /api/v1/providers/earnings/summary`
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **Desc**: 从网关数据库聚合卖家收益，作为 Provider Console 的 KPI 数据源（不依赖链上 `ServicePaid` 事件）。
- **Query**:
  - `limit` (`1..500`, optional, default `200`): 返回最近调用明细条数。
- **Idempotency / 去重规则**:
  - 聚合时以 `request_id` 为唯一键去重，仅统计 `status=succeeded` 的卖家调用。
  - 若同一 `request_id` 出现多条记录，按 `created_at` 最新一条生效，其他计入 `duplicateRowsDropped`。
- **Returns (200 OK)**:
  ```json
  {
    "status": "success",
    "summary": {
      "ownerAddress": "0x...",
      "totalApiCalls": 128,
      "totalEarned": 64.0,
      "totalProtocolFee": 6.4,
      "totalRoutingTax": 0.0128,
      "sellerNetEarned": 57.6,
      "sellerReceivable": 57.6,
      "duplicateRowsDropped": 2,
      "idempotencyKey": "request_id",
      "recentCalls": [
        {
          "requestId": "buyer-trace-001",
          "serviceId": "SVC_xxx",
          "status": "succeeded",
          "unitPrice": 1.0,
          "protocolFee": 0.1,
          "routingTax": 0.0001,
          "sellerNet": 0.9,
          "createdAt": "2026-03-15 14:24:00"
        }
      ]
    }
  }
  ```

- **Settlement 口径（与网关记账保持一致）**:
  - `totalEarned = Σ unitPrice`
  - `totalProtocolFee = Σ protocolFee`
  - `totalRoutingTax = Σ routingTax`
  - `sellerNetEarned = Σ sellerNet`
  - `sellerReceivable` 直接读取 `balance_ledger.sellers[owner]`，用于提现余额显示。

### 3.10 Provider 提现意图与完成 (Seller Self-Gas Withdrawal)

- **路径**:
  - `POST /api/v1/providers/withdrawals/intent`
  - `GET /api/v1/providers/withdrawals`
  - `POST /api/v1/providers/withdrawals/{withdrawalId}/complete`
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **设计目标**:
  - 卖家使用钱包自付 Gas 调用合约 `withdraw(...)`。
  - 网关负责签发 EIP-712 票据与离链锁仓，确保幂等、防重放、防重复提现。

- **`POST /intent`**:
  - Header: `X-Idempotency-Key` 必填。
  - Body: `{ "amountUsdc": number }`（可选；空值表示全额可提）。
  - 业务规则:
    - 同 owner 仅允许一个活跃提现单（`APPROVED_AUTO` / `PENDING_MANUAL_REVIEW` / `REQUESTED`）。
    - 网关执行三段式风控阀门（Red/Yellow/Green），所有资金写入在 PostgreSQL 单事务内完成（`SELECT ... FOR UPDATE` + rollback）：
      - **Red（拒绝）**：返回 `403`，状态写入 `REJECTED`，并记录审计事件（如高危卖家、提现额超历史净收入）。
      - **Yellow（人工审核）**：`available -> frozen`，状态 `PENDING_MANUAL_REVIEW`，返回无签名票据。
      - **Green（自动放行）**：`available -> pending`，状态 `APPROVED_AUTO`，返回 EIP-712 ticket。
    - 风控规则引擎支持环境变量配置：
      - `WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC`（单笔黄灯阈值）
      - `WITHDRAWAL_AUTO_24H_LIMIT_USDC`（24h 累计黄灯阈值）
      - `WITHDRAWAL_WINDOW_HOURS`（滚动窗口小时数）
      - `WITHDRAWAL_HIGH_RISK_SELLER_ADDRESSES`（逗号分隔高危地址白名单）
    - Green 分支返回 ticket 字段：`amount`, `fee`, `nonce`, `deadline`, `signature`, `chainId`, `contractAddress`。

- **`GET /api/v1/providers/withdrawals`**:
  - 返回 owner 作用域提现记录（按创建时间倒序）。

- **`POST /{withdrawalId}/complete`**:
  - Body: `{ "txHash": "0x..." }`
  - 业务规则:
    - 仅允许 `PENDING -> COMPLETED` 一次性流转。
    - 完成后释放锁仓：`sellersLocked[owner] -= amount`。
    - 同 owner 不允许将同一个 `txHash` 复用于不同提现单（防重放）。
    - 已完成记录再次完成时：
      - 同 txHash 视为幂等成功
      - 不同 txHash 返回 `409`。

- **安全约束**:
  - API 幂等：`idempotency key + request hash`。
  - 链上防重放：`nonce + deadline + EIP-712`。
  - 离链防重复提现：单 owner 单 `PENDING` + 锁仓账本。
  - 审计事件：
    - `PROVIDER_WITHDRAW_INTENT_CREATED`
    - `PROVIDER_WITHDRAW_COMPLETED`

---

## 4. 卖家机器经济与 AI 服务 (Seller Network Services)

### 4.1 自动发掘市场大盘 (Service Discovery)
- **Path**: `GET /api/v1/services/discover`
- **Desc**: 允许任何 Buyer 终端查询整个平台挂卷的“卖家功能单意图”和配置列表，可带入大语言模型自动作为 Function Calling 工具箱使用。支持按 `?intent=` 意图匹配词反向搜索。
- **Auth**: Public endpoint. No wallet challenge and no platform session required.
- **Routing Contract**: 对外返回的 `invoke.targets[].url` 为平台网关地址（`/api/v1/gateway/generate`），不暴露卖家真实上游地址。
- **Health Contract**:
  - 只返回 `isActive=true` 且 `serviceHealth.healthyTargets >= 1` 的服务。
  - `status` 字段表示实时可用性（`healthy | degraded | unhealthy | unknown`），不是卖家配置态（`active/inactive`）。
  - `health` 字段来自网关探活状态缓存，并持久化在服务注册存储中（PostgreSQL）。
  - 平台同步维护规范化健康表 `service_target_health`（每个 target 一条记录），discover 与 forwarding 使用同一健康事实源。
- **Returns (200 OK)**:
  ```json
  {
    "status": "success",
    "services": [
      {
        "serviceId": "SVC_F8_5800A9_0648",
        "status": "healthy",
        "health": {
          "overallStatus": "healthy",
          "healthyTargets": 2,
          "totalTargets": 2,
          "lastCheckedAt": 1773417000000
        },
        "invoke": {
          "method": "POST",
          "targets": [
            {
              "url": "http://127.0.0.1:8000/api/v1/gateway/generate",
              "weight": 100,
              "region": null
            }
          ]
        }
      }
    ],
    "count": 1
  }
  ```

### 4.1.1 服务健康状态查询 (Service Health Status)
- **Path**: `GET /api/v1/services/health/status`
- **Desc**: 返回当前服务探活摘要，支持按 `intent` 检索，可选包含 inactive 服务（`includeInactive=true`）。
- **Auth**: Public endpoint.
- **Returns (200 OK)**:
  ```json
  {
    "status": "success",
    "services": [
      {
        "serviceId": "SVC_F8_5800A9_0648",
        "serviceName": "获取名人名言 Top3",
        "isActive": true,
        "status": "active",
        "health": {
          "overallStatus": "degraded",
          "healthyTargets": 1,
          "totalTargets": 2,
          "lastCheckedAt": 1773417000000
        }
      }
    ],
    "count": 1
  }
  ```

### 4.1.2 Seller 健康明细历史 (Owner Scoped)
- **Path**: `GET /api/v1/services/{serviceId}/health/history`
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **Desc**: 返回指定 serviceId 下每个 target 的最近 N 次探测历史（按时间倒序）。
- **Query**:
  - `limitPerTarget` (`1..2000`, default `50`)
  - `hours` (`1..168`, optional): 小时级窗口，实际会被 `SERVICE_HEALTH_HISTORY_RETENTION_HOURS` 截断。
  - `days` (`1..365`, optional): 兼容参数；未传 `hours` 时按 `days*24` 计算后再截断。
- **Returns (200 OK)**:
  ```json
  {
    "status": "success",
    "serviceId": "serviceA",
    "windowHours": 3,
    "retentionHours": 3,
    "windowDays": 1,
    "retentionDays": 1,
    "limitPerTarget": 50,
    "targets": [
      {
        "targetUrl": "http://url1/api",
        "latestStatus": "healthy",
        "history": [
          {
            "status": "healthy",
            "checkedAt": 1773417000000,
            "latencyMs": 24,
            "httpStatus": 200
          }
        ]
      }
    ]
  }
  ```

### 4.1.3 健康历史保留与写入规模
- **写入规模公式**：
  - 每 target 每日写入约 `86400 / probeIntervalSec` 条。
  - 默认 `probeIntervalSec=15`，则每 target 每日约 `5760` 条。
  - 例如一个 service 有 3 个 targets：每日约 `17280` 条。
- **默认保留期**：`3 小时`（`SERVICE_HEALTH_HISTORY_RETENTION_HOURS=3`）。
  - 3 targets 的 service，3 小时约 `2160` 条（按 15s 探活）；
  - 相比 7 天（`120960` 条）和 30 天（`518400` 条）显著降低存储与查询压力。
- **清理策略**：
  - 定时探活后自动清理过期历史（`checkedAt` 超过 retention）。
  - 对已删除/不存在 serviceId 的健康历史执行 orphan 清理。
  - 清理节奏由 `SERVICE_HEALTH_HISTORY_PRUNE_INTERVAL_SEC` 控制，避免每轮探活都全量 prune。

### 4.2 高频服务分发流水线 (Generate/Invoke API)
- **Path**: `POST /api/v1/gateway/generate`
- **Desc**: 大脑发起真实 M2M 调用的核心漏斗。在此经历：“扣减高速内存锁余额” -> “分布式速率限制” -> “反向代理给真实提供商服务” -> “结果聚合审计” 的连贯动作。这也是整个系统价值捕获的中心。
- **Settlement (Internal, Not Exposed to Buyer)**:
  - `unitPrice` 来自服务注册价格。
  - `routingTax` 来自 `GATEWAY_ROUTING_TAX`（固定每次调用路由费）。
  - 买家实扣：`totalCharge = unitPrice + routingTax`。
  - `feeRate` 为本次调用实际生效费率。
  - 协议抽成：`platformFee = unitPrice * feeRate`。
  - 平台总收入：`platformFeeTotal = platformFee + routingTax`。
  - 生效优先级：owner 覆盖费率 > 运行时默认费率 > `PLATFORM_FEE_RATE`。
  - 扣费风控前置：当买家或卖家满足 `frozen_balance > 0` 且账户状态为 `restricted/suspended/blocked` 时，直接阻断交易并返回 `403`。
  - 原子性：买家扣减、卖家入账、平台手续费累加、usage 流水写入必须在同一个 DB 事务提交。
- **Buyer Receipt (Public API)**:
  - 公开返回仅包含 `requestId`、`serviceId`、`totalCharge`、`buyerBalanceAfter`、`serviceUnitPrice`。
  - 不返回卖家净收入与平台抽成拆分（如 `feeRate/platformFee/platformFeeTotal/sellerNet/routingTax`）。
- **Response Example**:
  ```json
  {
    "statusCode": 200,
    "ok": true,
    "payload": {
      "status": "success",
      "code": "DELIVERED",
      "receipt": {
        "requestId": "fb7f6d64-78a1-4a13-96f5-7faf2cd0a801",
        "serviceId": "SVC_F8_5800A9_0648",
        "totalCharge": 1.0001,
        "buyerBalanceAfter": 107.9998,
        "serviceUnitPrice": 1.0
      },
      "data": {
        "result": {
          "quote": "..."
        }
      }
    }
  }
  ```
- **Headers**:
  - `X-Credential`: "agt_123..." (调用凭据)
  - `X-Service-Id`: "svc_demo" (卖家在网络上的通用注册编号)
  - `X-Request-Id`: "buyer-trace-001" (可选，买家侧链路追踪 ID；会原样透传到上游并回显到 `payload.receipt.requestId`)
- **Body**: 必须匹配对应 Service 注册时声明的 Schema 净载荷。 

- **Validation Rules（安全 + 可观测性 + 转发必需）**:
  - 当 `FORWARDING_REQUIRE_HEALTHY_TARGETS=true` 时，网关只会在健康上游池中选路；若无健康目标，返回 `503 SERVICE_UNAVAILABLE`。
  - `prompt`：必填，不能为空白字符串，最大长度 `8000`。
  - `serviceId`：必填（Header 或 Body 至少一个），Header 与 Body 同时传入时必须一致。
  - `serviceId` 格式：仅允许 `[A-Za-z0-9._:-]`，最大长度 `128`。
  - `X-Credential`：必填，格式必须匹配 `agt_[A-Za-z0-9]+`，最大长度 `128`。
  - `X-Request-Id`：可选；若传入，格式必须匹配 `[A-Za-z0-9._:-]`，最大长度 `128`。
  - 平台仅支持 `invoke.method=POST` 且 `invoke.request.contentType=application/json`。
  - 按 `invoke.request.schema.required` 校验请求体必填字段，缺失时返回 `REQUEST_REQUIRED_FIELDS_MISSING`。
  - `constraints` 在转发阶段强制执行：`maxQps/maxRequestBytes/maxResponseBytes/timeoutMs`。
  - `invoke.targets[].weight` 在转发阶段强制校验，必须是整数且在 `[1,10000]`。

- **Routing Execution**:
  - 网关每次转发按 `invoke.targets[]` 执行加权随机选路（weighted random）。
  - 候选节点为空或权重非法时返回 `INVALID_INVOKE_CONFIG`。

- **Buyer 常见错误码（Generate）**:
  - `PROMPT_REQUIRED` (`422`)：`prompt` 为空或全空白。
  - `PROMPT_TOO_LONG` (`422`)：`prompt` 超过最大长度。
  - `SERVICE_ID_REQUIRED` (`422`)：未提供 `serviceId`。
  - `SERVICE_ID_MISMATCH` (`403`)：Header 与 Body 的 `serviceId` 不一致。
  - `SERVICE_ID_INVALID_FORMAT` (`422`)：`serviceId` 格式非法。
  - `CREDENTIAL_REQUIRED` (`401`)：缺少 `X-Credential`。
  - `CREDENTIAL_FORMAT_INVALID` (`422`)：`X-Credential` 格式非法。
  - `CREDENTIAL_INVALID` (`401`)：凭据无效。
  - `CREDENTIAL_INACTIVE` (`401`)：凭据已停用。
  - `CREDENTIAL_EXPIRED` (`401`)：凭据已过期。
  - `CREDENTIAL_RPM_EXCEEDED` (`429`)：凭据速率超限。
  - `CREDENTIAL_MAX_CALLS_EXCEEDED` (`429`)：凭据调用次数超限。
  - `CREDENTIAL_CREDIT_LIMIT_EXCEEDED` (`402`)：凭据额度超限。
  - `INSUFFICIENT_BALANCE` (`402`)：余额不足。
  - `SERVICE_QPS_EXCEEDED` (`429`)：服务级 QPS 超限。
  - `REQUEST_PAYLOAD_TOO_LARGE` (`413`)：请求体超过服务最大请求字节数。
  - `RESPONSE_PAYLOAD_TOO_LARGE` (`413`)：上游响应超过服务最大响应字节数。
  - `REQUEST_REQUIRED_FIELDS_MISSING` (`422`)：请求体缺少该服务 `invoke.request.schema.required` 声明的必填字段。
  - `INVALID_REQUEST_ID` (`422`)：`X-Request-Id` 格式非法。
  - `SERVICE_NOT_FOUND` (`404`)：服务不存在。
  - `SERVICE_INACTIVE` (`403`)：服务未激活。
  - `UPSTREAM_ERROR` (`502`)：上游服务调用失败。

- **统一异常码文档**：详见 [doc/Buyer_Error_Codes.md](doc/Buyer_Error_Codes.md)。

### 4.3 卖家服务管理 (Provider Service Management)

- **Paths**:
  - `GET /api/v1/services`
  - `POST /api/v1/services`
  - `PUT /api/v1/services/{service_record_id}`
  - `DELETE /api/v1/services/{service_record_id}`
  - `POST /api/v1/services/{service_record_id}/ping`
  - `POST /api/v1/services/parse-curl`
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`).
- **Challenge**: Not required for each operation if session is still valid. Re-challenge only when signing in or when session expired.
- **Tenant Isolation**: Owner is derived from token subject, client-provided owner must not bypass server-side ownership checks.
- **`POST /api/v1/services/parse-curl` contract**:
  - Request: `{ curlCommand, model?, currentManifest? }`
  - Response: `{ status, data, fallback, reason?, raw? }`
  - `data` is always a manifest object for frontend `Expected / Generated JSON Response` rendering.
  - When DeepSeek is unavailable/invalid, backend returns `fallback=true` with heuristic manifest to avoid empty payload crashes.
- **`POST /api/v1/services` registration fields (v2 enhanced)**:
  - `invoke.targets[]` (required): cluster endpoints (`url/weight/region`) for weighted routing
  - `healthCheck`: active probe policy (`path/method/intervalSec/timeoutMs/successCodes/...`)
  - `constraints`: forwarding limits (`timeoutMs/maxRequestBytes/maxResponseBytes/maxQps`)
  - `forwarding`: routing behavior (`requestIdHeader/passThroughHeaders/injectHeaders/retryPolicy`)
  - `metering`: billing strategy (`billingUnit/billOnError/billableStatusClasses/requestIdRequired/responseSizeMetering`)
  - Probe URL composition: platform computes health-check URL as each target origin + `healthCheck.path`.
- **`GET /api/v1/services/registration-guide`**:
  - Returns field-by-field guidance metadata for UI tooltips and onboarding.
  - Response includes `principles` and `fields[]` (`key/title/description/howToConfigure/platformUse/example`).
  - Requires owner session headers (same auth model as other seller control-plane APIs).

---

## 5. 凭据签发与生命周期 (Credentials Lifecycle)

- **Buyer 凭据签发**: `POST /api/v1/credentials/buyer/issue`
- **Buyer 凭据列表**: `GET /api/v1/credentials/buyer/list`
- **Buyer 凭据撤销**: `POST /api/v1/credentials/buyer/{credential_id}/revoke`
- **Buyer 凭据限额更新**: `PATCH /api/v1/credentials/buyer/{credential_id}/quota`
- **Buyer 审计日志**: `GET /api/v1/credentials/buyer/audit-logs`

- **Seller Secret 签发**: `POST /api/v1/secrets/seller/issue`
- **Seller Secret 列表**: `GET /api/v1/secrets/seller/list`
- **Seller Secret 撤销**: `DELETE /api/v1/secrets/seller/{secret_id}`

创建凭据请求体（当前版本）：
- `name` (optional)
- `expiresInSec` (optional)
- `maxCalls` (optional)
- `rpm` (optional)
- `creditLimit` (optional)
- `resetInterval` (optional)
- `expiration` (optional)

说明：凭据不再绑定 `serviceId`，服务选择在调用阶段通过 `X-Service-Id`/请求体 `serviceId` 决定。Buyer 与 Seller 凭据在 API 路径与存储层均已隔离。

> 这一组 API 将主钱包的高额安全和实际高频、暴露给多物理机的子实例解耦，完美支撑了“大额充值不暴露主密钥”的重要愿景。