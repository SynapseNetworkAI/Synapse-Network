# 管理后台文档

该目录用于沉淀平台管理后台的独立设计文档，与交易网关文档做边界隔离。

当前文档：

- [平台管理后台架构设计](./Platform_Admin_Backoffice_Architecture.md)
- [控制总览 IA 重构设计](./Control_Overview_IA_Redesign.md)
- [管理后台资金链路数据观测指标设计](./Admin_Funds_Observability_Metrics_Design.md)
- [Admin 与 Gateway 安全方案设计](./Admin_Gateway_Security_Design.md)
- [管理后台数据库设计](./Admin_Database_Design.md)
- [管理后台 PostgreSQL 部署与账号权限设计](./Admin_PostgreSQL_Deployment_Design.md)
- [管理后台第一期 API Contract](./Admin_API_Contract_Phase1.md)
- [管理员角色权限矩阵设计](./Admin_RBAC_Design.md)
- [管理后台审批流设计](./Admin_Approval_Workflow.md)
- [管理后台审计与合规设计](./Admin_Audit_and_Compliance.md)
- [管理后台财务操作手册](./Admin_Finance_Operations_Runbook.md)

当前实现约束补充：

- `admin/gateway-admin/agents.md` 是 `gateway-admin` 子目录的 AI 执行硬规则，作用是让代码代理在该目录内默认遵守分层、权限、测试、文档同步和环境约束。
- `GET /api/admin/v1/dashboard/diagnostics` 是 admin 控制面的统一诊断语义层，dashboard 与 `/system` 必须复用同一份诊断结论与建议动作，避免两套系统状态口径。
