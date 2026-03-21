# Admin Workspace

该目录用于承载平台管理后台的独立代码，与交易网关 `gateway/` 做边界隔离。

当前规划：

- `admin-front/`: 平台管理员前端控制台
- `gateway-admin/`: 平台管理员后端控制面 API

## gateway-admin 项目介绍

`gateway-admin` 是 Synapse Network 的平台管理员后端控制面，定位不是面向普通用户的业务 API，而是面向平台运营、财务、风控、审计团队的受控管理入口。

它的核心作用是把所有高风险后台动作收敛到独立的 control plane：管理员登录、角色权限、审批流、配置发布、审计追踪、执行任务编排，都在 `gateway-admin` 内部完成，再由它以受控方式调用 `gateway/` 的内部管理接口。这样做的目标很直接：把交易网关的高频计费主链路和后台治理链路彻底解耦，避免管理后台逻辑侵入资金结算主路径。

职责边界上，`gateway-admin` 主要负责：

- 管理员认证、Session、CSRF、TOTP 等后台安全机制
- RBAC / 高风险操作 step-up 校验
- 审批单、执行任务、审计日志等控制面真相数据
- 菜单配置中心的 draft / published 发布治理
- Provider 提现人工审核、execution retry 等高风险运营动作
- 聚合读取 gateway 的只读 projection，为 dashboard 和运营页提供稳定查询面

它不是 `gateway/` 的简单路由转发层，而是独立部署、独立鉴权、独立审计、独立存储的后台控制面服务。`gateway/` 继续专注 Agent Runtime 的发现、报价、扣费、结算等高频链路；`gateway-admin` 则专注平台治理、审批编排和后台安全边界。这种拆分能保证两条链路各自演进，不互相污染。

当前 `gateway-admin` 已经落地的核心能力包括：

- 后台用户目录、角色模板与权限矩阵
- 菜单配置中心的 draft / publish 流程
- 统一审批队列与 provider 提现人工审核
- execution job / attempt 执行与重试编排
- 管理员审计日志与 dashboard 聚合查询

如果把 `gateway/` 理解成 Synapse 的资金与调用高速公路，那么 `gateway-admin` 就是这条高速公路上方的塔台和控制中心，负责谁能操作、操作是否合规、变更是否经过审批、风险动作是否能被完整追踪。

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

当前已落地的财务控制面能力：

- Provider 提现人工审核工作台：`/withdrawal-reviews`
- `gateway-admin` 提供待审核列表与 approve / reject 代理接口
- `admin-front` 直接消费该接口，避免浏览器暴露内部 gateway 凭据
