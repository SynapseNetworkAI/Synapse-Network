# Synapse Documentation Page — 设计方案

## 1. 参考原型

**X Developer Platform docs** (`https://docs.x.com/overview`)：
- 顶部品牌栏 + 搜索框
- 左侧固定导航树（可折叠分类 → 子页面链接）
- 主内容区：Hero + Products 卡片网格 + Get Started 引导 + Resources 块
- 页脚链接 + 社区入口

---

## 2. 产品定位与用户目标

Synapse-Network Documentation 服务三类读者：

| 读者 | 主要目标 |
|------|---------|
| **消费方开发者 (Consumer Dev)** | 快速完成充值、创建 Credential、调用 Agent API |
| **Provider 开发者** | 注册服务、配置 pricing、监控调用与收益 |
| **集成者 / SDK 使用者** | 理解 TypeScript SDK 与链上合约接口 |

---

## 3. 页面结构

### 3.1 整体布局（1440px desktop 基准）

```
┌─────────────────────────────────────────────────────────────────┐
│ NAVBAR（全宽，同现有 Navbar 一致）                               │
├────────┬────────────────────────────────────────────────────────┤
│        │                                                        │
│ LEFT   │  MAIN CONTENT                                          │
│ SIDEBAR│                                                        │
│ 240px  │  [Hero Banner]                                         │
│ fixed  │  [Quick Start Cards × 3]                              │
│        │  [Products Grid]                                       │
│        │  [API Reference Table]                                 │
│        │  [Resources Footer]                                    │
│        │                                                        │
└────────┴────────────────────────────────────────────────────────┘
```

### 3.2 左侧导航树

```
OVERVIEW
  ├─ Introduction
  └─ Architecture

GETTING STARTED
  ├─ Quick Start (5 min)
  ├─ Authentication
  └─ Deposit USDC

CORE CONCEPTS
  ├─ How Settlement Works
  ├─ Service Registry
  ├─ Agent Credentials
  └─ Idempotency

API REFERENCE
  ├─ Auth
  ├─ Balance
  ├─ Services
  ├─ Agent Invocations
  └─ Credentials

SDK
  ├─ TypeScript SDK
  └─ Python SDK  [SOON]

SMART CONTRACTS
  ├─ SynapseCore
  └─ MockUSDC (Testnet)

RESOURCES
  ├─ Changelog
  ├─ Status
  └─ Community
```

### 3.3 主内容区 Hero Block

- 大标题：`Synapse Developer Platform`
- 副标题：`AI Agent 经济基础设施 — 链上充值 · 链下结算 · 毫秒级调用`
- Badge: `MAINNET BETA` (荧光绿)
- CTA 按钮：`Quick Start →` (white) + `View API Reference` (ghost)
- 背景：微弱的绿色放射渐变 (同 globals.css 现有 radial-gradient 基调)

### 3.4 Quick Start Cards（3列）

| 卡片 | 图标 | 标题 | 描述 | 角标 |
|------|------|------|------|------|
| Consumer | ⚡ | Use an Agent Service | 充值 → Credential → 调用 | 5 min |
| Provider | 📡 | Register a Service | 注册 → 定价 → 上线 | 10 min |
| SDK | 📦 | TypeScript SDK | npm install → import → invoke | NEW |

### 3.5 Products Grid（2列，参考 X docs 产品卡）

| 产品模块 | 描述 | 状态 |
|----------|------|------|
| **Gateway API** | 结算网关核心 REST API | GA |
| **Service Registry** | Provider 服务注册与发现 | GA |
| **Agent Credentials** | 消费方凭证颁发与生命周期 | GA |
| **Settlement Engine** | 链下扣费 + 链上 USDC 结算 | GA |
| **Deposit Indexer** | 链上充值监听 + 自动确认 | GA |
| **Webhooks** | 调用回调与事件推送 | SOON |

### 3.6 API Reference 摘要表

快速路由表，提供 Method + Path + 一行描述，供开发者快速扫描：

```
POST   /api/v1/auth/verify          获取 JWT
GET    /api/v1/balance              查余额
POST   /api/v1/balance/deposit/intent  登记充值
POST   /api/v1/services             注册服务
GET    /api/v1/services/discover    发现服务
POST   /api/v1/credentials/agent/issue  颁发凭证
POST   /api/v1/agent/quotes         获取报价
POST   /api/v1/agent/invocations    执行调用
```

### 3.7 Resources Block（3列）

- Changelog — 版本更新日志
- Status Page — 系统实时状态
- GitHub — 开源合约与 SDK
- Discord — 开发者社区（SOON）

---

## 4. 视觉规范

### 颜色与背景
- 页面背景：同 `globals.css` body 的深空黑 + 顶部荧光绿 radial-gradient
- 侧边栏背景：`#0a0a0c`，右侧竖线 `1px rgba(255,255,255,0.05)`
- 激活导航项：左侧 3px 荧光绿竖条 + `rgba(127,247,190,0.06)` 浅底
- 卡片：`x-tile-flat` + hover `x-tile-flat-hover`
- 状态 badge：
  - `GA` → 荧光绿底 + 绿字
  - `BETA` → 蓝底
  - `SOON` → 钛灰底 + 白字

### 字体层级
- 页面大标题：`x-page-title` (clamp 30→34px, weight 800)
- 侧边栏分类：`x-overline-label` (11px, uppercase, letter-spacing 0.12em)
- 侧边栏链接：`x-meta-label` (13px)
- 卡片标题：`x-card-title` (17-18px, bold)
- 正文：`x-body-copy` (15px, #71767b)
- API 方法标签：等宽字体，`text-xs`

### 响应式策略
- `< 768px`：侧边栏收起为 hamburger drawer
- `768–1024px`：侧边栏折叠为图标模式（可展开）
- `> 1024px`：三列布局全展开

---

## 5. 交互行为

1. **侧边栏锚点高亮**：页面滚动时，当前可见 section 的导航项自动激活（IntersectionObserver）
2. **分类折叠**：点击分类标题可折叠/展开子项（默认全展开）
3. **代码块复制**：所有代码片段右上角有 copy 按钮
4. **搜索（未来扩展）**：`⌘K` 呼出快捷搜索 overlay（当前可预留 UI 入口，功能标记 TODO）
5. **外链 badge**：API Reference 中的 gateway 路由点击可跳转 `/dashboard`

---

## 6. URL 路由

- 主页：`/docs`
- 子页（未来）：`/docs/[slug]` — 静态 MDX 渲染
- 当前实现：单页 (`/docs/page.tsx`)，所有内容内联，锚点跳转

---

## 7. 测试方案

### 7.1 自动化验证目标

| # | 验证项 | 手段 |
|---|--------|------|
| 1 | 页面可正常渲染，无 hydration error | Playwright navigate + snapshot |
| 2 | 左侧导航所有分类可见 | snapshot text check |
| 3 | Hero 大标题可见 | assert `Synapse Developer Platform` text |
| 4 | 3 张 Quick Start 卡片可见 | count cards |
| 5 | Products Grid 6 个卡片可见 | count items |
| 6 | API Reference 表格可见 | check method labels |
| 7 | 侧边栏激活项高亮（首屏 Overview 激活）| check active class |
| 8 | 导航分类可折叠（点击 → 子项消失）| click + snapshot |
| 9 | CTA 按钮可点击，跳转正确路由 | click + URL assert |
| 10 | 全页面截图存档 | screenshot → `output/playwright/docs-page.png` |

### 7.2 执行命令

```bash
export PWCLI="$HOME/.codex/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" open http://localhost:3002/docs --headed
"$PWCLI" screenshot --path output/playwright/docs-overview.png
```
