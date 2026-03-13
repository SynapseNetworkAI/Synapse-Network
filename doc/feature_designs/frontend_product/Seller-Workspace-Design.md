# Synapse Network: 卖家工作空间 (Seller Workspace) 设计文档

## 1. 核心定位与设计目标

* **核心定位**: 为提供算力、模型API或数据接口的 AI Agent/开发者（卖家）提供的一站式基建控制台。
* **设计目标**: 
  1. **零门槛认知**: 让卖家一进页面就能看懂：接入非常简单、这玩意能赚钱、提现毫无障碍。
  2. **无需拦截 (Un-gated)**: 允许未连接钱包的用户进入看“热闹和教程”，只在真正需要操作链上数据或生成密钥时强制拦截 (`Connect Wallet`)。
  3. **架构对偶性**: 与买家(Buyer)工作空间的“三步走”设计语言保持高度对称与极客风格。

## 2. 页面路径与全局 Layout

* **路由**: `/dashboard/sell`
* **未登录状态表现**: 
  * 右上角显示原生的 `Connect Wallet` 的高亮发光按钮。
  * 页面主体内容（接入步骤、代码演示、假数据统计盘）完全可见。
  * 所有的交互按钮（如 `Register Service`, `Withdraw`）显示为 `Connect Wallet to Action` 或者置灰，鼠标悬浮时提示“请先链接钱包”。
* **视觉语言**: 延续 `Matrix & Cyberpunk`，黑灰底色，极客荧光绿点缀，强调控制台（Developer Console）和数据仪表盘的基建感。

## 3. UI/UX 模块设计 (自上而下)

### 第 1 模块：Hero Section & 核心数据看板 (KPI Board)
页面顶部的横幅与核心财务指标。如果是未登录状态，显示 “XX 万 USDC 已在网络中结算” 的全局数据或全部为 0；登录后显示个人的真实收益。

* **Headline**: `Monetize Your AI APIs` 
* **Subtitle**: 只需 3 行命令，将你的本地 FastAPI / Agent 变现。零 Gas 扣费，极速结算到链上 Vault。
* **KPI Metrics (4个金刚位数据)**:
  1. **Life-Time Earnings (历史总收入)**: 绿色的数字，比如 `1,245.50 USDC`
  2. **Unclaimed Balance (待提现余额)**: `305.00 USDC` -> 附带一个发光的 `Claim / Withdraw` 按钮。
  3. **Total API Calls (总计调用次数)**: 显示服务被全网买家调用的总次数。
  4. **Active Services (运行中的节点数)**: `2 Online` 伴随呼吸灯动画。

### 第 2 模块：极简 onboarding 的 "三步走" 指南 (How to Earn)
为了让卖家知道“怎么接入，怎么赚钱”，直接在页面核心区域放置横向流水线卡片。这是降低教育成本的核心。

* **Step 1: Register an AI-Native Service Manifest (发布 AI 友好型服务清单)**
  * *文案*: 你的 Web3 钱包即全局唯一法人。无需创建实体，直接登记你的端点(`endpoint`)、探活接口(`health_check`)、调用价格(如 0.01 USDC)，以及限流阀(`max_qps`)。
  * *AI 降维能力*: 配置你的 `agent_tool_name`、`intent` 标签与输入输出 Schema，买方大模型无需写死代码，即可实现 Zero-Code 自动发现与完美传参。
* **Step 2: Setup Gateway & Security (配置本地网关与防白嫖鉴权)**
  * *文案*: 平台基于钱包签名下发唯一的 `Seller_Secret_Key`。使用我们的 Python SDK 包装原有接口，基于 HMAC-SHA256 算法无情拦截绕过网关的裸调“白嫖”流量。
  * *展示*: 提供一个黑色高亮的纯文本代码块（Code Snippet），演示如何混入拦截器启动服务。
* **Step 3: Earn & Request Settlement (持续获利与提现清算)**
  * *文案*: 累积一定收益后，一键将本地记账凭证提交到链上智能合约 (Vault)，全额提取真实的 USDC 到你的钱包。

### 第 3 模块：服务与凭证管理 (My Manifests & Services)
卖家拥有的已发布服务列表（取代原本的 `/dashboard/services` 单独页面，直接作为控制台下半部分，用于管理其全网路由突触及鉴权密钥）。

* **Grid Table**: 已经发布的 Service 列表。
* **主要列**:
  * `Service & Tool Name` (如 `DeepSeek-Chat` | Tool: `get_deepseek_chat`，并附带小字 `Intent` 标签池)
  * `Endpoint & Health` (主业务 URL 和 `health_check` 探活状态。如果探活长时失联，会给卖家发警告提示可能遭到下架)
  * `QoS & Pricing` (如 0.05 USDC/Call，最大承载并发 50 QPS)
  * `Status` (Online / Offline 带绿色呼吸灯)
  * `Actions` (View Secret Key 查看看门密钥, Metrics 数据图表, Edit 修改配置)

### 第 4 模块：实时流水流(Event Stream) & 提现
* **流水表 (Income Ledger)**: 
  * 包含买家调用了什么服务，付了多少钱，平台扣了手续费，净赚多少 (Net Earned)。
  * 状态标识：`Local Recorded` -> `Settling` -> `On-chain Confirmed`。

## 4. 前端交互状态流转 (UX Flow)
1. **游客访问**: 空降 `/dashboard/sell` -> 看到大屏字，酷炫的 SDK 代码片段，和 "三步走" 引导流程。
2. **连接动作**: 点击随意区域的灰化按钮 `Connect Wallet` -> 触发右上角钱包唤醒。
3. **已连接 & 第一次来**: 卡片上方提示：`Welcome! You are 1 step away from earning.`，强引导用户进入 **Step 1** (Publish Service)。
4. **成熟卖家（有服务正在跑）**: 第一眼就能看到 **KPI 收益图表** 和 **服务列表的状态**，重点操作是点击提现。