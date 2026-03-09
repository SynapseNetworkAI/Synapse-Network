# Agent 短期凭证、限流与审计设计（P1）

## 1. 目标
面向 Agent 高频调用场景，补齐三项能力：
- 短期凭证：可撤销、可过期、可限额（调用次数与 RPM）。
- 多维限流：按 owner / agent / service 维度治理流量。
- 审计日志：记录关键配置变更与配额变更。

## 2. 适用范围
后端 `python_sdk/seller_fastapi.py`。

新增 API 主要覆盖：
- owner 控制面（签发/撤销/调整配额/查看审计）
- 数据面调用（`/api/v1/generate`）

## 3. 数据模型

### 3.1 Agent Credential（持久化到 `agent_credentials.json`）
字段：
- `id`: 凭证 ID
- `ownerAddress`: 所属 owner 钱包
- `agentId`: 绑定 agent
- `serviceId`: 绑定 service
- `tokenHash`: 仅保存哈希，不落明文
- `tokenPrefix`: 便于排查
- `status`: `active | revoked`
- `maxCalls`: 总调用上限
- `callsUsed`: 已用调用数
- `rpm`: 凭证级速率上限
- `createdAt / updatedAt / expiresAt / revokedAt`

### 3.2 Audit Log（JSONL 到 `audit_log.jsonl`）
每行一个事件：
- `id`, `timestamp`, `action`, `ownerAddress`, `details`

关键动作：
- `SERVICE_CREATE_OR_UPSERT`
- `SERVICE_UPDATE`
- `SERVICE_DELETE`
- `AGENT_CREDENTIAL_ISSUED`
- `AGENT_CREDENTIAL_REVOKED`
- `AGENT_CREDENTIAL_QUOTA_UPDATED`

## 4. API 设计

### 4.1 凭证签发
`POST /api/v1/agent-credentials/issue`
- 鉴权：owner token（`Authorization + X-User-Address`）
- 入参：`agentId`, `serviceId?`, `expiresInSec?`, `maxCalls?`, `rpm?`
- 输出：一次性明文 token + 凭证元数据

### 4.2 凭证列表
`GET /api/v1/agent-credentials`
- 返回 owner 下全部凭证（无明文 token）

### 4.3 凭证撤销
`POST /api/v1/agent-credentials/{credential_id}/revoke`
- 标记 `revoked`

### 4.4 配额调整
`PATCH /api/v1/agent-credentials/{credential_id}/quota`
- 可更新：`maxCalls`, `rpm`, `expiresAt`
- 触发审计事件（记录 before/after）

### 4.5 审计查询
`GET /api/v1/audit-logs?limit=100`
- 仅返回当前 owner 的日志

### 4.6 数据面调用
`POST /api/v1/generate`
- 新增可选头：`X-Agent-Credential`
- 若携带凭证：
  1) 校验有效性（未过期/未撤销/未超调用上限）
  2) 校验 `serviceId` 绑定一致
  3) 执行 owner / agent / service 三维限流
  4) 调用成功后递增 `callsUsed`
- 兼容策略：`REQUIRE_AGENT_CREDENTIAL_FOR_GENERATE=0` 时允许无凭证；为 `1` 时强制要求凭证。

## 5. 限流策略
滑动窗口（默认 60 秒）
- owner：`OWNER_RATE_LIMIT_PER_MIN`（默认 240）
- agent：`AGENT_RATE_LIMIT_PER_MIN`（默认 600，凭证可覆盖）
- service：`SERVICE_RATE_LIMIT_PER_MIN`（默认 1200）

命中限流返回：
- HTTP 429
- `detail.code=RATE_LIMITED`
- `detail.dimension` 与 `retryAfterSec`

## 6. 安全与一致性
- 凭证明文仅签发时返回，服务端只存 `tokenHash`。
- owner 控制面继续使用钱包签名登录 token。
- 凭证与 service 绑定校验，防止跨服务滥用。
- 审计与配额变更写入同一来源，便于追踪。

## 7. 环境变量
- `AGENT_CREDENTIALS_PATH`
- `AUDIT_LOG_PATH`
- `AGENT_CREDENTIAL_DEFAULT_TTL_SEC`
- `AGENT_CREDENTIAL_MAX_TTL_SEC`
- `AGENT_CREDENTIAL_MAX_CALLS_DEFAULT`
- `OWNER_RATE_LIMIT_PER_MIN`
- `AGENT_RATE_LIMIT_PER_MIN`
- `SERVICE_RATE_LIMIT_PER_MIN`
- `RATE_LIMIT_WINDOW_SEC`
- `REQUIRE_AGENT_CREDENTIAL_FOR_GENERATE`

## 8. 向后兼容
- 管理面接口（services CRUD）不变。
- `/generate` 新增能力默认兼容（可不开强制凭证）。
- 前端可逐步接入 `X-Agent-Credential`，不阻断现有支付链路。

## 9. 可复制测试脚本（Python）

已提供一键脚本：

- `python_sdk/examples/credential_issue_invoke_revoke.py`

能力覆盖：

1) owner 钱包签名登录（challenge/verify）  
2) 签发 Agent Credential  
3) 本地链执行 `payForService` 生成 `txHash`  
4) 携带 `X-Agent-Credential` 调用 `/api/v1/generate`（含 202 pending 轮询）  
5) 撤销凭据

### 运行前准备

- 确保本地环境已启动（Hardhat + Seller FastAPI）：
  - `./test/restart_local_env.sh`
- 确保你用于签发的 owner 下已有对应 `agentId + serviceId` 的服务配置。

### 运行示例

```bash
cd python_sdk

export OWNER_PRIVATE_KEY="<OWNER私钥>"
export SERVICE_ID="V1_DEMO"
export AGENT_ID="<你的agentId>"
export SELLER_ADDRESS="<服务收款地址，与后端SELLER_ADDRESS一致>"

# 可选参数
export API_BASE="http://127.0.0.1:8000"
export RPC_URL="http://127.0.0.1:8545"
export PRICE_USDC="1"
export PROMPT="hello from credential script"

python examples/credential_issue_invoke_revoke.py
```

### 关键环境变量说明

- 必填：
  - `OWNER_PRIVATE_KEY`：用于 owner 登录与管理凭据
  - `SERVICE_ID`：目标服务 ID
  - `AGENT_ID`：目标 agent ID
  - `SELLER_ADDRESS`：服务收款地址
- 可选：
  - `DEPLOYER_PRIVATE_KEY`：用于给买家 mint USDC（默认 Hardhat #0）
  - `BUYER_PRIVATE_KEY`：用于执行 `approve + payForService`（默认 Hardhat #1）
  - `EXPIRES_IN_SEC` / `MAX_CALLS` / `RPM`：凭据参数

