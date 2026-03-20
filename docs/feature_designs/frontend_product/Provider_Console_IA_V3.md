# Provider Console IA V3 (Apple x Cloud Infra)

## 1. 目标

Provider Console 从“单页承载所有表格”升级为“控制台首页 + 专项工作页”结构，降低认知负担并提升可维护性。

设计参考：
- Google Cloud / AWS Console 的信息架构分层：总览页负责状态摘要，详情页承载操作与审计。
- Apple 风格的信息节奏：主数据优先、低噪声、层级克制、状态色谨慎使用。

## 2. 新导航结构（Provider Space）

- My Services: `/provider/sell`
- Access Keys: `/provider/secrets`
- API Services: `/provider/services`
- Settlements: `/provider/settlements`
- Revenue Analytics: `/provider/usage`

兼容策略：

1. `/provider/**` 是当前 Provider 工作空间的 canonical 入口。
2. 历史 `/dashboard/**` 页面保留为兼容壳，不再作为新交互和新文档的主入口。
3. `/provider/nodes` 已删除；产品和文档统一使用 `/provider/services`。
4. Owner 资金账本保留在 `/dashboard/billing`；Provider 财务面拆分为 `/provider/settlements` 与 `/provider/usage`。

## 3. 首页职责（/provider/sell）

首页只做三件事：
1. KPI 摘要：Net / Gross / Calls / Active Services
2. Deploy Pipeline（2 Steps）：
   - Step 01 Access Keys
   - Step 02 Publish API Service
不再在首页承载大表格，也移除 Nodes/Settlements 导航卡片，避免首屏信息过载。

## 4. 工作流约束

### 4.1 Publish API 前置校验
- 点击 `New Service` / `Publish API Service` 前必须检查 provider secrets（Access Keys）是否存在。
- 无 key 时强制跳转 Access Keys 页面创建。
- 原因：防止服务发布后处于不可签名验证的脆弱状态。

### 4.2 命名策略
- 用户文案统一使用 “Access Keys”。
- 技术实现层继续使用 provider secret key / HMAC key。

## 5. 页面职责拆分

### 5.1 API Services 页面
- 页面命名统一为 API Services。
- canonical route: `/provider/services`
- 展示 API service、endpoint、serviceId、定价、状态。
- 支持 Service ID / 服务名模糊搜索。
- 支持状态筛选（All / Online / Offline）。
- 搜索区采用紧凑工具条（输入框 + 状态下拉 + Search 按钮），点击 Search 后更新列表。
- 点击 Search 时若钱包未连接，前端直接唤起 RainbowKit Connect 弹窗；已连接则继续执行筛选流程。
- 支持分页浏览。
- 支持从列表进入 `Edit Service`、启停、删除和 Health 页面。
- `Edit Service` 仅允许编辑 `inactive` 服务；当服务仍为 `active` 时，前端必须给出“先切到 Inactive 再编辑”的即时提示。
- 服务列表中的状态按钮需要紧邻 `Edit`，支持一键把在线服务切到 `Inactive`；编辑浮层支持 `Esc` 快速关闭。
- 若存在 `/dashboard/services` 等 legacy 入口，其服务编辑、启停、删除规则必须与 `/provider/services` 保持一致，禁止出现双标准交互。
- 面向运维、发布校验和 Service Definition 生命周期管理。

### 5.2 Settlements 页面
- 支持 RequestId 搜索与 Service 模糊搜索。
- 搜索区采用紧凑工具条并使用 Search 按钮触发过滤，避免输入时频繁重算。
- 点击 Search 时若钱包未连接，前端直接唤起 RainbowKit Connect 弹窗；已连接则继续执行筛选流程。
- 支持分页浏览。
- 表格字段统一：RequestId / Service / Gross / Protocol Fee / Routing Tax / Net / Call Time。
- 强调 request_id 去重后的统计可信度。

### 5.3 Revenue Analytics 页面
- `Refresh Data` 使用荧光绿主按钮（符合资金与状态信号色策略）。
- 点击 `Refresh Data` 时若钱包未连接，前端直接唤起 RainbowKit Connect 弹窗；已连接则继续刷新数据。

## 6. 一致性要求

- 文档与代码同批更新。
- 新路由上线时，侧边导航、Homepage CTA、Marketplace CTA 必须同步。
- Homepage 风格基线继续遵循 `docs/Design.md` 的 95/5 色彩策略。
