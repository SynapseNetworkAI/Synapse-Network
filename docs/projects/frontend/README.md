# frontend

- Status: canonical
- Code paths: `apps/frontend/`, `docs/03_Projects/frontend/`
- Verified with: `npm run ci:frontend`, `npm run ci:docs`
- Last verified against code: 2026-03-25

## 1. 项目定位

`apps/frontend/` 是 Synapse 面向 Owner / Developer 的主前端控制台。

它负责：

1. 展示平台定位、产品入口与主控制台
2. 承接用户对 Gateway 的充值、余额、服务发现与调用观测
3. 提供 Agent-first 运行时的可视化辅助入口

一句话：这是 Owner 面向 Synapse Runtime 的用户控制台，不是后台管理系统。

## 2. 代码位置

- 项目目录：`apps/frontend/`
- 页面入口：`apps/frontend/src/`
- 配置文件：`apps/frontend/package.json`、`apps/frontend/next.config.mjs`
- 本地说明：`apps/frontend/README.md`
- 项目规则：`apps/frontend/AGENTS.md`

## 3. 当前运行约束

1. 包管理统一使用 Yarn
2. 本地常用命令：`yarn install`、`yarn dev`、`yarn test`
3. 仓库级前端门禁：根目录 `npm run ci:frontend`

## 4. 职责边界

`apps/frontend/` 应该承担：

1. Owner-facing 信息架构与主控制台体验
2. 对 `gateway/` 的公开运行时接口消费
3. 让人类完成授权、充值、预算设定与观测

`apps/frontend/` 不应该承担：

1. 平台管理员控制面
2. 管理员审批与审计
3. Provider 独立服务实现
4. SDK 运行时封装

## 5. 直接依赖关系

1. 主要消费 `gateway/` 的公开运行时接口
2. 受根 `docs/01_Product_Frontend/` 与 `docs/Design.md` 约束
3. 与 `sdk/python/` 共享同一套 Runtime 契约，但面向对象不同

## 6. Canonical 文档入口

1. `docs/01_Product_Frontend/README.md`
2. `docs/Design.md`
3. `docs/06_Reference/04_Development_Testing_and_Integration_Reference.md`
4. `docs/06_Reference/01_API_Contract_Index.md`

## 7. 项目内贴身文档

根 `docs/03_Projects/frontend/` 当前集中维护：

1. [Frontend_Local_Development.md](./Frontend_Local_Development.md)
2. [Frontend_Agent_Rules.md](./Frontend_Agent_Rules.md)
3. [Synapse_Analytics_Tracking_Plan.md](./Synapse_Analytics_Tracking_Plan.md)
4. [Docs_Page_Function_and_Verification.md](./Docs_Page_Function_and_Verification.md)
5. [Docs_Page_Verification_Runbook.md](./Docs_Page_Verification_Runbook.md)
6. [User_Front_Page_Function_and_Verification.md](./User_Front_Page_Function_and_Verification.md)
7. [User_Front_Page_Verification_Runbook.md](./User_Front_Page_Verification_Runbook.md)
8. [User_Front_Page_Verification_Result_2026-04-18.md](./User_Front_Page_Verification_Result_2026-04-18.md)
9. [User_Feedback_and_Forum_Design.md](./User_Feedback_and_Forum_Design.md)

项目目录内只保留：

1. `apps/frontend/README.md`
2. `apps/frontend/AGENTS.md`

其中 `apps/frontend/README.md` 现在只保留入口壳，`apps/frontend/AGENTS.md` 作为本地执行镜像保留；完整规则统一维护在 [Frontend_Agent_Rules.md](./Frontend_Agent_Rules.md)。
