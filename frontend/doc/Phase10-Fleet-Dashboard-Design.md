# Phase 10: Multi-Agent Fleet Management & SaaS Dashboard Design (子钱包与多智能体舰队图景)

## 1. 核心需求背景 (Context)
随着平台的演进，Dashboard 已经不再是一个仅供测试的“玩具”，而是一个需要具备**商业化 SaaS 属性**的 AI 金融管理控制台。
人类老板（或高级 AI 协调者 Orchestrator）需要一个账号系统来管理他们名下的多名“AI 打工人”（Agents）。每个 Agent 独立运行、拥有独立财务、并向主控账号进行数据汇总。

---

## 2. 账号体系设计 (Account & Wallet Architecture)

本阶段核心是从“单机游乐场”转向“主从账户模型（Master - Sub-account）”。

### 2.1 注册与登入机制 (Authentication)
* **混合登录模式 (Hybrid Auth)**：
  * **Web2 方式**：邮箱 + 密码注册，适合普通用户。注册后，系统会在前端/后端为其**自动生成**一个 Master 钱包地址。
  * **Web3 方式**：使用 MetaMask/WalletConnect 授权登录。已有的钱包将作为主控钱包 (Master Wallet) 绑定到该账户。
* **账户层级**：
  * **Master 账户 (Owner)**：人类/AI Orchestrator 的主视角。掌控总资金，负责向下级 Agent 分发 Gas/本金，或将 Agent 赚取的利润抽成（Sweep）回 Master 账户。

### 2.2 Agent 子钱包生成逻辑 (Sub-Wallet Generation)
* 在用户账号内，每次点击 `[创建新 Agent]`：
  1. 需要用户输入：Agent 名称、角色描述、初始资金配置。
  2. 底层通过 `ethers.Wallet.createRandom()` 为该 Agent 动态生成一个新的 EOA (Externally Owned Account) 钱包。
  3. **密钥保存策略**：
     * *去中心化模式*：私钥通过用户的登录密码进行 AES 对称加密，密文保存在本地 `localStorage` 或云端数据库。在 Dashboard 渲染时，需要输入主密码解密展示。
     * *隔离模式*：提示用户自行下载 `.txt` 的私钥文件，供实际部署 Python Agent 时读取。

---

## 3. 大屏仪表盘结构设计 (Dashboard UI Structure)

Dashboard 必须具备高度聚合的“舰队看板”感受，整体分为三个主要模块：**全局态势 (Global Overview)**、**舰队指挥部 (Agent Fleet)**、**个体分析 (Agent Analytics)**。

### 3.1 模块一：全局商业态势 (Global Overview)
位于 Dashboard 的最上方，汇总了该用户所拥有的所有 AI 的综合表现。
* **Agent 活跃度**：总 Agent 数量 / 今日在线运行的 Agent 数量。
* **总资产盘点 (Total Balance)**：所有子钱包 USDC 余额 + Master 钱包余额的总和。
* **总账单流 (Aggregated P&L)**：
  * `今日总收入 (24h Revenue)` 
  * `今日总支出 (24h Expense)`
  * `净利润 (Net Profit/Loss)`
* *可视化*：可以使用折线图 (Chart.js / Recharts) 展示最近 7 天所有 Agent 的总现金流趋势。

### 3.2 模块二：舰队列表 (Agent Fleet Table / Cards)
以卡片或数据表格的形式列出该账号下创建的所有子 Agent：
* **基本信息**：Avatar头像、Agent 名称、角色描述 (e.g. "Data Screener", "Ticket Buyer")、钱包地址截断展示。
* **当前状态**：🟢 闲置 (Idle) / 🔵 交易中 (In Transaction) / 🔴 异常停机 (Halted)。
* **资产快照**：当前 USDC 余额。
* **快捷操作动作区**：
  * `充值 (Fund)`：从 Master 主账户向该 Agent 转入 10 USDC。
  * `归集 (Sweep)`：将该 Agent 赚取的资金一键转回主账户。
  * `查看详情 (Details)`。

### 3.3 模块三：单一 Agent详情页 (Individual Agent Analytics)
点击特等 Agent 进入详情面板：
* **私钥管理箱**：查看私钥、更新二维码、重置密钥（仅供系统初始化时）。
* **独立财务报表**：仅针对该 Agent 计算的 `今日收入` / `今日支出`。
* **全量交易历史 (Transaction History)**：该子钱包发生的 `支付`、`收款`、`争议处理` 等明细列表，并在附带 On-chain TxHash 的区块浏览器链接。

---

## 4. 技术栈选型与实现路径

| 领域 | 选型与方案 |
| :--- | :--- |
| **Auth 鉴权** | NextAuth.js 或 Privy（支持 Web2 邮箱登录 + Web3 钱包无缝登录/创建）。对于仅作 Demo 的黑客松，可以继续使用加密的 LocalStorage 模拟 User System。 |
| **持久化存储** | 需要引入真实的数据库（例如 PostgreSQL + Prisma/Drizzle），存储 `Users` 和 `Agents` 表。 |
| **On-chain 查询** | 通过我们之前写的 `Python Indexer`，通过传入某个用户的系列 Agent 地址列表（`?addresses=0x1,0x2`），过滤并聚合属于该用户的区块事件，计算出 `今日总净收支`。 |
| **图表展示** | 采用 `recharts` 渲染财务柱状图和流水折线图。 |

---

## 5. 后续迭代建议：资金池与智能合约授权
目前的设计是“每个 Agent 生成一个独立的 EOA 私钥”。对于中大型系统而言，更优雅的设计是**去中心化资金池模式 (Vault/Allowance)**：
- Agent 钱包不长期持有资金（易被黑客窃取）。
- Master 账户将钱存入 A2A-Pay 智能合约的 Vault。
- Master 同意 Agent 地址对 Vault 享有一定额度的 `Allowance (授权扣款)`。 
- Agent 用自己的私钥签名交易，扣取的是 Vault 里的额度。这样既保护了主金库，又方便随时一键“吊销”某个 Agent 的财务权限。