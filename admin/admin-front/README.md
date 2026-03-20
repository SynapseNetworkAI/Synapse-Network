# admin-front

平台管理员前端控制台项目。

推荐技术栈：

- Next.js
- TypeScript
- 独立域名，例如 `admin.synapse.network`
- 企业 SSO + MFA

目录说明：

- `src/app/`: 页面与路由入口
- `src/components/`: 通用 UI 组件
- `src/features/`: 按业务域拆分的后台功能模块
- `src/services/`: 对 `gateway-admin` 的前端 API 调用封装
- `src/hooks/`: 复用 hooks
- `src/lib/`: 权限、格式化、常量、前端工具
- `public/`: 静态资源

第一期建议优先实现的页面：

1. 管理员登录与 MFA
2. 平台 Dashboard
3. 充值异常排查页
4. 审批任务中心
5. 提现审核页
6. 退款审核页
7. 审计查询页

当前已补齐 Next.js App Router 基础配置，并提供以下占位页面：

- `/login`
- `/dashboard`
- `/approvals`
- `/users`
- `/role-permissions`
- `/menu-config`
- `/audit`
- `/execution`
- `/finance`
- `/withdrawal-reviews`
- `/risk`
- `/system`

当前左侧导航已升级为可配置菜单树：

- 菜单配置文件：`src/lib/navigation.ts`
- 已发布菜单配置获取：`src/lib/use-admin-navigation.ts` 通过 `gateway-admin` 的 publish 版本拉取导航
- 权限过滤逻辑：基于当前管理员 `role + permissions` 动态裁剪可见菜单项
- 页面统一壳子：`src/components/admin-shell.tsx`
- CRUD 基础组件：`src/components/crud.tsx`，统一抽出 Toolbar + Table + Drawer 骨架
- 会话守卫：`src/lib/use-admin-session.ts`
- 导航形态：二级 accordion 菜单树，一级分组承载模块域，二级节点承载具体路由
- 视觉风格：对齐 Gateway Console 的黑色 Web3 dark mode，使用深黑背景、暗金属边框、霓虹绿激活态、`IBM Plex Mono` 展示数字和标识

当前已落地的控制面功能：

- 后台用户页：使用标准 CRUD 页面范式提供搜索、角色筛选、数据表格、Drawer 表单，并支持创建、编辑、删除（软禁用）后台用户
- 角色权限页：基于共享 CRUD 基础组件承载后端角色模板、权限域分组和治理约束
- 菜单配置页：改为真实的服务端配置中心工作台，支持 draft 编辑、删除、新增和 publish 全局发布
- 审计页：读取 `/api/admin/v1/audit/actions` 展示操作日志
- 执行队列页：读取 `/api/admin/v1/execution-jobs`，支持失败任务重试
- 资金运营页：读取 finance read model，并承接充值 / 退款 / 提现模块入口
- 提现审核页：读取 `/api/admin/v1/withdrawal-reviews`，对 provider manual review 单执行 approve / reject
- 风控工作台：承接风险工单、标签和名单处置模块入口
- 系统运维页：读取系统状态与 operations read model

`/menu-config` 的真实 draft / publish 流程说明：

- draft 是服务端草稿工作区，不再落在浏览器 `localStorage`
- `/menu-config` 页面所有新增、编辑、删除动作都直接写入 `gateway-admin` 的 draft 快照
- published 是当前全局生效版本，`src/components/admin-shell.tsx` 通过 `src/lib/use-admin-navigation.ts` 优先拉取 published 配置并渲染侧边栏
- 管理员在 `/menu-config` 里看到的是 draft 版本，因此可以先连续调整菜单树，再显式点击 publish
- publish 发生时，当前 draft 会整体覆盖 published，之后所有后台页面在下一次加载导航时都会读取到新版本
- 前端会同时展示 `draftVersion`、`publishedVersion` 和 `isDirty`，用于判断当前是否存在未发布变更
- 如果配置中心暂时不可用，前端仍会回退到 `src/lib/navigation.ts` 内置静态菜单，避免后台壳子不可进入

这套流程解决的问题：

- 菜单编辑不再是单浏览器本地状态，而是团队共享、服务端持久化的控制面配置
- 菜单改动与全局生效拆成两步，避免边编辑边影响所有管理员的在线导航
- `Toolbar + Table + Drawer` 已沉淀为共享 CRUD 基础组件，后续配置型页面可复用同一套工作台骨架与交互节奏

当前已接入第一版 `gateway-admin` 接口：

- 登录页调用 `/api/admin/v1/auth/login`
- Dashboard 调用 `/api/admin/v1/auth/me`、`/api/admin/v1/dashboard/overview`、`/api/admin/v1/dashboard/system-status`，以及 3 个稳定读模型接口：`/finance-overview`、`/activity-trends`、`/operations-overview`
- 审批页调用 `/api/admin/v1/approvals`
- 提现审核页调用 `/api/admin/v1/withdrawal-reviews` 与 `/api/admin/v1/withdrawal-reviews/{withdrawalId}/decision`
- 后台用户页调用 `/api/admin/v1/users`、`/api/admin/v1/users/roles`
- 菜单配置页调用 `/api/admin/v1/config/menu-items` 与 `/api/admin/v1/config/menu-items/publish`
- 审计页调用 `/api/admin/v1/audit/actions`
- 执行队列页调用 `/api/admin/v1/execution-jobs`、`/api/admin/v1/execution-jobs/{jobId}/retry`

本地开发默认请求 `http://localhost:8300`，可通过环境变量 `NEXT_PUBLIC_ADMIN_API_BASE_URL` 覆盖。
