# System Architecture

- Status: canonical
- Code paths: `gateway/`, `apps/frontend/`, `admin/gateway-admin/`, `provider_service/`, `sdk/python/`
- Verified with: `npm run ci:pr`, `npm run ci:docs`
- DB sources: `docker-compose/postgres/init/gateway/001_synapse_schema.sql`
- Supersedes: former `docs/agent/00_Platform_Role_Identity_Model.md` and former `docs/agent/01_Agent_Runtime_Product_Architecture.md` as standalone architecture truth sources
- Last verified against code: 2026-03-24

本目录定义 Synapse 的系统拓扑、网关执行架构、身份与风控边界，以及领域模型切分方式。

当前角色/身份模型与 runtime 总体架构的 canonical 内容已经收口到本目录。former `docs/agent/00_Platform_Role_Identity_Model.md` 与 former `docs/agent/01_Agent_Runtime_Product_Architecture.md` 已完成退役，不再作为独立架构真理源。

这里不再按旧“后端杂项设计文档”组织，而是按真正的系统问题组织：

1. 系统由哪些核心组件组成
2. Gateway 的执行管线如何工作
3. 身份、鉴权、风险、结算如何分层
4. 为什么领域对象必须按边界拆开，而不是继续用大而全模型

## 真理源

本目录以以下来源为准：

1. `docs/02_System_Architecture/`
2. `docs/03_Core_Workflows/02_Discovery_and_Gateway_Call.md`
3. `docs/06_Reference/03_Service_Manifest_and_Runtime_Object_Reference.md`
4. `docs/02_System_Architecture/03_Identity_Authentication_and_Risk_Control.md`
5. `docs/04_Database_Design/`

补充参考：

1. former `docs/agent/` 文档拆分情况见 `docs/00_Governance/Agent_Docs_Migration_Map.md`。

## 阅读顺序

1. `01_System_Topology_and_Request_Routing.md`
2. `02_Gateway_Runtime_Architecture.md`
3. `03_Identity_Authentication_and_Risk_Control.md`
4. `04_Domain_Model_and_Bounded_Contexts.md`
5. `Finance_Approval_Safety_Invariants.md`
6. `Agent_Code_Quality_Guardrails.md`

## 模块边界

本目录不承担：

1. 前端 IA：看 `docs/01_Product_Frontend/`
2. 业务链路细节：看 `docs/03_Core_Workflows/`
3. SQL 表结构说明：看 `docs/04_Database_Design/`
4. 运维部署：后续放 `docs/05_DevOps_Deployment/`

## 核心结论

Synapse 的系统架构本质上是一条不可分割的执行管线：

**Identity -> Risk -> Quote -> Gateway Routing -> Settlement -> Audit**

任何把这条管线拆成松散脚本、页面逻辑或临时表拼接的实现，最终都会在资金和审计层面崩掉。
