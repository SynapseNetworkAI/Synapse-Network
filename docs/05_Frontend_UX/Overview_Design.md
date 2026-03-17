# Control Plane Overview Design (Vercel/Stripe Routing Hub Style)

## 1. 核心目标 (Core Objective)
将 `/dashboard/overview` 重构为一个极简、目标导向的“分发枢纽 (Routing Hub)”。
消除所有复杂的数据图表和深层管理按钮，让新登录的 Owner 能够以最少的认知负载，一秒钟理解平台提供的两大核心双擎能力，并直接跳转。这就如同 Vercel 或 Stripe 的控制台般克制和纯粹。

## 2. 视觉参考与布局 (Visual & Layout Strategy)

### 2.1 极简头部与胶囊金库 (Header & Vault Badge)
- **Header**: 极其克制的欢迎语，例如 "Welcome to Synapse Network."，不使用巨大字号，维持 Dev-Luxury 质感。并且增加 `max-w-5xl` 将内容向中间聚拢。
- **Vault Badge**: 将繁重的“余额面板”缩小化处理，放在右上角。采用精致的胶囊组件 (Badge)，内部左侧带有极小的绿色呼吸灯点圈，文字使用 `font-mono` 显示 USDC 余额。点击整颗胶囊即进入充值中心。

### 2.2 核心双卡片布局 (The Twin Engines - Bento Box)
采用 CSS Grid 两列均配布图。卡片本身需要有微弱的毛玻璃或质感十足的描边，并在 Hover 时展现细腻的光泽。
- **Card 1: Agent Workspace (买家/消费侧)**
  - **Icon**: `Bot`
  - **Copy**: "Fund your agents and let them consume APIs autonomously."
  - **CTA**: 
    - 实心赛博绿主按钮: `[Create Agent]` (连向大盘与密钥系统)
    - 幽灵辅按钮: `[Explore APIs]` (连向发现市场)
- **Card 2: Provider Workspace (卖家/供给侧)**
  - **Icon**: `Database`
  - **Copy**: "Expose your services to the network and earn USDC instantly."
  - **CTA**: 
    - 亮色边框主按钮 (蓝亮基调): `[Register Service]` (连向注册节点上架)
    - 幽灵辅按钮: `[View Earnings]`

### 2.3 底部极简活动流 (Recent Activity)
- 取消之前笨重的数据表格。
- 以“极其低调的灰色小字”标记板块。
- 采用空状态或单条引导文本（例如: "No recent activity. Launch an agent or register a service to get started."）。

## 3. 设计原则对齐 (Aligned with Agent Principles)
- **"Agent First" 的体现**: 因为是 for agent，所以留给 human 的界面应当极度“降噪”。由于 Owner 只是做初始网关配置与拨款，界面不应提供过度密集的“人肉分析面板”。
- **统一身份 (Unified Owner)**: 把两端能力并列在同一个主控台枢纽中，印证 `00_Platform_Role_Identity_Model.md` 中讲述的同一账户能充当不同职能（买家与卖家）。