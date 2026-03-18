# Synapse Network 文档索引

这个目录已经切到 build-for-agent 主线，阅读顺序和维护方式也要跟着切。

不要再把 `docs/` 当成历史草稿堆栈。现在的目标是：

1. 先找到当前 canonical 文档。
2. 再按业务域查前端、后端、数据库、运维和管理后台资料。
3. 历史方案一律只在 `archive/` 中查，不参与当前设计决策。

## 1. 先读这些 canonical 文档

### 产品与总原则
- [agent.md](./agent.md): 项目原则、工程红线、Agent First 产品准则。
- [01_Product_Vision/Design.md](./01_Product_Vision/Design.md): 视觉与交互基线。
- [agent/00_Platform_Role_Identity_Model.md](./agent/00_Platform_Role_Identity_Model.md): Owner / Agent / Provider / Platform 身份边界。
- [agent/01_Agent_Runtime_Product_Architecture.md](./agent/01_Agent_Runtime_Product_Architecture.md): Agent Runtime 主架构、核心对象、五层边界。

### Agent Runtime 协议
- [agent/02_Discovery_Quote_Invoke_API_Design.md](./agent/02_Discovery_Quote_Invoke_API_Design.md): Discovery / Quote / Invoke 三段式协议。
- [agent/03_Service_Manifest_Field_Standard.md](./agent/03_Service_Manifest_Field_Standard.md): Service Manifest 字段标准。
- [agent/04_Credential_Budget_Risk_Model.md](./agent/04_Credential_Budget_Risk_Model.md): Credential、Budget、Risk 模型。
- [api.md](./api.md): 当前 API 合约总表。

### 数据库与资金真相层
- [agent/06_Build_For_Agent_Database_Rebuild.md](./agent/06_Build_For_Agent_Database_Rebuild.md): 为什么必须从钱包/API Key 模型切到 Agent Runtime 模型。
- [03_Smart_Contract_Payment/Agent_Runtime_Data_Model.md](./03_Smart_Contract_Payment/Agent_Runtime_Data_Model.md): Agent Runtime 目标数据模型。
- [03_Smart_Contract_Payment/Owner_Vault_Deposit_End_to_End_Dataflow.md](./03_Smart_Contract_Payment/Owner_Vault_Deposit_End_to_End_Dataflow.md): 当前 Owner 向 Vault 入金的真实执行链路。
- [03_Smart_Contract_Payment/Owner_Consumer_Refund_Process.md](./03_Smart_Contract_Payment/Owner_Consumer_Refund_Process.md): 当前 Owner 消费侧退款链路与多资金桶边界。
- [Gateway_Database_Design.md](./Gateway_Database_Design.md): 当前 build-for-agent 数据库总览摘要。

## 2. 按功能分类阅读

### 业务核心
- `01_Product_Vision/`: 商业模型、路线图、MVP、愿景文档。
- `agent/`: build-for-agent 的产品、协议、Runtime、Dashboard IA 核心设计。

### 后端文档
- `02_Architecture/`: 网关、支付、风控、日志、部署、生产安全架构。
- `04_Synapse_Network/`: 仅保留后端实现补充说明和历史兼容备注，不能覆盖 `agent/` 与 `api.md` 的 canonical 设计。
- [Gateway_Error_Codes.md](./Gateway_Error_Codes.md): 当前对外 Runtime 错误码文档，语义已切到 agent-first Runtime。

### 数据库文档
- `03_Smart_Contract_Payment/`: 合约、账本、充值、提现、结算、数据模型。
- [Gateway_Database_Design.md](./Gateway_Database_Design.md): 面向当前 schema 的摘要入口。

### 前端文档
- `05_Frontend_UX/`: 前端 IA、充值退款体验、Dashboard、页面架构。
- `feature_designs/frontend_product/`: 更细的前端专题设计，如认证、Provider Console、Homepage。

### 运维与开发指南
- `06_Developer_Guides/`: 本地开发、测试、环境变量、索引器 Runbook、控制台使用说明。
- [06_Developer_Guides/README.md](./06_Developer_Guides/README.md): 开发与运维入口索引。
- 新的推荐阅读顺序：
	1. [06_Developer_Guides/Backend_Python_Dev_Guide.md](./06_Developer_Guides/Backend_Python_Dev_Guide.md)
	2. [06_Developer_Guides/Gateway_Environment_Configuration.md](./06_Developer_Guides/Gateway_Environment_Configuration.md)
	3. [06_Developer_Guides/Backend_Unit_Testing_Guide.md](./06_Developer_Guides/Backend_Unit_Testing_Guide.md)
	4. [06_Developer_Guides/Agent_SDK_Quickstart.md](./06_Developer_Guides/Agent_SDK_Quickstart.md)
	5. [06_Developer_Guides/V2_Deposit_Indexer_Runbook.md](./06_Developer_Guides/V2_Deposit_Indexer_Runbook.md)
	6. [06_Developer_Guides/Website_User_Guide.md](./06_Developer_Guides/Website_User_Guide.md)
- `02_Architecture/` 中以下文档也属于运维主线：
	- `GitHub_Workflows_CICD_and_Production_Operations.md`
	- `Financial_Security_Incident_Runbook.md`
	- `Phase5_Liquidity_Alert_SOP_Implementation.md`
	- `Production_Upgrade_TODO.md`
	- `Production_Upgrade_Issue_Seeds.md`

### 管理后台文档
- `admin/`: 管理后台架构、数据库、RBAC、审计、审批、部署。
- `feature_designs/backend_admin/`: 后台专题补充设计。

## 3. 已归档的历史文档

以下历史文档已经从主阅读面移走，不再作为当前设计依据：

- `archive/pre_agent/`: 钱包中心、买家中心、旧发现模型等历史文档。
- `archive/historical_schema/`: V2 过渡期数据库方案。
- `archive/historical_architecture/`: 已被 Agent Runtime 主架构替代的旧总览文档。

归档文档可以保留历史上下文，但不能覆盖当前 canonical 设计。

## 4. 文档维护规则

1. 涉及 Runtime、数据库、API、前端 IA 的新增设计，优先补到对应业务域，不要再把新文档堆到根目录。
2. 如新设计已经覆盖旧文档，先更新 README 中的 canonical 指向，再将旧文档移入 `archive/`。
3. 对外行为变化必须同步更新 `api.md`、相关专题文档和对应测试说明。
4. 如果一个主题在 `agent/` 已有 canonical 版本，其他目录的文档只能做补充实现说明，不能重新定义同一套协议。
5. `docs/plan/` 只放执行计划、重构计划、收敛计划，不放长期 canonical 设计。

## 5. 当前这轮收敛结果

本轮已经把以下明显过时主题移入归档：

- 钱包中心旧拓扑与旧 SDK 角色化文档
- 旧的 AI Service Discovery 草案
- V2 过渡期数据库方案
- 已被 Agent Runtime 架构替代的旧总览架构文档

当前 `docs/` 的主阅读顺序应该是：

1. `agent.md`
2. `agent/00_Platform_Role_Identity_Model.md`
3. `agent/01` → `agent/02` → `agent/04` → `agent/06`
4. `api.md`
5. `03_Smart_Contract_Payment/Agent_Runtime_Data_Model.md`
6. `02_Architecture/README.md`
7. `06_Developer_Guides/README.md`
8. 对应业务域的前端、后端、运维补充文档

> Synapse 当前不是“给人手工逛 API 的平台”，而是面向 Agent Runtime 的发现、报价、调用、记账和清算基础设施。文档结构也必须服务这个目标。
