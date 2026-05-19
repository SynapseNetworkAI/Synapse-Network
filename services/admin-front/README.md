# admin-front

`admin/admin-front/` 是平台管理员前端控制台项目。

## 文档入口

1. 项目导航页：`docs/03_Projects/admin-front/README.md`
2. 本地开发说明：`docs/03_Projects/admin-front/Admin_Front_Local_Development.md`
3. 子项目规则：`admin/admin-front/AGENTS.md`

## 常用关注点

1. 管理员登录、MFA enrollment、step-up。
2. Dashboard、审批、菜单配置、审计、执行、提现审核等后台页面。
3. 默认通过 Next.js 同源代理把 `/api/admin/*` 转发到 `gateway-admin`。

## 说明

本文件现在只保留项目入口信息。
完整页面现状、联调方式、安全约束与控制面说明统一维护在根 `docs/03_Projects/admin-front/`。
