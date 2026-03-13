# 💰 Synapse Network: Billing & Usage 资金流与微支付架构设计

## 1. 架构警报与核心哲学 (The Philosophy)

兄弟，你刚才的思路极度精准！这恰恰是 Web3 支付和传统 SaaS 最大的区别：**高低频隔离**。

- **存款 (Deposit) / 取款 (Withdraw/Refund)**：这是链上（On-chain）操作！低频、有 Gas 成本、金额较大（10u, 100u）。
- **API 消费 (API Calls)**：这是链下（Off-chain）M2M 网关操作！极高频（百万次）、免 Gas、单笔金额极小（0.001u）。

如果把“链上几十刀的充值”和“成千上万条 0.001 刀的调用”塞进一个表格里，前端不仅会卡死，用户的认知也会彻底崩溃。

因此，**我们要将【资产中心 (Billing/Funds)】与【数据分析 (Usage/Analytics)】进行物理+逻辑上的双重隔离！**

---

## 2. 页面重构蓝图 (Page Architecture)

建议将目前的资金展示重构为两个相互独立的页面系统：

### 页面 A: `Billing & Funds` (资产与账单中心)
> **定位**：低频的、真实的 On-chain 资产变动。

无论是 Buyer 还是 Seller，在这个页面只关心**钱的进出**。

#### 核心面板布局：
1. **Wallet 资金槽 (Treasury)**
   - Buyer 视角：当前保险库余额 (Vault Balance)。
   - Seller 视角：待提现收益 (Claimable Earnings)、累计已缴平台费。
2. **资金流水聚合表 (Funds Ledger)**
   - **将“充值 (Deposit)”和“退款/结算 (Withdraw)”合并为一张表**。
   - 字段设计：
     - `Type`: 🔼 Deposit (充值) | 🔽 Refund (退款) | 🔽 Claim (提现)
     - `Amount`: 资金数量 (+/- USDC)
     - `TxHash / TX Status`: 链上状态表征 (On-chain) 
     - `Timestamp`: 时间戳
     - `Status`: Cyber Node Status (PENDING/COMPLETED)
   - *逻辑：一目了然地看到宏观账户的注水和抽水。*

---

### 页面 B: `Usage & Analytics` (调用聚合与明细中心)
> **定位**：高频的、极其细颗粒度的 Off-chain 服务调用统计。

这是“赛博幽灵”们交战的地方。这个页面不关心“你是怎么把钱充进来的”，只关心“钱是怎么被每毫秒消耗掉的”。

#### 核心面板布局：
1. **Buyer 侧视角面板 (My Consumption)**
   - **宏观统计**：过去 24 小时总 API 花费、调用总次数。
   - **高频流水表 (Micro-transactions)**：
     - 字段：`Service ID`, `Agent (API Key)`, `Unit Price`, `Total Calls`, `Micro-total`
     - *UI 建议：按 API 组合或按小时段进行聚合(Rollup)，绝对不要直接渲染数十万条流水。*
2. **Seller 侧视角面板 (My API Earnings)**
   - **收益雷达**：哪个 Buyer 调用的最多？排名前 3 的大客户是谁？
   - **流量仪表盘**：接口 TPS、总拦截次数（余额不足/鉴权失败）。
   - **接口创收明细**：
     - 字段：`Buyer Address`, `Service Endpoint`, `Successful Calls`, `Gross Revenue`

---

## 3. 最终演进路径 (Execution Roadmap)

根据这个架构重构，我们的前端工程（`/frontend/src/app/dashboard`）需要做如下路线拆分：

- [ ] **Step 1: 改造 `/billing` (本期核心)** 
  - 下线之前混杂的 `ServicePaid` 高频展示。
  - 合并 `Deposit` (充值) 和 `Refund/Withdraw` (结算提现) 为极简的“进账/出账”聚合流水表。
- [ ] **Step 2: 新增 `/usage` 或 `/analytics`** 
  - 专注呈现来自后台 Python 聚合的 API 调用日志。
  - 引入可视化图表（Recharts），绘制赛博风格的微支付消耗雷达与折线图。
- [ ] **Step 3: 路由左侧剥离**
  - 重新梳理 Sidebar，让用户一眼明白界限：
    - 🏦 **Billing & Funds** (管钱，对链上)
    - 📈 **API Usage** (管流量，对链下)

## 总结
**“上帝的归上帝，凯撒的归凯撒”**。链上资金（宏观）和链下交互（微观）的彻底隔离，才是 Stripe-like 基础设施真正该有的优雅骨骼。