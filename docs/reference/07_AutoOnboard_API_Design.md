# 07 — Auto-Onboarding & Zero-Friction Agent Integration Design

- Status: canonical
- Last updated: 2026-04-05
- Code paths: `gateway/src/api/routers/agent_credentials.py`, `gateway/src/services/platform/credential_service.py`

---

## 目标

降低接入成本，让开发者和 Agent 框架实现**从登录到首次调用全自动化**，无需手动在控制台操作。

---

## 一、自动化完整流程

### 1A — Owner 脚本/SDK 初始化（一次性，可重复执行）

```
1. GET  /api/v1/auth/challenge?address={wallet_address}
        → { nonce }

2. sign(nonce)  ← 用私钥在本地签名，不上网

3. POST /api/v1/auth/verify
        body: { address, signature, nonce }
        → { token: "<owner_jwt>" }

4. GET  /api/v1/credentials/agent/list?active_only=true
        Authorization: Bearer <owner_jwt>
        → { credentials: [ ...active_only ] }

   ┌─ credentials.length > 0 ?
   │   YES → 取第一条 token（或按 name 匹配）直接使用，跳到步骤 6
   └─ NO  → 继续步骤 5

5. POST /api/v1/credentials/agent/issue
        Authorization: Bearer <owner_jwt>
        body: { name: "auto-agent-01", creditLimit: 10.0, maxCalls: 1000 }
        → { credential: { id, token, ... } }

6. 持久化存储 token
   （环境变量 / 密钥管理器 / .env 文件）
```

> Owner JWT 有效期内可复用，无需每次重签名。  
> 整个初始化脚本幂等：两次执行结果相同，不会重复创建凭据。

---

### 1B — Agent 运行时调用（完全无人工干预）

```
Agent 启动时只需一个环境变量：SYNAPSE_AGENT_TOKEN=<credential_token>

POST /api/v1/agent/invoke
     Authorization: Bearer <credential_token>
     body: { serviceId, input, costUsdc }
     → { result, receiptId, balanceAfter }
```

Agent 不持有 owner JWT，不能管理凭据，仅能发起调用。这是安全隔离的设计。

---

### 1C — 凭据健康检查（定时任务 / 启动前检查）

```
GET /api/v1/credentials/agent/{credential_id}/status
    Authorization: Bearer <owner_jwt>
    → {
        credentialId, valid: bool,
        status,            # "active" | "revoked"
        expiresAt,         # epoch ms, null = 永不过期
        isExpired: bool,
        callsUsed, maxCalls,
        creditUsed, creditLimit
      }
```

如果 `valid == false` → 重新执行步骤 5 创建新凭据，更新存储。

---

## 二、新增 API 清单

### 2.1 GET /api/v1/credentials/agent/list?active_only=true

在原有 list 接口基础上，增加 `active_only` 查询参数。

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `active_only` | bool | false | 为 true 时只返回 `status=active` 且未过期的凭据 |

**过滤逻辑：**
```python
status == "active"
AND (expiresAt is None OR expiresAt > now_epoch_ms())
```

**返回示例：**
```json
{
  "status": "success",
  "credentials": [
    {
      "id": "cred_abc123",
      "name": "auto-agent-01",
      "tokenPrefix": "agt_",
      "status": "active",
      "expiresAt": null,
      "maxCalls": 1000,
      "callsUsed": 42,
      "creditLimit": 10.0,
      "createdAt": "2026-04-01T00:00:00Z"
    }
  ]
}
```

---

### 2.2 GET /api/v1/credentials/agent/{credential_id}/status

检查单个凭据是否有效可用。

**返回示例：**
```json
{
  "status": "success",
  "credentialId": "cred_abc123",
  "valid": true,
  "credentialStatus": "active",
  "isExpired": false,
  "expiresAt": null,
  "callsUsed": 42,
  "maxCalls": 1000,
  "creditUsed": null,
  "creditLimit": 10.0
}
```

`valid = false` 的条件：
- `credentialStatus != "active"`（已撤销）
- `isExpired = true`（`expiresAt <= now`）
- `callsUsed >= maxCalls`（配额耗尽，maxCalls != null 时）

---

### 2.3 PATCH /api/v1/credentials/agent/{credential_id}

合并修改凭据（覆盖原有 `/quota` 端点，原端点保留兼容）。

**Request body（所有字段可选）：**
```json
{
  "name": "renamed-agent",
  "maxCalls": 2000,
  "rpm": 60,
  "expiresAt": 1780000000000,
  "creditLimit": 20.0,
  "resetInterval": "monthly"
}
```

**返回：** 更新后的完整凭据对象。

---

## 三、不需要新增的接口

| 需求 | 现有接口 | 说明 |
|------|---------|------|
| Agent 登录 | 无需登录 | credential token 即身份，直接 invoke |
| 撤销凭据 | `POST /credentials/agent/{id}/revoke` | 已有 |
| 轮换 token | `POST /credentials/agent/{id}/rotate` | 已有 |
| 创建凭据 | `POST /credentials/agent/issue` | 已有 |

---

## 四、自动化 SDK 伪代码

```python
import os
from synapse_client import SynapseClient

client = SynapseClient(
    wallet_address=os.environ["WALLET_ADDRESS"],
    private_key=os.environ["PRIVATE_KEY"],      # 仅初始化时用一次
    gateway_url="https://gateway.synapse.network",
)

# 幂等初始化 — 有现成凭据则复用，否则新建
token = client.ensure_credential(
    name="my-agent",
    credit_limit=10.0,
    max_calls=1000,
)
os.environ["SYNAPSE_AGENT_TOKEN"] = token

# 之后 agent 只需：
result = client.invoke(
    service_id="gpt4-provider-xyz",
    input={"prompt": "Hello"},
    cost_usdc=0.01,
)
```

`ensure_credential` 内部逻辑：
1. 调用 `GET /credentials/agent/list?active_only=true`
2. 找到名称匹配的 → 返回其 token
3. 找不到 → 调用 `POST /credentials/agent/issue` → 返回新 token

---

## 五、实施优先级

| 优先级 | 接口 | 工作量 |
|--------|------|--------|
| P0 | `list?active_only=true` | 30 min — 加过滤逻辑 |
| P0 | `{id}/status` | 30 min — 读+计算 valid |
| P1 | `PATCH {id}` (full update) | 1h — 扩展 quota patch + name |
| P1 | SDK `ensure_credential()` helper | 2h — SDK 侧实现 |
| P2 | 文档化 wallet-sig 自动化脚本示例 | 1h |
