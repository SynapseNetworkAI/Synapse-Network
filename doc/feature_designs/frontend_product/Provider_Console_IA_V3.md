# Provider Console IA V3 (Apple x Cloud Infra)

## 1. 目标

Provider Console 从“单页承载所有表格”升级为“控制台首页 + 专项工作页”结构，降低认知负担并提升可维护性。

设计参考：
- Google Cloud / AWS Console 的信息架构分层：总览页负责状态摘要，详情页承载操作与审计。
- Apple 风格的信息节奏：主数据优先、低噪声、层级克制、状态色谨慎使用。

## 2. 新导航结构（Provider Space）

- My Services: `/dashboard/sell`
- Access Keys: `/dashboard/secrets`
- Network Nodes: `/dashboard/provider/nodes`
- Settlements: `/dashboard/provider/settlements`
- Usage Analytics: `/dashboard/usage`
- Treasury Ledger: `/dashboard/billing`

## 3. 首页职责（/dashboard/sell）

首页只做三件事：
1. KPI 摘要：Net / Gross / Calls / Active Nodes
2. Deploy Pipeline（2 Steps）：
   - Step 01 Access Keys
   - Step 02 Publish API
3. 导航卡片：
   - Registered Network Nodes -> `/dashboard/provider/nodes`
   - Settlement Pipeline -> `/dashboard/provider/settlements`

不再在首页承载大表格，避免首屏信息过载。

## 4. 工作流约束

### 4.1 Publish API 前置校验
- 点击 Publish API 前必须检查 seller secrets（Access Keys）是否存在。
- 无 key 时强制跳转 Access Keys 页面创建。
- 原因：防止服务发布后处于不可签名验证的脆弱状态。

### 4.2 命名策略
- 用户文案统一使用 “Access Keys”。
- 技术实现层继续使用 seller secret key / HMAC key。

## 5. 页面职责拆分

### 5.1 Network Nodes 页面
- 展示服务节点、endpoint、serviceId、定价、状态。
- 面向运维与发布校验。

### 5.2 Settlements 页面
- 展示结算口径与最近流水：gross / protocol fee / routing tax / net。
- 强调 request_id 去重后的统计可信度。

## 6. 一致性要求

- 文档与代码同批更新。
- 新路由上线时，侧边导航必须同步。
- Homepage 风格基线继续遵循 `doc/01_Product_Vision/Design.md` 的 95/5 色彩策略。
