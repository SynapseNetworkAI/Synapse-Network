# Synapse Network 角色隔离与前端设计文档 (大马演示特供)

## 1. 业务背景与演示目标
为迎接 28 号大马之行的关键演示，系统需要从单一视角（开发者与平台混用）过渡到**清晰的多角色隔离视图**。投资人和观演者需要看到完整的**双边市场模型**（生态平台/提供方/消费方），并且这三个角色在前端表现上应该互不干扰。

基于 `ROADMAP.md` 优先级 1 的要求和 `frontend_v1_optimization.md` 中的视角解耦理念，本设计对现有系统提出前端的改进和演练说明。

## 2. 角色定义与环境隔离沙盘

在演示现场或测试环境中，我们需要通过**不同的浏览器进程**及**不同的 MetaMask 账户**来严格代表不同参与方：

| 角色 | 缩写 | 本质定位 | 演示钱包职责 | 前端视角/入口 |
| :--- | :--- | :--- | :--- | :--- |
| **Owner (平台方)** | Admin | Synapse Network 系统拥有者 | `0xf39...` 拥有金库管理员权限 | 专门的 Admin 面板 (全局监控 / 提现利润) |
| **Seller (服务提供方)** | Provider | 接入 AI 模型并定价者 | 任意新地址 (如 Browser C) | Provider Space (服务上架 / 收入结算) |
| **Buyer (API 消费方)** | Consumer | 充值 USDC并购买 AI API者 | 拥有 USDC 筹码的地址 (Browser B) | Consumer Space (开发者控制台 / 充值 / API Key) |

### 隔离建议方案
*   **平台方**：使用 Chrome 浏览器 + Profile 1 (或 Edge)。
*   **买家方**：使用 Chrome 浏览器 + Profile 2 (或 Brave 浏览器)。
*   **卖家方**：使用 Safari / Firefox 或独立的 Chrome Profile 3。
*   *目的*：彻底杜绝“左右互搏/本地存储串号/钱包会话混用”导致的演示穿帮。

## 3. 前端导航设计：UI 模式解耦

将原本揉杂在一起的侧边栏/顶部导航进行**降维切割**，用户在登录后可以明确选择自己的主要身份，或者通过不同的左侧分组来进行业务操作。

### 3.1 导航栏结构设计草图

```text
=========================================================
[ Logo Synapse Network ]   网关节点状态: 🟢 Online (Sepolia)
=========================================================
|
| 🔽 CONSUMER SPACE (买家视角)
|   ├─ 💻 Developer Console (充值、开 Key、复制调用代码)
|   ├─ 🔍 Discover Services (浏览卖家市场)
|   └─ 📊 Usage & Billing (调用消费流水)
|
| 🔽 PROVIDER SPACE (卖家视角)
|   ├─ 🤖 My Services (创建服务、定价、上传网关 Endpoint)
|   └─ 💰 Settlement (被调用统计、收入提现)
|
| 🔽 ADMIN SPACE (仅平台 Owner 可见)
|   ├─ 📈 Global Dashboard (全盘流水、手续费归集池)
|   └─ ⚙️ Vault Management (平台抽水提取、系统参数设置)
|
=========================================================
```

## 4. 各个角色的“Wow Experience”核心页面

### 4.1 买家 (Consumer) 核心体验
**核心页面：Developer Console (控制台)**
这是整个演示的 C 位，需要给非 Web3 原生开发者一种类似 Stripe 的流畅体验。
*   **动作 1：傻瓜式获取筹码**。如果检测到用户当前是测试网且余额不足，出现显眼的 `[ Faucet: Get 100 Test USDC ]`，点击一键获取。
*   **动作 2：无感充值**。输入充值金额 -> 点击 `[ Add Funds ]` -> (内部代为处理 Permit 签名和 deposit 串行调用) -> 显示绚丽的成功 Loading 动画 -> 页面顶部的 USD 余额增加。
*   **动作 3：一键开 Key 与应用**。点击 `[ Create API Key ]`，拿到短小精悍的 Token (`agt_xxxxx`)。旁边直接配以代码块区块：
    ```python
    from synapse_client import SynapseClient
    client = SynapseClient(api_key="agt_xxxxx")
    res = client.call_service("DeepSeek-Chat", prompt="Who are you?")
    ```

### 4.2 卖家 (Provider) 核心体验
**核心页面：My Services & Settlement**
卖家最关心的是如何定价以及如何提现。
*   **动作 1：极速上架**。点击 `[ Register Service ]` -> 填入服务名（如 Llama3-Trader）、每调用一次的 USDC 价格（如 0.05 USDC）以及服务器网关 Endpoint -> 签名提交到平台注册表。
*   **动作 2：坐等收钱 (Settlement)**。提供一个动态更新的看板：
    *   *Total Invocations (总调用次数)*: 125 
    *   *Unclaimed Revenue (待结算收入)*: 6.25 USDC
    *   一键 `[ Withdraw to Wallet ]` 按钮，展示资金到账的小狐狸提示，完成利润闭环演示。

### 4.3 平台方 (Admin) 核心体验
**核心页面：Global Dashboard**
展现平台的商业模式（怎么赚钱）。
*   **动作 1：抽水展示**。合约中记录的 `platformFeePool`（平台无形抽水收的过路费）直观展示在页面上，如 `Protocol Fee Accrued: 1.50 USDC`。
*   **动作 2：平台提款**。Owner 登录时，能够看到专属的 `[ Claim Platform Fees ]` 按钮，演示将抽水提取到自己的管理员钱包。

## 5. 异常处理与降级策略 (防翻车)
在大马演示现场，极易发生以下网络与交互灾难，必须硬编码降级提示（把红色底层报错翻译成人话）：

1.  **"Insufficient Balance" (余额不足)**：
    *   *UI 应对*：拦截底层 JsonRpcError，弹出红色温馨提示囊括：“USDC 余额不足，请点击右侧按钮获取测试币”。
2.  **"User Rejected Request" (用户点击了拒绝签名)**：
    *   *UI 应对*：取消 Loading 动画，并在控制台无害地提示“已取消交易签名”，禁止使得整个页面变成红底崩溃页。
3.  **串号保护**：
    *   *UI 应对*：如果当前 LocalStorage 中的 `AuthSession` (JWT) 和 MetaMask 连入的钱包地址不符，强制弹出 “The wallet address has changed, please re-sign to synchronize sessions”以刷新本地会话。

## 6. 行动步骤总结 (Action Items)

1.  **改造 Layout**：修改现有的侧边栏路由，硬分出这三个大类 (Consumer, Provider, Admin)。
2.  **提取 Admin 判定**：前端根据连入钱包的地址是否为 `0xf39...`（或合约里的 owner）来隐藏或显示 Admin 菜单。
3.  **重构充值与开 Key 组件**：将原先极客化的多级参数表单干掉，统一为 “一键充值”、“一键开 Key (内置默认时长与频控)”；确保 loading 状态长达数秒以覆盖完整上链过程。
4.  **跑通双开测试**：你本人用两个 Chrome Profile，一个创建 Llama 服务 (定 0.05 价格)，另一个转账并拿 Key 消费。观察水流：买家钱少，卖家 Settlement 钱变多，平台池也增加。如果跑通，代表这套商业级金融基建叙事正式成立。