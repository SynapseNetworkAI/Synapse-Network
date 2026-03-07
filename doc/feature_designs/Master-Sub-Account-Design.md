# 智能体舰队主子账户与资金池调度设计 (Master-Sub Account Architecture)

## 1. 业务愿景与场景定义 (Vision & Use Cases)

在 A2A-Pay 的 **Master Fleet Control** 中，单一开发者（如企业、个人黑客）通常需要管理多台同时执行不同任务的 AI Agents。为了兼顾**资金安全、风控隔离**以及**AI的自动化运行**，系统需要建立一套层级分明的「主子账户与资金池流转」体系。

* **主账户（Master Account）作为资金母池**：负责统筹资金注入、利润沉淀与全局宏观的资金管理。
* **子账户（Sub-Account / Agent Wallet）作为突击队**：各 Agent 独立持有专属生成的子钱包，具备微型沙盒隔离特性。即便某个 Agent 的私钥泄漏或发生逻辑故障，损失也严格控制在该子账户的有限余额内。

---

## 2. 账号体系生命周期与初始化 (Lifecycle & Initialization)

### 2.1 主账户创建 (Master Account Generation)
* 用户在 Dashboard 完成注册或初始登录后，系统将为其生成或要求挂载一个全局**主账户 (Master Account Wallet)**。
* 这是系统内 Developer 的顶级财权账号，持有主要 USDC 资金储备。

### 2.2 Agent 与子账户绑定 (Agent Sub-Account Binding)
* 开发者每次点击 `Deploy Agent`，系统使用纯前端加密学或本地 SDK 随机生成一个新的以太坊钱包。
* 这个新钱包地址直接映射为该 AI 实体的**子账户**。
* **从属关系**：在后端数据库中，该子账户地址严格外键（Foreign Key）挂靠在主账户的实体 ID 之下。

---

## 3. 核心流转与风控机制 (Fund Routing & Risk Control)

为了让子账户始终保持在“有钱干活”但又“不能卷款跑路或挥霍”的稳态，设计以下两大核心调度机制：

### 3.1 消费限额控制机制 (Spending Bounds)
系统为每个子账户引入 **“每日花费上限 (Daily Spending Limit)”** 概念。
* **规则配置**：允许主账户修改子账户的单日支出上限（如：设置 Buyer Agent 每天最多花费 50 USDC 去购买数据）。
* **拦截逻辑**：
  * **(软阻断 - Indexer API 层面)**：Agent 发起 `Escrow.lock` 创建任务前，通过 SDK 校验其今日累计支出是否超过 Daily Limit。若超逾，则直接返回错误，阻塞其上链发包。
  * **(硬阻断 - Smart Contract 层面，推荐进阶版)**：利用账户抽象（Account Abstraction）将子账户部署为智能合约钱包，在合约内部通过 `mapping(uint256 => uint256) dailySpent` 强制锁定每日对外支出的资产。

### 3.2 资金调拨机制 (Fund Allocation Flow)
支持在主账户和子账户之间的双向资金转移（Transfer）。

#### A. 手动调拨 (Manual Action)
* **下拨充值 (Fund / Top-up)**：主账户主动向特定的 Agent 子账户转入固定金额的代币，作为启动资金。
* **利润归集 (Sweep / Withdraw)**：当 Agent（如 Seller）赚取了大量闲置代币，开发者一键将子账户余额清空（留存必要的 Gas），全部转回主账户金库。

#### B. 自动化规则策略 (Automated Rules - 自动化与手动并存)
开发者可为每个 Agent 进行高度自定义的资金策略配置（Smart Rules），支持**纯手动触发**或**自动阈值触发**：
* **自动补仓配置 (Auto Top-up Configuration)**
  * **模式选择**： `[Manual (手动)]` / `[Auto (自动)]`
  * **触发阈值 (Min Threshold)**：如果选择 Auto，用户可自定义触发红线（例如：当子账户余额 $< 100 \text{ USDC}$ 时）。
  * **补仓动作 (Top-up Amount)**：当触发阈值时，自动从主账户中划转指定的定额（例如：自动补充 $500 \text{ USDC}$），确保其爬虫、算力采买等耗资任务不中断。
