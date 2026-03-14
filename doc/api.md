# Synapse Network: Seller API 接口文档 (Gateway Router)

> 核心端点基网：`http://127.0.0.1:8000` (Dev) / `https://api.synapse.network` (Prod)
> 以下所有接口皆由 "Six-Layer Speed Gateway" 严格分离，并使用依赖注入。请求与并发严格通过 Redis/Memory 锁保护。

## 1. 认证与服务鉴权 (Authentication API)

### 1.0 鉴权速查 (Auth Quick Matrix)

- **Challenge-only login flow**:
  - `GET /api/v1/auth/challenge`
  - `POST /api/v1/auth/verify`

- **Session-required business APIs**:
  - `GET/POST/PUT/DELETE /api/v2/services*`（除 `/discover` 外）
  - `POST /api/v2/services/{id}/rotate-key`
  - `POST /api/v2/services/{id}/ping`
  - `POST /api/v2/services/parse-curl`
  - `GET /api/v2/balance`
  - `POST /api/v2/balance/deposit/intent`
  - `GET /api/v2/balance/deposit/intents`
  - `POST /api/v2/refund`
  - `GET /api/v2/refunds`
  - `GET /api/v2/usage/logs`
  - `GET /api/v2/router/config`
  - `POST /api/v2/router/config`
  - `GET /api/v2/finance/audit-logs`
  - `/api/v1/secrets/seller/*`
  - `/api/v1/credentials/buyer/*`

- **Public APIs**:
  - `GET /api/v2/services/discover`
  - `GET /api/v2/indexer/status`

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
- **Path**: `POST /api/v2/balance/deposit/intent`
- **Desc**: 买家前端调用 Web3 智能合约 `Deposit` 函数后，将哈希告知 Gateway。网关会在后台挂起一只 `Web3 Daemon` 异步独立扫链核实后，加锁执行内部余额充值挂账。**此接口绝不接受伪造到账**。
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **Security Headers**: Requires `X-Idempotency-Key` (16-128 chars, allowed chars: `A-Z a-z 0-9 . _ : -`). Same key + same payload returns the same logical result; same key + different payload returns `409`.
- **Replay Protection**: duplicate `txHash` for same owner inside replay window is rejected with `409`.
- **Body**:
  ```json
  {
    "txHash": "0x...",
    "amountUsdc": 1.5,
    "buyerAddress": "0x..."
  }
  ```

### 3.2 余额查询对账 (Query Heat-Wallet Balance)
- **Path**: `GET /api/v2/balance`
- **Desc**: 读取当前会话 owner 的余额摘要（buyerBalance / sellerReceivable / platformFeeAccrued）。
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。

### 3.3 充值意图列表 (Deposit Intent List)
- **Path**: `GET /api/v2/balance/deposit/intents`
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **Desc**: 返回当前 owner 的充值意图列表，不返回其他 owner 数据。

### 3.4 退款与账务流水 (Refund / Usage)
- **Paths**:
  - `POST /api/v2/refund`
  - `GET /api/v2/refunds`
  - `GET /api/v2/usage/logs`
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **Desc**: 仅返回当前 owner 作用域内账务数据。
- **Security Headers**: `POST /api/v2/refund` requires `X-Idempotency-Key`.
- **Validation**: `POST /api/v2/refund` requires `amountUsdc >= 10` (USDC).
- **Pagination Guardrails**: list endpoints use strict limits (`1..200` for refunds/intents, `1..500` for usage logs).

### 3.5 Router Config (Owner Scoped)
- **Paths**:
  - `GET /api/v2/router/config`
  - `POST /api/v2/router/config`
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **Desc**: Router config is owner-scoped; each owner can only read/write their own config.
- **Validation**: `dailyLimitUsdc` must be in `[0, 10000]`.
- **Meaning**: `dailyLimitUsdc` is the owner-level daily spend ceiling for routed financial operations; `0` means no spending allowed for that day.

### 3.6 资金审计日志 (Finance Audit Logs)
- **Path**: `GET /api/v2/finance/audit-logs`
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **Desc**: Returns owner-scoped financial audit events (deposit/refund/router/rate-limit).
- **Pagination**: `limit` in `1..500`.

### 3.7 索引器状态探针 (Indexer Health & Counters)
- **Path**: `GET /api/v2/indexer/status`
- **Desc**: 返回充值索引器实时健康度，包含当前监听合约地址、最近一轮处理计数、最后处理时间与最近错误，便于快速定位“链上已成功但余额未更新”问题。
- **Auth**: Public endpoint. No wallet challenge and no platform session required.
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
      "pollIntervalSec": 2
    }
  }
  ```

---

## 4. 卖家机器经济与 AI 服务 (Seller Network Services)

### 4.1 自动发掘市场大盘 (Service Discovery)
- **Path**: `GET /api/v2/services/discover`
- **Desc**: 允许任何 Buyer 终端查询整个平台挂卷的“卖家功能单意图”和配置列表，可带入大语言模型自动作为 Function Calling 工具箱使用。支持按 `?intent=` 意图匹配词反向搜索。
- **Auth**: Public endpoint. No wallet challenge and no platform session required.
- **Returns (200 OK)**:
  ```json
  {
    "status": "success",
    "services": [ ... ],
    "count": 1
  }
  ```

### 4.2 高频服务分发流水线 (Generate/Invoke API)
- **Path**: `POST /api/v2/generate`
- **Desc**: 大脑发起真实 M2M 调用的核心漏斗。在此经历：“扣减高速内存锁余额” -> “分布式速率限制” -> “反向代理给真实提供商服务” -> “结果聚合审计” 的连贯动作。这也是整个系统价值捕获的中心。
- **Headers**:
  - `X-Credential`: "agt_123..." (调用凭据)
  - `X-Service-Id`: "svc_demo" (卖家在网络上的通用注册编号)
- **Body**: 必须匹配对应 Service 注册时声明的 Schema 净载荷。 

### 4.3 卖家服务管理 (Provider Service Management)

- **Paths**:
  - `GET /api/v2/services`
  - `POST /api/v2/services`
  - `PUT /api/v2/services/{service_record_id}`
  - `DELETE /api/v2/services/{service_record_id}`
  - `POST /api/v2/services/{service_record_id}/rotate-key`
  - `POST /api/v2/services/{service_record_id}/ping`
  - `POST /api/v2/services/parse-curl`
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`).
- **Challenge**: Not required for each operation if session is still valid. Re-challenge only when signing in or when session expired.
- **Tenant Isolation**: Owner is derived from token subject, client-provided owner must not bypass server-side ownership checks.
- **`POST /api/v2/services/parse-curl` contract**:
  - Request: `{ curlCommand, model?, currentManifest? }`
  - Response: `{ status, data, fallback, reason?, raw? }`
  - `data` is always a manifest object for frontend `Expected / Generated JSON Response` rendering.
  - When DeepSeek is unavailable/invalid, backend returns `fallback=true` with heuristic manifest to avoid empty payload crashes.

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