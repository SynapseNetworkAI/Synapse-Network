# gateway-admin

- Status: canonical
- Code paths: `admin/gateway-admin/`, `docs/03_Projects/gateway-admin/`
- Last verified against code: 2026-03-25

## 1. 项目定位

`admin/gateway-admin/` 是 Synapse 的平台管理员后端控制面。

它负责：

1. 管理员认证、Session、CSRF、MFA 与 step-up 校验
2. RBAC、审批流、审计日志与执行编排
3. 菜单配置中心、Provider 提现人工审核等高风险运营动作
4. 聚合读取 `gateway/` 的稳定读模型，给后台提供查询面

一句话：如果 `gateway/` 是高速收费站，`gateway-admin/` 就是控制塔和审批中心。

## 2. 代码位置

- 项目目录：`admin/gateway-admin/`
- 入口说明：`admin/gateway-admin/README.md`
- 本地规则镜像：`admin/gateway-admin/AGENTS.md`
- 核心代码：`admin/gateway-admin/src/`
- 测试目录：`admin/gateway-admin/tests/`

## 3. 项目内贴身文档

根 `docs/03_Projects/gateway-admin/` 当前集中维护：

1. [Gateway_Admin_Local_Development.md](./Gateway_Admin_Local_Development.md)
2. [Gateway_Admin_Operations_Runbook.md](./Gateway_Admin_Operations_Runbook.md)
3. [Gateway_Admin_Environment_Variables.md](./Gateway_Admin_Environment_Variables.md)
4. [Gateway_Admin_Systemd_Deployment_Example.md](./Gateway_Admin_Systemd_Deployment_Example.md)
5. [Gateway_Admin_Agent_Rules.md](./Gateway_Admin_Agent_Rules.md)

当前项目目录内暂时仍保留：

1. `admin/gateway-admin/README.md`
2. `admin/gateway-admin/AGENTS.md`

其中 `admin/gateway-admin/README.md` 现在只保留入口壳；原 `admin/gateway-admin/docs/` 正文已迁入根 `docs/03_Projects/gateway-admin/`。

## 4. 职责边界

`gateway-admin/` 应该承担：

1. 后台控制面 API
2. 独立鉴权与独立审计
3. 高风险后台动作的受控代理
4. 平台治理数据与审批编排

`gateway-admin/` 不应该承担：

1. Owner-facing 高频 Runtime 主链路
2. 链上资金金库逻辑
3. Provider 独立业务接口实现
4. 浏览器侧后台 UI

## 5. 直接依赖关系

1. 被 `admin/admin-front/` 消费为后台控制面 API
2. 通过内部受控接口调用 `gateway/`
3. 读取 `gateway` 侧稳定读模型和投影视图
4. 受根 `docs/admin/` 与 `docs/05_DevOps_Deployment/` 中后台运维规则约束

## 6. Canonical 文档入口

1. `docs/admin/README.md`
2. `docs/admin/Platform_Admin_Backoffice_Architecture.md`
3. `docs/admin/Admin_RBAC_Design.md`
4. `docs/admin/Admin_Approval_Workflow.md`
5. `docs/admin/Admin_Audit_and_Compliance.md`
6. `docs/admin/Admin_MFA_Enrollment_and_Binding_Flow.md`
7. `docs/admin/Admin_PostgreSQL_Deployment_Design.md`

## 7. 本地运行入口

优先看：

1. [Gateway_Admin_Local_Development.md](./Gateway_Admin_Local_Development.md)
2. [Gateway_Admin_Operations_Runbook.md](./Gateway_Admin_Operations_Runbook.md)
3. `admin/gateway-admin/scripts/ops/`

这几处负责本项目贴身运行说明；平台级部署与事故响应仍看根 `docs/05_DevOps_Deployment/`。