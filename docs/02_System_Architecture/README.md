# System Architecture

本目录定义 Synapse 的系统拓扑、网关执行架构、身份与风控边界，以及领域模型切分方式。

这里不再按旧“后端杂项设计文档”组织，而是按真正的系统问题组织：

1. 系统由哪些核心组件组成
2. Gateway 的执行管线如何工作
3. 身份、鉴权、风险、结算如何分层
4. 为什么领域对象必须按边界拆开，而不是继续用大而全模型

## 真理源

本目录以以下来源为准：

1. `docs/agent/01_Agent_Runtime_Product_Architecture.md`
2. `docs/agent/02_Discovery_Quote_Invoke_API_Design.md`
3. `docs/agent/03_Service_Manifest_Field_Standard.md`
4. `docs/agent/04_Credential_Budget_Risk_Model.md`
5. `docs/04_Database_Design/`

## 阅读顺序

1. `01_System_Topology_and_Request_Routing.md`
2. `02_Gateway_Runtime_Architecture.md`
3. `03_Identity_Authentication_and_Risk_Control.md`
4. `04_Domain_Model_and_Bounded_Contexts.md`

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