---
id: adr-001-wallet-first-auth
title: ADR 001 - Wallet-First Auth + Progressive Email Collection
status: draft
created_at: 2026-04-03
updated_at: 2026-04-03
author: CTO
---

# ADR 001: Wallet-First Authentication & Progressive Email Collection

## 1. Context (背景与痛点)
Synapse Developer Console 需要解决开发者（Provider/买方）的账户登录与通知触达问题。通常方案是引入 OAuth 2.0（如 Google/GitHub 登录）进行身份验证。
但是，由于我们是 "Stripe for AI Agents"，底层的支付通道、状态通道和 API 计费都强依赖于 **加密钱包（Wallet Address / Private Key / ECDSA 签名）**。
如果引入 Web2 的第三方登录，我们将面临灾难性的架构冲突：“邮箱身份”与“钱包身份”如何绑定、解绑、合并？这将产生极高的技术债务，严重拖慢 30 天闪电战的发布节奏。

## 2. Decision (架构决策：Less is More)
**我们坚决拒绝 Oauth 2.0 等第三方登录。全面采用 `Wallet-First Authentication` 结合基于场景的异步邮箱采集。**

### 2.1 身份基座 (Identity Anchor)
- **唯一身份标识 (SSOT)：** 用户的身份基座永远是他的 `Wallet Address`。拥有私钥即拥有账户的所有权与资产控制权。
- **极速入场 (Frictionless Onboarding)：** 用户首次进入 Console 点击 `Connect Wallet`（或由 SDK 自动生成代理后台 Session），实现 **3秒内免密登录**。

### 2.2 渐进式邮箱收集 (Progressive Email Collection)
- **非强制性认证 (CRM vs Auth)：** 邮箱绝对不作为“登录凭证”，仅作为“通知与触达渠道（CRM & Alerts）”。
- **采集场景 (Collection Triggers)：**
  1. **User Settings 页面：** 在左侧导航栏底部新增 `Account -> Settings`，提供一个极简的输入框让用户绑定 `Email`。
  2. **高光时刻拦截：** 当 Agent 抓取服务赚到第一笔钱，或调用余额即将耗尽时，前端弹出轻量级表单提醒：“Enter your email to receive earnings reports/low balance alerts.”

## 3. Implementation Requirements (前后端实现契约)

### 前端改造 (`user-front`)
- 取消任何有关 "Sign in with Google/GitHub" 的研发规划。
- 导航栏底部（参考 X Console）静态打桩 `Account -> Settings`。
- `Settings` 页面构建 `Email Address` 表单，以及通知偏好的 Toggle 开关（`Earning Reports`, `Budget Alerts`）。
- 提交绑定时，前端需调用钱包插件对 Payload (如 `{"email": "a@b.com", "nonce": 123}`) 进行一次个人签名 (`personal_sign`)，以防防重放攻击和仿冒。

### 后端改造 (`gateway-admin` / `finance-backend`)
- 数据库表结构更新：在针对开发者的账户表（如 `users` 或 `wallets`）中，新增列：
  - `email` (VARCHAR, Nullable, Unique)
  - `email_verified` (BOOLEAN, Default: False)
  - `notify_marketing` (BOOLEAN, Default: True)
  - `notify_alerts` (BOOLEAN, Default: True)
- **核心原则：不阻断核心支付链路。** 邮箱无论真假、验证与否，绝不可影响 Provider 上架服务或 Consumer 执行微支付。

## 4. Consequences (影响与收益)
✅ **收益：** 极大降低 MVP 的后端复杂度；避免了身份缝合的泥潭；保证了 M2M 生态的纯粹性；获客阻力降到最低。
⚠️ **妥协：** 如果用户丢失了钱包私钥，账号及里面的资金将无法通过“找回密码”找回。但这在 Web3/DevTool 领域是标准且被接受的“Code is Law”法则。

