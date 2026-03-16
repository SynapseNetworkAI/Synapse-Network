# Admin Workspace

该目录用于承载平台管理后台的独立代码，与交易网关 `gateway/` 做边界隔离。

当前规划：

- `admin-front/`: 平台管理员前端控制台
- `gateway-admin/`: 平台管理员后端控制面 API

设计文档请查看：

- `../docs/admin/Platform_Admin_Backoffice_Architecture.md`
- `../docs/admin/Admin_RBAC_Design.md`
- `../docs/admin/Admin_Approval_Workflow.md`
- `../docs/admin/Admin_Audit_and_Compliance.md`
- `../docs/admin/Admin_Finance_Operations_Runbook.md`

第一阶段目标：

1. 明确后台角色、权限、审批和审计边界。
2. 保持后台前后端与交易网关代码隔离。
3. 仅创建骨架，不在本阶段引入具体框架依赖。
