# admin-front

- Status: canonical
- Code paths: `admin/admin-front/`, `docs/03_Projects/admin-front/`
- Verified with: `npm run ci:admin-front`, `npm run ci:docs`
- Last verified against code: 2026-03-25

## 1. 项目定位

`admin/admin-front/` 是 Synapse 的平台管理员前端控制台。

它负责：

1. 管理员登录、MFA 与 step-up 交互
2. Dashboard、审批、用户、审计、执行、提现审核等后台页面
3. 消费 `gateway-admin/` 的控制面接口并渲染后台工作台

一句话：这是平台运营、财务、风控、审计团队的浏览器端控制面，而不是用户控制台。

## 2. 代码位置

- 项目目录：`admin/admin-front/`
- 本地说明：`admin/admin-front/README.md`
- 项目规则：`admin/admin-front/AGENTS.md`
- 页面与组件：`admin/admin-front/src/`

## 3. 职责边界

`admin-front/` 应该承担：

1. 管理员控制面的页面与交互体验
2. 对 `gateway-admin/` 的后台接口消费
3. draft / publish、step-up、审批与运营视图的浏览器侧工作流

`admin-front/` 不应该承担：

1. 后台业务真相存储
2. Owner-facing 主站与主控制台
3. 链上资金、账本和扣费规则
4. Provider 独立服务逻辑

## 4. 直接依赖关系

1. 强依赖 `admin/gateway-admin/` 提供后台 API
2. 受根 `docs/admin/` 里的后台产品与控制面文档约束
3. 与 `apps/frontend/` 共享部分设计语言，但职责完全不同

## 5. Canonical 文档入口

1. `docs/admin/README.md`
2. `docs/01_Product_Frontend/03_Admin_Control_Plane_Architecture.md`
3. `docs/admin/Platform_Admin_Backoffice_Architecture.md`
4. `docs/admin/Admin_API_Contract_Phase1.md`

## 6. 项目内贴身文档

根 `docs/03_Projects/admin-front/` 当前集中维护：

1. [Admin_Front_Local_Development.md](./Admin_Front_Local_Development.md)
2. [Admin_Front_Agent_Rules.md](./Admin_Front_Agent_Rules.md)

项目目录内只保留：

1. `admin/admin-front/README.md`
2. `admin/admin-front/AGENTS.md`

其中 `admin/admin-front/README.md` 现在只保留入口壳，`admin/admin-front/AGENTS.md` 作为本地执行镜像保留；完整规则统一维护在 [Admin_Front_Agent_Rules.md](./Admin_Front_Agent_Rules.md)。