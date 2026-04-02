# Getting Started — Consumer & Provider Two-Track Design

## 1. 背景与动机

当前 `/docs/getting-started` 是一个混合页面，把"调用服务"和"注册服务"的流程混在一起，
导致不同角色的用户（Consumer / Provider）都需要阅读无关内容，引导效率低。

Synapse 平台存在两种截然不同的集成路径：

| 角色 | 英文 | 核心诉求 |
|------|------|---------|
| 服务调用者 | Consumer | 充值 → 获取 Credential → 调用 API → 自动扣费 |
| 服务提供者 | Provider | 注册服务 → 接收调用 → 查看收益 → 提现 |

拆成独立链路后，每条路径更短、更专注，减少认知负担。

---

## 2. 路由结构

```
/docs/getting-started              ← Overview：角色选择入口
/docs/getting-started/consumer     ← Consumer 完整引导（6 步）
/docs/getting-started/provider     ← Provider 完整引导（6 步）
```

---

## 3. Consumer 链路（服务调用者）

**目标**：从零开始，完成第一笔带计费的 AI Agent 服务调用。

| 步骤 | 标题 | 关键 API |
|------|------|---------|
| 01 | 连接钱包 · 获取 JWT | `GET /auth/challenge` → `POST /auth/verify` |
| 02 | 充值 USDC | 链上 `deposit()` → `POST /balance/deposit/intent` → confirm |
| 03 | 发现可用服务 | `GET /services/discover?tag=xxx` |
| 04 | 创建 Agent Credential | `POST /credentials/agent/issue` |
| 05 | 调用服务 | `POST /agent/invocations` |
| 06 | 查看结算结果 | `GET /balance` — 验证 consumer_balance 减少 |

### 3.1 数据流

```
Consumer Wallet
  │
  ├─[1]─ EIP-191 sign challenge ──▶ Gateway JWT
  │
  ├─[2]─ USDC approve + SynapseCore.deposit()
  │       ──▶ POST /balance/deposit/intent (X-Idempotency-Key)
  │       ──▶ POST /balance/deposit/intents/:id/confirm
  │
  ├─[3]─ GET /services/discover   ──▶ 找到目标 serviceId
  │
  ├─[4]─ POST /credentials/agent/issue (serviceId, spendingLimit)
  │       ──▶ agentToken (agt_xxxxx)
  │
  ├─[5]─ POST /agent/invocations
  │         headers: { Authorization: Bearer agentToken }
  │         body: { serviceId, payload, idempotencyKey }
  │       ──▶ 实时扣费：consumer_balance↓  provider_receivable↑  platform_fee↑
  │
  └─[6]─ GET /balance ──▶ 验证扣费结果
```

---

## 4. Provider 链路（服务提供者）

**目标**：将自己的 API 接入 Synapse 结算网络，开始接收 AI Agent 的调用并获得 USDC 收益。

| 步骤 | 标题 | 关键 API |
|------|------|---------|
| 01 | 连接钱包 · 获取 JWT | 同 Consumer |
| 02 | 注册服务 | `POST /services` (name, endpoint, pricePerCallUsdc, tags) |
| 03 | 配置端点（接收调用） | Provider 侧接收 Gateway 转发请求的格式规范 |
| 04 | 健康检测通过 | Gateway 自动 ping — 服务状态 `healthy` |
| 05 | 接收调用 · 查看收益 | `GET /balance` — 查看 provider_receivable |
| 06 | 提现 USDC | `POST /balance/withdraw` |

### 4.1 数据流

```
Provider Wallet
  │
  ├─[1]─ EIP-191 sign ──▶ JWT
  │
  ├─[2]─ POST /services
  │         { name, endpoint, pricePerCallUsdc, tags }
  │       ──▶ serviceId: "svc_xxxxxxxx"
  │
  ├─[3]─ Provider 端点实现规范
  │         POST https://your-api.com/endpoint
  │         headers: { X-Synapse-Service-Id, X-Synapse-Invocation-Id }
  │         body: <Consumer payload>
  │         response: { result: any }
  │
  ├─[4]─ Gateway health-ping → endpoint returns 200 → status: "healthy"
  │
  ├─[5]─ Consumer 调用 → 原子结算 → provider_receivable↑
  │       GET /balance ──▶ { providerReceivableUsdc: "9.0000" }
  │
  └─[6]─ POST /balance/withdraw
           ──▶ SynapseCore.withdraw() ──▶ USDC → Provider wallet
```

---

## 5. 页面结构

### 5.1 Overview (`/docs/getting-started`)
- 两张大卡片：Consumer / Provider
- 每张卡片：角色描述 + 预计时间 + 步骤预览 + CTA 按钮
- 无侧边栏导航锚点

### 5.2 Consumer / Provider 各页
- 顶部页眉：角色标识 + 预计时间
- 步骤进度条（Step 01~06，水平连线）
- 每步：编号 + 标题 + 说明文字 + 代码块 + Tips
- 底部：下一步推荐卡片

### 5.3 侧边栏更新
```
GETTING STARTED
  Overview
  Consumer Guide      → /docs/getting-started/consumer
    ├ Auth
    ├ Deposit USDC
    ├ Discover Services
    ├ Create Credential
    └ Invoke & Settle
  Provider Guide      → /docs/getting-started/provider
    ├ Auth
    ├ Register Service
    ├ Endpoint Spec
    ├ Health Check
    ├ View Earnings
    └ Withdraw USDC
```

---

## 6. 视觉设计

- Consumer 主色：`#7ff7be`（绿）— 代表"消费/流出"
- Provider 主色：`#6eb6f6`（蓝）— 代表"收益/流入"
- 步骤连接线：水平 `/` 分隔，active 步骤左侧绿色边框高亮
- 代码块语言标签：与步骤颜色一致

---

## 7. 测试方案

| 测试用例 | 验证点 |
|---------|-------|
| T1 Overview 渲染 | 两张角色卡片可见 |
| T2 Consumer CTA | 点击跳转 `/docs/getting-started/consumer` |
| T3 Provider CTA | 点击跳转 `/docs/getting-started/provider` |
| T4 Consumer 6步 | 6 个 section id 存在 |
| T5 Provider 6步 | 6 个 section id 存在 |
| T6 Sidebar links | Consumer / Provider 链接激活正确 |
