# Security & Auth (Access Keys / HMAC Secret Key Management)

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

在 Provider 的 Service Management 面板，提供一个硬核的独立「Security & Auth」安全面板 (Modal/Drawer)，提供以下三大功能：

并在 Provider Console 的 Deploy Pipeline 中执行前置校验：
- 点击 `Publish API` 前，必须先检测 Provider 是否已创建至少一个 Access Key。
- 若未创建，流程应直接引导到 `/provider/secrets`，而不是继续发布。

### a) 脱敏指纹 (Masked Fingerprint)
- **展示规则**：系统不再返回完整的 `secretKey`，而是返回 `maskedKey`（例如 `sk_live_********1d0c`）。
- **用途**：供 Provider 核对自己的服务器中配置的凭据是否与网关一致。虽然看不见完整 Key，但足以进行排障。

### b) 一键密钥轮换🚨 (Rotate Secret Key)
- **场景**：当 Provider 怀疑密钥泄露、或者常规的大厂安全合规要求定时轮换。
- **机制**：
  1. 点击“高危按钮”，请求网关生成新的 API Secret 或作废旧的 Secret。
  2. 网关废弃旧密钥，立即生成新密钥。
  3. **Show Once** 再次触发，将新密钥显示在屏幕中央，提示用户立即复制并配置到服务器环境变量。关闭弹窗后不再可见。

### c) 网关探针联通性测试 (HMAC Ping)
- **设计**：Provider 在自己服务器填好 `sk_` 后，可以通过点击 `[Test Connection]` 测试与网关的联通性。
- **机制**：前端调用网关 Ping 接口，网关使用目前的 `secretKey` 对空负载执行 HMAC 签名并发送给 Provider Endpoint。若返回 `200 OK`，则点亮“绿灯”，说明服务器防线挂载完毕。

## 3. 技术落地方案

### 后端 API (FastAPI)
- **数据结构**：`service_registry.json` 中保存实体的 `secretKey`。
- **路由修改**：
  - `GET /api/v1/services` 及 `GET /api/v1/services/discover` 过滤掉 `secretKey`，返回 `maskedKey`（截取后 4 位）。
  - `POST /api/v1/services` 创建新服务时生成随机 `secretKey` 并返回（仅此一次展示）。
  - **新增** `POST /api/v1/services/{id}/rotate-key`：更新 JSON 文件中的 `secretKey`，返回新的完整 Key。
  - **新增** `POST /api/v1/services/{id}/ping`：网关侧对 Provider 服务器发送一笔模拟签名的空探针。

### 前端 UI (Next.js)
- **页面**：`frontend/src/app/dashboard/services/page.tsx`
- **组件交互**：
  1. 列表里的 `<Key />` 图标改为 `onClick={() => setSelectedService(svc)}`，唤出 `SecurityModal`。
  2. Modal 内展示脱敏指纹。
  3. “Rotate Key”使用红色按钮，外加二次确认。接口返回后展示新 Key 并提供复制功能。
  4. “Test Connection”进行交互式心跳检测。