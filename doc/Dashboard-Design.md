# A2A-Pay / NoCenterPay 人类控制台 (Dashboard) 设计文档

## 1. 核心定位
**“神之视角与限流阀” (God Mode & Throttle Valve)**
AI 负责在阴暗的服务器里高频打工和花钱，而这个 Dashboard 是专为**人类老板 (Human Owner)** 打造的视觉与操纵界面。老板需要在这里感受到掌控感（发预算）和收益感（看进账）。

## 2. 设计美学与 UI 风格 (Cyberpunk & Terminal Vibe)
- **主色调**：极致的深邃黑 (`#060606`) 搭配 矩阵荧光绿 (`#00FFA3`)。
- **排版风格**：类似极客终端 (Terminal) 的直角框、等宽字体 (Monospace / Fira Code)。
- **动效**：微交易的实时跳动、数据流的滚动、面板的金属霓虹发光。
- **情感传递**：高科技、无情、高效的机器印钞工厂。

## 3. 面板核心功能区 (Core Modules)

### 3.1 鉴权与金库区 (Top Bar)
- **Web3 Wallet Connect**：右上角连接人类老板的老鼠/硬件钱包 (MetaMask)。
- **Treausury Balance**：醒目地显示当前主金库余额（例如：`1,240.50 USDC`）。

### 3.2 核心监控首屏 (Stat Overview)
- **💵 累计盈利 (Total Earned)**：AI 卖数据为你赚的总收入。
- **💸 今日花销 (Spent Today)**：AI 买数据今天支出的总额。
- **🔥 平台燃烧费 (Protocol Tax)**：你交给 AgentPay 的保护费统计。

### 3.3 智能体授权工厂 (Agent Session Key Management)
这是**控制台最核心的交互功能**，相当于“办理附卡”。
- **Create Session Key**: 一键为一个新的 AI 脚本生成私钥。
- **Set Daily Limit**: 拨动滑块设置每日防暴走熔断额度（例如 `$10/Day`）。
- **Key List**: 列表展示所有活跃的 Agent 附卡（包括：调用次数、今日已用额度进度条、吊销按钮 `Revoke`）。

### 3.4 神经流实时账单 (Live Transaction Feed)
完全抛弃传统银行的 PDF 账单，采用类似终端日式的滚动信息流：
- `[14:02:11] 🤖 Agent-Alpha paid $0.05 to Agent-Hex for [Weather_API].`
- `[14:02:12] 💰 Agent-Beta received $2.00 for [Image_Generation].`
- `[14:02:15] 🛑 Agent-Delta EXCEEDED LIMIT ($10.05/$10.00) - Tx Blocked!`

---

## 4. 技术栈选型 (Tech Stack)
- **框架**: `Next.js 14` (App Router)
- **样式**: `Tailwind CSS` (快速堆砌赛博朋克极简 UI)
- **图标**: `lucide-react`
- **Web3 交互 (预期)**: `wagmi` + `viem` (第一版 MVP 先用纯 UI Mock，后续接真实合约)

---
*“人类不需要干预交易，人类只需要看着屏幕上的数字跳动，并随时准备拔掉电源。”*
