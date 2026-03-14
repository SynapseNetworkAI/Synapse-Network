# Synapse Network: Seller API 接口文档 (Gateway Router)

> 核心端点基网：`http://127.0.0.1:8000` (Dev) / `https://api.synapse.network` (Prod)
> 以下所有接口皆由 "Six-Layer Speed Gateway" 严格分离，并使用依赖注入。请求与并发严格通过 Redis/Memory 锁保护。

## 1. 认证与服务鉴权 (Authentication API)

### 1.0 鉴权速查 (Auth Quick Matrix)

- **Challenge-only login flow**:
  - `GET /api/v1/auth/challenge`
  - `POST /api/v1/auth/verify`

- **Session-required business APIs**:
  - `GET/POST/PUT/DELETE /api/v1/services*`（除 `/discover` 外）
  - `POST /api/v1/services/{id}/rotate-key`
  - `POST /api/v1/services/{id}/ping`
  - `POST /api/v1/services/parse-curl`
  - `GET /api/v1/balance`
  - `POST /api/v1/balance/deposit/intent`
  - `GET /api/v1/balance/deposit/intents`
  - `POST /api/v1/refund`
  - `GET /api/v1/refunds`
  - `GET /api/v1/usage/logs`
  - `GET /api/v1/router/config`
  - `POST /api/v1/router/config`
  - `GET /api/v1/finance/audit-logs`
  - `GET /api/v1/admin/fee-policy`
  - `PUT /api/v1/admin/fee-policy`
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
- **Body**:
  ```json
  {
    "txHash": "0x...",
    "amountUsdc": 1.5,
    "buyerAddress": "0x..."
  }
  ```

### 3.2 余额查询对账 (Query Heat-Wallet Balance)
- **Path**: `GET /api/v1/balance`
- **Desc**: 读取当前会话 owner 的余额摘要（buyerBalance / sellerReceivable / platformFeeAccrued）。
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。

### 3.3 充值意图列表 (Deposit Intent List)
- **Path**: `GET /api/v1/balance/deposit/intents`
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **Desc**: 返回当前 owner 的充值意图列表，不返回其他 owner 数据。

### 3.4 退款与账务流水 (Refund / Usage)
- **Paths**:
  - `POST /api/v1/refund`
  - `GET /api/v1/refunds`
  - `GET /api/v1/usage/logs`
- **Auth**: Requires valid platform session token (`Authorization: Bearer <token>`) and owner context (`X-User-Address`)。
- **Desc**: 仅返回当前 owner 作用域内账务数据。
- **Security Headers**: `POST /api/v1/refund` requires `X-Idempotency-Key`.
- **Validation**: `POST /api/v1/refund` requires `amountUsdc >= 10` (USDC).
- **Pagination Guardrails**: list endpoints use strict limits (`1..200` for refunds/intents, `1..500` for usage logs).

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

---

## 4. 卖家机器经济与 AI 服务 (Seller Network Services)

### 4.1 自动发掘市场大盘 (Service Discovery)
- **Path**: `GET /api/v1/services/discover`
- **Desc**: 允许任何 Buyer 终端查询整个平台挂卷的“卖家功能单意图”和配置列表，可带入大语言模型自动作为 Function Calling 工具箱使用。支持按 `?intent=` 意图匹配词反向搜索。
- **Auth**: Public endpoint. No wallet challenge and no platform session required.
- **Routing Contract**: 对外返回的 `invoke.targets[].url` 为平台网关地址（`/api/v1/gateway/generate`），不暴露卖家真实上游地址。
- **Returns (200 OK)**:
  ```json
  {
    "status": "success",
    "services": [
      {
        "serviceId": "SVC_F8_5800A9_0648",
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
  - `prompt`：必填，不能为空白字符串，最大长度 `8000`。
  - `serviceId`：必填（Header 或 Body 至少一个），Header 与 Body 同时传入时必须一致。
  - `serviceId` 格式：仅允许 `[A-Za-z0-9._:-]`，最大长度 `128`。
  - `X-Credential`：必填，格式必须匹配 `agt_[A-Za-z0-9]+`，最大长度 `128`。
  - `X-Request-Id`：可选；若传入，格式必须匹配 `[A-Za-z0-9._:-]`，最大长度 `128`。
  - `constraints` 在转发阶段强制执行：`maxQps/maxRequestBytes/maxResponseBytes/timeoutMs`。

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
  - `POST /api/v1/services/{service_record_id}/rotate-key`
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