* **自动抽水/利润归集配置 (Auto Sweep Configuration)**
  * **模式选择**： `[Manual (手动)]` / `[Auto (自动)]`
  * **触发阈值 (Max Threshold)**：如果选择 Auto，用户可自定义利润累积水位线（例如：当子账户赚取的余额 $> 5000 \text{ USDC}$ 时）。
  * **执行动作 (Retain Amount)**：当触发抽水时，自动将超出**基础留存额**（例如：只留存 $50 \text{ USDC}$ 应对基础 Gas，该值也可配置）以上的所有利润自动全额打包并转回大后方主账户金库。这能有效防范前端暴露的 AI 沙盒堆积过多巨额头寸，规避被攻破的黑天鹅风险。

---

## 4. 全局记账与独立流水系统 (Ledger & Transaction History)

因为存在主、子账户概念，后台 Indexer 数据库的账单模型需要升维：

### 4.1 实体抽象扩展
后端 `client_db` 需要记录完整的映射关系与配置：
* `AccountEntity`: 记录主账户。
* `AgentConfigModel`: 记录绑定至主账户的 Agent 子地址、`daily_limit`、`auto_fund_rule` 等。

### 4.2 基于标签的全局流水表 (Unified Ledger Tabulation)
流水表记录所有的资产流向，必须区分为以下三大标签机制：
1. **外部支出 (External Expense, 红)**
   * 发起方：Agent 子账户
   * 接收方：外部系统的第三方 Agent
   * 动作：调用智能合约付出任务佣金（支出）。
2. **外部收入 (External Revenue, 绿)**
   * 发起方：第三方系统 / 第三方 Agent
   * 接收方：Agent 子账户
   * 动作：完成任务后收取的酬金与数据利润（收入）。
3. **内部划转 (Internal Transfer, 灰/蓝)**
   * 发起与接收：`Master ↔ Sub-Account` (仅限内部实体之间)。
   * **Fund (主补给子)** 或 **Sweep (子归集主)**。
   * 重要：内部划转**不能算作**整体 Fleet (舰队) 产生的盈利或额外总支出，它只是一种内部仓位转移。

---

## 5. 前后端与 UI/UX 落地蓝图 (UI Integration Plan)

* **注册与开户 (Onboarding)**：
  * 在 Developer 首次登陆后，弹窗要求“Mint/Connect Master Workspace Wallet”。
* **主控大屏 (Fleet Dashboard)**：
  * 面板顶部显示的是 **总资金池 (Aggregated Balance = Master Balance + Sum(Sub Balances))**。
  * 列表区域则明确划分为 Master Wallet 与一组 Agent Sub-Wallets。
* **智能体配置面板 (Agent Setting Card)**：
  * 增加表单区域：【Daily Limit (USDC)】，【Auto-fund Trigger ($)】，【Auto-sweep Trigger ($)】。
* **全局流水视图 (Transactions/Ledger UI)**：
  * 提供一个类支付宝/银行账单的页面，左侧是全局的按天时间线，右侧显示流水的种类。
  * 增加下拉筛选器（Filter）： `All` | `Expenses` | `Revenues` | `Internal Transfers`。

---

## 5. UI 角色物理隔离与发单风控 (Role-Based Action Segregation)

在去中心化担保 (Escrow) 状态机下，只有资金提供方可以主动 Lock 资金生成待揭榜任务。因此：
* **角色设定**：开发者为主账户下的每个 Sub-Agent 设定显式物理角色（如 Buyer/Purchaser，Seller/Work Node）。
* **UI组件过滤**：当开发者或 API 在发起 `publish_task` (发布任务) 时，UI 表单及底层路由应**严格过滤仅允许身份涵盖 "Buyer" 的子钱包触发担保锁定操作**。系统防止打工型 (Seller) 账号由于误设产生违背业务流的资金锁定，从而实现第一道物理业务屏障。
