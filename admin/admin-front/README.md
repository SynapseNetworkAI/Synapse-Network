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

当前已接入第一版 `gateway-admin` 接口：

- 登录页调用 `/api/admin/v1/auth/login`
- Dashboard 调用 `/api/admin/v1/auth/me`、`/api/admin/v1/dashboard/overview`、`/api/admin/v1/dashboard/system-status`
- 审批页调用 `/api/admin/v1/approvals`

本地开发默认请求 `http://localhost:8300`，可通过环境变量 `NEXT_PUBLIC_ADMIN_API_BASE_URL` 覆盖。
