# Security & Auth (Access Keys / HMAC Secret Key Management)

> Status: current implementation baseline. This document describes the currently shipped `/provider/secrets` workspace and the provider secret APIs that exist today.

## 1. 设计哲学 (Design Philosophy)
在 Synapse Network 的基础设施架构中，**Gateway HMAC Secret Key** (`sk_live_synapse_xxx`) 是 Provider 服务器抵御外网“白嫖流量”的唯一防线。
在产品文案层统一命名为 **Access Keys**（用户更容易理解），技术实现仍是 provider secret key。
这把钥匙极其敏感，因此我们坚守“暗黑系安全美学”：
- **Show Once (即焚显示)**：新生成或重新生成的密钥仅在当前会话展示一次。之后**绝照明文**。
- **降维打击安全 (No Cleartext Access)**：任何人（包括平台管理员）都无法再次查询到这把密钥的明文。
- **一键自救 (Instant Rotation)**：随时轮换废弃可能泄露的密钥，保障系统高安全。

## 2. 核心功能 (Key Features)

### 访问与鉴权策略（Provider Secrets）
- `/provider/secrets` 页面允许未连接钱包、未建立 Session 的用户直接访问。
- 在未认证状态下，页面返回空数据，不暴露任何历史密钥信息。
- 点击 `Create new secret key` 时才触发鉴权链路：
  1. 未连接钱包：先弹 `Connect Wallet`。
  2. 已连接但无 Session：发起 Sign-In 建立 Session。
  3. 钱包与 Session 均就绪：再打开创建密钥弹窗并执行写操作。

当前产品形态：

1. Access Keys 是独立页面 `/provider/secrets`，不是挂在旧 `dashboard/services` 列表里的 modal。
2. Provider 在发布 API Service 前，前端会先检查是否至少存在一个 Access Key。
3. 当前已上线的是 `list / issue / delete`，不是旧设计稿里的 `rotate-key / ping` 面板流。

并在 Provider Console 的 Deploy Pipeline 中执行前置校验：
- 点击 `Publish API` 前，必须先检测 Provider 是否已创建至少一个 Access Key。
- 若未创建，流程应直接引导到 `/provider/secrets`，而不是继续发布。

### a) 脱敏指纹 (Masked Fingerprint)
- **展示规则**：系统不再返回完整的 `secretKey`，而是返回 `maskedKey`（例如 `sk_live_********1d0c`）。
- **用途**：供 Provider 核对自己的服务器中配置的凭据是否与网关一致。虽然看不见完整 Key，但足以进行排障。

### b) 删除与重发 (Delete + Re-issue)
- **场景**：当 Provider 怀疑密钥泄露、或者希望定期轮换。
- **当前实现**：先删除旧 key，再重新 issue 新 key。
- **结果**：新 key 仍然遵守 Show Once，只在发放响应里返回一次明文。

### c) 未来增强项 (Not shipped yet)
- rotate-key API
- ping / connectivity test
- per-service secret binding UI

这些能力可以继续做，但不能再写成“已经上线的当前真相”。

## 3. 技术落地方案

### 后端 API (FastAPI)
- **数据结构**：Provider secret 是 owner-scoped 的独立安全对象，不再把文档真相建立在 `service_registry.json` 上。
- **当前数据库/持久化主真相**：系统整体服务模型已经以 PostgreSQL target-state 表为主，包括 `synapse_service_manifests`、`synapse_service_endpoints`、`synapse_service_health_snapshots` 等。
- **路由修改**：
  - `GET /api/v1/secrets/provider/list`
  - `POST /api/v1/secrets/provider/issue`
  - `DELETE /api/v1/secrets/provider/{secret_id}`

返回对象里：

1. 列表接口默认返回 `maskedKey`
2. issue 响应会返回一次性 `secretKey`
3. 页面刷新后只应再看到 `maskedKey`

### 前端 UI (Next.js)
- **页面**：`apps/frontend/src/app/provider/secrets/page.tsx`
- **当前交互**：
  1. 未连接钱包时允许访问页面，但只显示空状态。
  2. 点击创建时才触发 connect / session authorize。
  3. 创建成功后立即展示新 key。
  4. 后续列表页只展示 `maskedKey`。
  5. 当前支持删除旧 key，不支持页面内 rotate / ping。