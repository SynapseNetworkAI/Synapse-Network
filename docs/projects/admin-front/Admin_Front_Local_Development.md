# Admin Front Local Development

`admin/admin-front/` 是 Synapse 的平台管理员前端控制台项目。

## 项目结构

```text
admin/admin-front/
├── src/app/         # 页面与路由入口
├── src/components/  # 通用 UI 组件
├── src/features/    # 按业务域拆分的后台功能模块
├── src/services/    # 对 gateway-admin 的前端 API 调用封装
├── src/hooks/       # 复用 hooks
├── src/lib/         # 权限、格式化、常量、前端工具
└── public/          # 静态资源
```

## 当前本地开发重点

当前后台前端已经包含以下关键能力：

1. 管理员登录与 MFA enrollment / step-up。
2. Dashboard、Analytics 多页面观测、审批、用户、角色权限、菜单配置、审计、执行、资金、提现审核、风控、系统页。
3. 基于 `gateway-admin` 可见菜单接口的服务端导航裁剪。
4. 基于 `HttpOnly` session cookie + 内存态 `csrfToken` 的后台会话模型。

Analytics 入口位于 `控制总览 > 控制台 > Analytics`，当前拆成 `/dashboard/analytics` 总览页和 `consumer-funnel`、`invocation-revenue`、`provider-revenue`、`money-flow`、`risk-health`、`data-quality` 六个专题页。所有页面保持只读，数据来自 `gateway-admin` 的 `/api/admin/v1/dashboard/analytics/*` 聚合接口。

## 本地联调说明

本地开发默认通过 Next.js 同源代理访问 `/api/admin/*`，再由 `admin-front` 转发到 `http://localhost:8300`。

本地启动与验证统一使用 Yarn：

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/admin-front
yarn install
yarn dev
yarn lint
yarn test
yarn build
```

`yarn dev` 默认监听 `http://localhost:3200`。不要在 `services/admin-front` 下执行 `npm install` 或重新生成 `package-lock.json`；仓库级 `npm run ci:admin-front` 仍可作为聚合门禁入口，内部会调用 Yarn。

可选环境变量：

1. `ADMIN_API_PROXY_TARGET`: 修改代理目标地址。
2. `NEXT_PUBLIC_ADMIN_API_BASE_URL`: 仅在需要让浏览器直连外部管理 API 域名时使用；本地 `localhost` / `127.0.0.1` 联调默认不要设置它，避免 MFA 登录后的 session cookie 落到不同 host，导致 `/dashboard` 会话检查被踢回 `/login`。

这样做是为了规避浏览器侧跨域、`localhost / 127.0.0.1 / LAN IP` 差异导致的登录与 MFA 失败。

## 安全约束

1. 当前 cookie 默认策略为 `HttpOnly + SameSite=Lax`。
2. 开发环境默认不强制 `Secure`。
3. 生产环境必须启用 HTTPS，并设置 `ADMIN_SESSION_COOKIE_SECURE=true`。
4. 高风险动作统一通过 step-up modal 收集 `X-Admin-OTP-Code`。

## 开发约束

1. 页面行为、IA、权限语义先对齐根 `docs/admin/`。
2. 页面视觉与交互先对齐 `admin/admin-front/stitch/` 原型。
3. 子项目编码与 UI 规则见 [Admin_Front_Agent_Rules.md](./Admin_Front_Agent_Rules.md)。

## 相关文档

1. [README.md](./README.md)
2. [Admin_Front_Agent_Rules.md](./Admin_Front_Agent_Rules.md)
3. [../../admin/README.md](../../admin/README.md)
4. [../../01_Product_Frontend/03_Admin_Control_Plane_Architecture.md](../../01_Product_Frontend/03_Admin_Control_Plane_Architecture.md)
