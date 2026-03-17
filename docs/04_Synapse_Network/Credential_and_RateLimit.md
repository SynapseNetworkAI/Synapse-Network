# Provider Service Keys, 限流与统计设计（P1）

> 状态更新（2026-03-17）：本文档描述的是历史上的 `buyer credentials / provider secrets` 双钥匙方案，不再是 build-for-agent 的最终模型。
>
> 新模型不再以“Buyer Credential + Seller Secret”作为 Runtime 核心抽象，而是切换到 `Agent Profile + Agent Credential + Budget Policy + Service Manifest`。新的数据库重构见 [docs/agent/06_Build_For_Agent_Database_Rebuild.md](../agent/06_Build_For_Agent_Database_Rebuild.md)。

## 1. 目标
打破原有绑定具体“Agent”的维度，采用 **“Seller 钱包地址 -> 多个 Service Keys (Provider API Secrets) -> 授权调用所有注册服务”** 的顶层架构。
面向高频调用场景，补齐以下三项核心能力：
- 短期/长期凭证：支持多 Key 签发、可撤销、可过期设定。
- 多维限流：按 Owner (Seller) 全局维度与 Service Key 单凭证维度精准控制 RPM。
- 收益统计与审计：透明记录哪个 Key 产生了多少次真实调用与收益，防刷防盗。

## 2. 架构与适用范围
适用层：后端 `gateway/seller_fastapi.py` 以及所有关联的前端管控 Dashboard (`Secrets Page`)。

新的实体关系：
- **Seller Owner Address**：平台服务的最终受益人与管控者。
- **Service Keys**：由 Seller 签发的请求密钥（API Secret），相当于服务商的内部 Master Key 子集（甚至可以直接分配给特定的应用端和合作平台）。
- **Services**：Seller 钱包下挂载的所有具体端点（`/chat`, `/image` 等），任一有效的 Service Key 均可发起路由调用。

## 3. 数据模型

### 3.1 Service Key (Provider API Secret)
持久化至：`provider_secrets.json`
字段设计：
- `id`: 凭证全局唯一 ID (e.g., `prov_sec_xxx`)
- `ownerAddress`: 所属 Seller 钱包地址
- `name`: 备注名称（便于前端管理，如 "Chatbot Key", "Platform Node"）
- `secretKey` / `tokenHash`: 签发时提供一次明文给用户，服务端仅存 hash 或用于比对加盐验签（目前可先存密文以供网关急速鉴权）。
- `rpm`: 凭证级速率上限 (每分钟请求数)
- `expiration`: 过期时间 (never / 30days / etc.) 
- `status`: `active | revoked`
- `createdAt / updatedAt / revokedAt`

### 3.2 审计与流水表 (Usage Log & Settlement)
持久化或对接合约 `Event Log`:
- 粒度：精确到每次调用 (或定期聚合)。
- `timestamp`, `serviceKeyId`, `serviceId`, `buyerAddress`, `costUSDC`
- 当平台调用 seller 时，扣除逻辑以网关放行为准，统计此流水可以在 Dashboard 直观展示此 `Service Key` 产生的所有收入（Total Earned）。

## 4. API 设计 (后端)

### 4.1 签发 Service Key
`POST /api/v1/secrets/seller/issue`
- 鉴权：Seller 钱包签名 Session。
- 入参：`name` (名称), `expiration` (过期时间), `rpm` (可选，独立凭证速率上限)。
- 输出：明文 `secretKey` 及元数据。

### 4.2 列出所有 Keys
`GET /api/v1/secrets/seller/list`
- 仅返回属于自身的凭证列表（脱敏掩码 `maskedKey`）。

### 4.3 撤销/删除 Key
`DELETE /api/v1/secrets/seller/{secret_id}`
- 阻断通过该凭证发起的所有请求。

### 4.4 数据面调用 (调用方 -> Seller Gateway)
网关接口 `POST /api/v1/services/invoke` 或 `POST /{service_id}/generate`
- 必带 HTTP Header：`Authorization: Bearer sk_live_synapse_xxx` (也就是 Service Key)。
- 校验流：
  1. Header 提取 `Service Key` -> 查询匹配 `ownerAddress`。
  2. 校验此 Key 的状态（未撤销、未过期）。
  3. 通过 `ownerAddress` 核对目标 `serviceId` 是否属于该 Seller。
  4. 过两道限流锁（Key RPM 锁 + Seller Owner 全局 RPM 锁）。

## 5. 平台调用与限流策略 (Rate Limiting)
引入 Redis或内存滑动窗口（每 60 秒刷新）。

- **维度1：Key 级限流 (RPM Limit per Service Key)**
  由 Seller 给平台或具体客户签发 Key 时设定。例如：设 `rpm=100`，一旦 `Service Key A` 请求超过该值，立刻被拒 `429 Too Many Requests`。

- **维度2：Seller 层面全局限流 (Global RPM)**
  Seller 可承受的总体算力上限。例如 1000 RPM，防止恶意的大量并发把下游供应商实例打垮。

**命中限流的 Response：**
```json
{
  "error": "Rate limit exceeded",
  "detail": {
    "code": "RATE_LIMITED",
    "dimension": "service_key" // or "wallet_global"
  },
  "retryAfterSec": 15
}
```

## 6. UX 设计推荐 (Dashboard)
- **创建凭证**: 弹出专属 Modal，要求输入易于记忆的名称（如“Chatbot Key”），可选的并发上限（RPM）和明确的过期策略（如 30 days）。每个字段配有完整的 Info Tooltip 用于辅导。
- **关联视图**: 页面弱化原先繁重的“Agent”逻辑，统一转换为极简的 "Wallet 关联 Keys -> Keys 调动 Services" 的层级。

## 7. 买家凭证与卖家凭证是否要隔离（结论与方案）

### 7.1 结论
需要隔离。至少做**逻辑隔离**，生产环境建议做**物理隔离**。

### 7.2 为什么要隔离
- 权限边界不同：Buyer Credential 负责消费扣费；Provider Secret 负责卖家控制平面与服务调用授权。
- 风险模型不同：买家侧重点是余额盗刷与超扣；卖家侧重点是服务被滥用、密钥泄露导致供应侧损失。
- 审计主体不同：买家审计看消费责任链，卖家审计看服务收益与调用来源，查询维度天然不同。
- 降低爆炸半径：任一侧凭证泄露，不应横向影响另一侧业务权限。

### 7.3 落地设计
- Dev(JSON) 阶段：
  - 统一文件可接受（例如 `credentials.json`），但每条记录必须带 `credentialType`（`buyer`/`provider`）。
  - 服务层严格按 `credentialType` 进行鉴权与路由校验，禁止跨类型使用。
- Prod(DB) 阶段：
  - 建议拆分为 `buyer_credentials` 与 `provider_credentials` 两张表（或独立 schema）。
  - 按类型单独配置限流、索引、轮转策略、审计 retention。
  - 提供统一只读聚合视图给运营看板，不打破隔离边界。

### 7.4 与当前实现的对齐建议
- Provider Secret API (`/api/v1/secrets/seller/*`) 固定处理 `provider/seller` 侧凭据。
- Buyer 调用凭据 (`/api/v1/credentials/buyer/*`) 固定处理 `buyer` 侧凭据。
- 在后续 schema 迭代中补充 `credentialType` 字段，并在旧数据迁移时默认回填对应类型。

