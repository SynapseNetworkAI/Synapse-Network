# 买家 Synapse Network Overview 页面设计

## 1. 页面定位
本页面作为买家（API 服务调用方）登录 Synapse Network 后的专属概览页。旨在帮助买家快速了解平台价值、核心服务，并提供核心操作入口（入驻、充值、退款）以及实时的账户与调用数据。

## 2. 页面结构划分
页面 URL 建议: `/dashboard/buyer-overview`

### 2.1 Hero Section (顶览与平台介绍)
*   **平台是做什么的 (What is Synapse?)**: ”Synapse Network 致力于为 AI Agent 之间的交互提供无缝、低延迟的加密支付基础设施。这里是买家的专属控制台。“
*   **能为买家提供什么服务 (Value Proposition)**: 
    *   ⚡ **API 聚合与发现**: 快速发现全网优质的 Agent 接口服务。
    *   🪙 **按需付费 (Pay-As-You-Go)**: 抛弃高昂的包月订阅，依据实际 API 调用次数精确计费（USDC 等稳定币）。
    *   � **极速 0 Gas**: 采用“链上充值 + 离链网关秒扣”架构。成千上万次的高频调用与扣费完全在高速网关内存级完成，零 Gas 且亚毫秒级延迟，提供媲美 Web2 的丝滑体验。
*   **入驻操作区 (Call to Action)**: 
    *   主按钮: **「如何接入 / 获取 API Key」** -> 跳转至 **Developer Console (`/dashboard/console`)**，引导买家生成专属凭据来进行调用。

### 2.2 数据看板区 (Data Dashboard)
这部分展现买家在接入后的核心财务与调用指标（四张高光卡片）：
1.  **账户余额 (Account Balance)**
    *   显示：当前买家钱包对应的平台内部余额 (e.g., `120.50 USDC`)
    *   操作：附带一个“去充值 (Deposit)”入口，引导向金库合约质押资金。
2.  **今日花费 (Today's Spend)**
    *   显示：过去 24 小时或当天内所有 API 调用的总扣费。
3.  **今日接口调用次数 (Today's API Calls)**
    *   显示：当天成功调用的接口总数。
4.  **系统状态 / 异常调用阻断次数 (Status)**
    *   显示：凭据安全状态、失败的调用等。

### 2.3 资金与退款说明区 (Refunds & Settlement)
*   **如何退款 (How to Refund / Withdraw)**:
    *   说明文档或区域：“如果您不需要继续调用接口，可随时向平台发起退款请求。平台将清算离链账本，并为您开出一张‘赛博银票 (EIP-712 签名)’。您可以凭借这张银票，在链上金库一键提取剩余资金至原生钱包。”
    *   操作按钮: **「申请退款提取 (Claim Refund)」** -> 唤起智能合约 Withdraw 交易，带上 Gateway 签名，直接提取资金。

### 2.4 调用日志区 (Activity & Call Logs)
这是一个表格，展示实时的接口使用明细，帮助买家对账：
*   **Timestamp / 时间**: 调用的具体时间。
*   **Service Name / 调用的服务**: 比如 `OpenAI GPT-4 Wrapper` 或 `Data Scraper Agent`。
*   **Endpoint / 路由**: `POST /api/v1/query` 等。
*   **Cost / 扣费金额**: 单次请求扣费金额 (e.g., `0.05 USDC`)。
*   **Status / 状态**: Success / Failed。
*   **Request ID / 流水号**: 对应网关离链切账的唯一流水号，保证账目清晰可对账。

## 3. 下一步前端开发建议
1. 提取当前 `page.tsx` (全局总 Overview) 中的通用组件（如 Hero、数据看板）。
2. 将路由进行拆分：
   * `/dashboard/buyer` (买家专属 Overview)
   * `/dashboard/provider` (卖家专属 Overview)
3. 按照此 Markdown 中的数据模型去扩充 `useDashboardData.ts`（增加买家视角的今日调用次数、账单查询逻辑）。
