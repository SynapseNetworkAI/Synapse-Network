# Synapse Network: Seller API 接口文档 (Gateway Router)

> 核心端点基网：`http://127.0.0.1:8000` (Dev) / `https://api.synapse.network` (Prod)
> 以下所有接口皆由 "Six-Layer Speed Gateway" 严格分离，并使用依赖注入。请求与并发严格通过 Redis/Memory 锁保护。

## 1. 认证与服务鉴权 (Authentication API)

### 1.1 获取登录挑战 (Get Challenge)
- **Path**: `GET /api/v1/auth/challenge`
- **Desc**: 针对以太坊钱包的登录认证挑战接口。返回供前端 EIP-712 签名的随机 Nonce 和格式字符串。
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
- **Desc**: 前端提交通过 Wallet 签署完成后的签名进行验证登入。成功入库后，返回 JWT Base 令牌。
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
- **Desc**: 读取此时存储在 Gateway 热钱包高速内存映射层中的剩余抵扣 USDCs 余额。(依赖 Gateway Token)

### 3.3 索引器状态探针 (Indexer Health & Counters)
- **Path**: `GET /api/v2/indexer/status`
- **Desc**: 返回充值索引器实时健康度，包含当前监听合约地址、最近一轮处理计数、最后处理时间与最近错误，便于快速定位“链上已成功但余额未更新”问题。
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
  - `X-Agent-Credential`: "agt_123..." (子凭据独立密钥)
  - `X-Service-Id`: "svc_demo" (卖家在网络上的通用注册编号)
- **Body**: 必须匹配对应 Service 注册时声明的 Schema 净载荷。 

---

## 5. 客户端 Agent 身份签发 (API Keys Lifecycle)

- **创建 AI Agent 子密钥**: `POST /v1/agent-credentials/issue`
- **获取所有活动子密钥**: `GET /v1/agent-credentials`
- **一键硬撤销子密钥**: `POST /v1/agent-credentials/{credential_id}/revoke` 

> 这一组 API 将主钱包的高额安全和实际高频、暴露给多物理机的子实例解耦，完美支撑了“大额充值不暴露主密钥”的重要愿景。