# 🧠 退款与提现明细 (Refund History UX Design)

## 0. 核心抉择：放在哪里最合适？

关于“查看退款（提现）记录应该加在哪”，我们要从 Synapse Network 的多重身份设计（买家、卖家、平台）以及**信息的财务属性**来进行推演。

如果分析我们现有的菜单架构：
* `Developer Console (API 开发者/卖家)`：专注的是注册服务、查看流量和提取**营收**。不涉及“退回买家预储值”的逻辑，这里坚决不能放。
* `Buyer Console (买家控制台)`：这是一个高频入口，专注于申请 API Key，管理余额，查看快捷用量指标，以及触发快速结算操作。
* `Billing (财务中心 / 账单中心)`：这是目前统筹所有“历史花销明细”、“充值流水”、“对账单”的重型核算页面。

### 📌 最终结论架构：加在 `Billing (账单中心)` 页面中！
**理由**：
1. **金融聚类原则**：提现 (Refund/Withdraw) 与充值 (Deposit) 和高频扣费 (Costs) 属于标准的资金变动（Ledger Flow）。用户天然的认知习惯是：“要在总账本里找每一笔钱的来龙去脉”。
2. **轻量化 Buyer 页面**：Buyer Console 是大盘总控，负责“操作 (Actions: 充钱、生 Key、取钱)”。而流水类的细账留给 Billing 是行业标配最佳实践（类似于 Stripe、AWS 的设计）。

---

## 1. Billing 页面 UI / UX 设计详述

我们需要在 `frontend/src/app/dashboard/billing/page.tsx` 中新增一个独立的板块或者 Tab：**Withdrawal & Refunds (提现与退款明细)**。

### 1.1 数据结构映射 (Data Mapping)
前端将通过 GET `/api/v1/refunds/history` 类似接口拉取状态机中的流水。
展示的数据来源即后端的 `refund_intents.json` (或将要迁移的 DB 表)：
* `tx_hash` (链上交易哈希)
* `amount` (金额 USDC)
* `status` (当前状态：PENDING 或 COMPLETED)
* `created_at` (申请时间)

### 1.2 信息展示形式 (Data Table)
建议使用一个现代化的赛博风格 Data Table（深色底，边框细致）。

**表头字段 (Columns)**:
| 时间 (Date) | 类型 (Type) | 变动金额 (Amount) | 状态 (Status) | 链上凭证 (TxHash) |
| --- | --- | --- | --- | --- |
| `2026-03-12 18:32:00` | Account Settlement | `- 50.00 USDC` | 🟡 `PENDING` (确认中) | `-` |
| `2026-03-11 09:12:05` | Account Settlement | `- 120.40 USDC` | 🟢 `COMPLETED` (已完成) | `0x1f2...a9b 🔗` (跳转区快浏览器) |

### 1.3 “赛博节点” 状态提示语言 (Cyber Node Status Visuals)
为了配合 Synapse Network 的极客风，状态提示必须极其清晰：
* 🟡 **PENDING (确认中/待上链)**：
  - **颜色**：琥珀色 / 警告黄 (`text-yellow-400 bg-yellow-500/10`)
  - **提示 (Hover Tooltip)**：“平台已开具赛博银票并冻结离链余额。等待您在钱包中签署确认上链交易，或者区块同步网络正在为您核实该笔链上动账。”
* 🟢 **COMPLETED (已完成)**：
  - **颜色**：数据流亮绿 (`text-green-400 bg-green-500/10`)
  - **提示 (Hover Tooltip)**：“此网关提款已成功结算至您的钱包。资金流转已完成。”

### 1.4 上下文连贯性 (Contextual Links)
* 如果用户在 `Buyer Console` 页面刚刚点完了“结算取现”，此时 `Toast.success` 弹窗弹出的提示应该带有一个引导性质的链接：
  > ✅ "网关银票结算成功，请于钱包确认。**点击此处前往 账单中心(Billing) 查看提现实时进展。**"

## 2. 需配合落地的后端新增接口

为了让 Billing 页面能渲染上述组件，Python SDK 后台需增加一个查询自己名下提款记录的只读接口。

### `GET /api/v1/refunds`
* **鉴权**: 必须带有 `Depends(require_auth)` 且认证通过获得 `wallet_address`。
* **业务逻辑**: 读取 `load_refund_intents()`，清洗并过滤出 `intent["buyer_address"] == wallet` 的所有记录。
* **返回格式**: 按时间倒序排序 (DESC)。
```json
{
  "status": "success",
  "data": [
    {
       "timestamp": 1713009000,
       "amount": 50.00,
       "type": "refund",
       "status": "PENDING",
       "txHash": null
    }
  ]
}
```