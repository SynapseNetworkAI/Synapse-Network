# Synapse Network Documentation Map

> 这套文档已经按 build-for-agent 主线重构。阅读和维护时，不再以旧钱包中心、旧 API Key 中心、旧买卖家二分叙事为主线，而是以 `Owner / Agent / Provider / Platform / Vault` 为主语义。

## 1. 先理解这套文档怎么组织

`docs/` 现在按“canonical 设计 + 业务域专题 + 运维/后台补充”组织。

阅读时遵守三个原则：

1. 先读 `agent/` 和 `api.md`，建立当前产品、协议、身份和资金模型。
2. 再按功能进入产品、前端、架构、数据库、运维、后台各目录。
3. 如果某主题在 `agent/` 已有 canonical 版本，其他目录只能补充实现细节，不能重新定义一套协议。

## 2. Canonical Source of Truth

下面这些文档是 Synapse 当前最优先的事实源。

### 2.1 项目原则与产品基线

1. [agent.md](./agent.md)
	项目原则、Agent First doctrine、工程与资金安全红线。
2. [Design.md](./Design.md)
	前端视觉和交互基线。
3. [agent/00_Platform_Role_Identity_Model.md](./agent/00_Platform_Role_Identity_Model.md)
	`Owner / Agent / Provider / Platform` 身份模型与资金桶边界。
4. [agent/01_Agent_Runtime_Product_Architecture.md](./agent/01_Agent_Runtime_Product_Architecture.md)
	Agent Runtime 主架构和系统边界。

### 2.2 Runtime 协议与平台 API

1. [agent/02_Discovery_Quote_Invoke_API_Design.md](./agent/02_Discovery_Quote_Invoke_API_Design.md)
	Discovery / Quote / Invoke 三段式 Runtime 协议。
2. [agent/03_Service_Manifest_Field_Standard.md](./agent/03_Service_Manifest_Field_Standard.md)
	Service Manifest canonical 字段标准。
3. [agent/04_Credential_Budget_Risk_Model.md](./agent/04_Credential_Budget_Risk_Model.md)
	Agent Credential、Budget Policy、Risk 模型。
4. [api.md](./api.md)
	当前平台 API 合约总表。
5. [Gateway_Error_Codes.md](./Gateway_Error_Codes.md)
	当前对外错误码体系。

### 2.3 数据库与资金真相层

1. [agent/06_Build_For_Agent_Database_Rebuild.md](./agent/06_Build_For_Agent_Database_Rebuild.md)
	为什么数据库必须切到 Agent Runtime 主模型。
2. [Gateway_Database_Design.md](./Gateway_Database_Design.md)
	当前 Gateway 数据库总览与主分层。
3. [03_Smart_Contract_Payment/Agent_Runtime_Data_Model.md](./03_Smart_Contract_Payment/Agent_Runtime_Data_Model.md)
	Runtime 目标数据模型。
4. [03_Smart_Contract_Payment/Owner_Vault_Deposit_End_to_End_Dataflow.md](./03_Smart_Contract_Payment/Owner_Vault_Deposit_End_to_End_Dataflow.md)
	Owner 向 Vault 入金的真实执行链路。
5. [03_Smart_Contract_Payment/Owner_Consumer_Refund_Process.md](./03_Smart_Contract_Payment/Owner_Consumer_Refund_Process.md)
	消费侧退款流程与多资金桶边界。
6. [03_Smart_Contract_Payment/Provider_Withdrawal_Process.md](./03_Smart_Contract_Payment/Provider_Withdrawal_Process.md)
	Provider 收益提现流程。

## 3. 按功能看文档

### 3.1 产品设计

1. [01_Product_Vision/README.md](./01_Product_Vision/README.md)
2. [agent/](./agent/)

关注主题：

1. 产品愿景与商业模式
2. Owner / Agent / Provider 身份边界
3. Agent Runtime 主架构
4. Dashboard IA 与 onboarding

### 3.2 前端设计

1. [Design.md](./Design.md)
2. [05_Frontend_UX/README.md](./05_Frontend_UX/README.md)
3. [feature_designs/README.md](./feature_designs/README.md)

关注主题：

1. Homepage 与品牌呈现
2. Owner / Agent Workspace
3. Provider Console
4. 钱包鉴权、充值、退款、提现体验

### 3.3 架构设计

1. [02_Architecture/README.md](./02_Architecture/README.md)
2. [04_Synapse_Network/README.md](./04_Synapse_Network/README.md)

关注主题：

1. Gateway 代理转发
2. 风控与预算校验
3. 日志、审计、对账、生产安全
4. Provider 注册实现补充

### 3.4 充值、发现、调用、计费、日志、提现

1. [03_Smart_Contract_Payment/README.md](./03_Smart_Contract_Payment/README.md)
2. [agent/02_Discovery_Quote_Invoke_API_Design.md](./agent/02_Discovery_Quote_Invoke_API_Design.md)
3. [agent/04_Credential_Budget_Risk_Model.md](./agent/04_Credential_Budget_Risk_Model.md)

这里覆盖：

1. Owner 向 Vault 充值
2. Agent 服务发现、报价、调用 API
3. Gateway 代理转发与扣费
4. Invocation / Billing / Audit / Logging
5. Provider 注册服务、收益沉淀、提现

### 3.5 运维与开发指南

1. [06_Developer_Guides/README.md](./06_Developer_Guides/README.md)
2. [02_Architecture/Financial_Security_Incident_Runbook.md](./02_Architecture/Financial_Security_Incident_Runbook.md)
3. [02_Architecture/GitHub_Workflows_CICD_and_Production_Operations.md](./02_Architecture/GitHub_Workflows_CICD_and_Production_Operations.md)

### 3.6 管理后台与平台运营

1. [admin/README.md](./admin/README.md)
2. [feature_designs/README.md](./feature_designs/README.md)

## 4. 推荐阅读路径

### 4.1 新同学入门

1. [agent.md](./agent.md)
2. [agent/00_Platform_Role_Identity_Model.md](./agent/00_Platform_Role_Identity_Model.md)
3. [agent/01_Agent_Runtime_Product_Architecture.md](./agent/01_Agent_Runtime_Product_Architecture.md)
4. [api.md](./api.md)
5. [Gateway_Database_Design.md](./Gateway_Database_Design.md)

### 4.2 看 Owner 资金与 Agent Runtime 主链路

1. [03_Smart_Contract_Payment/Owner_Vault_Deposit_End_to_End_Dataflow.md](./03_Smart_Contract_Payment/Owner_Vault_Deposit_End_to_End_Dataflow.md)
2. [agent/02_Discovery_Quote_Invoke_API_Design.md](./agent/02_Discovery_Quote_Invoke_API_Design.md)
3. [03_Smart_Contract_Payment/Settlement_and_Deduction_Logic.md](./03_Smart_Contract_Payment/Settlement_and_Deduction_Logic.md)
4. [03_Smart_Contract_Payment/Owner_Consumer_Refund_Process.md](./03_Smart_Contract_Payment/Owner_Consumer_Refund_Process.md)

### 4.3 看 Provider 注册、转发、收益、提现

1. [agent/03_Service_Manifest_Field_Standard.md](./agent/03_Service_Manifest_Field_Standard.md)
2. [04_Synapse_Network/Service_Manifest_Registration.md](./04_Synapse_Network/Service_Manifest_Registration.md)
3. [02_Architecture/API_Gateway_Reverse_Proxy.md](./02_Architecture/API_Gateway_Reverse_Proxy.md)
4. [03_Smart_Contract_Payment/Provider_Withdrawal_Process.md](./03_Smart_Contract_Payment/Provider_Withdrawal_Process.md)

### 4.4 看数据库和持久化真相

1. [agent/06_Build_For_Agent_Database_Rebuild.md](./agent/06_Build_For_Agent_Database_Rebuild.md)
2. [Gateway_Database_Design.md](./Gateway_Database_Design.md)
3. [03_Smart_Contract_Payment/Agent_Runtime_Data_Model.md](./03_Smart_Contract_Payment/Agent_Runtime_Data_Model.md)
4. [../docker-compose/postgres/init/001_synapse_schema.sql](../docker-compose/postgres/init/001_synapse_schema.sql)
5. [../infra/docker/postgres/init/001_synapse_schema.sql](../infra/docker/postgres/init/001_synapse_schema.sql)

## 5. 目录分层说明

### 根目录文件

只放下面这些全局入口：

1. 项目原则
2. API 合约
3. 数据库总览
4. 错误码
5. 总索引

### 子目录职责

1. `01_Product_Vision/`
	只放商业、愿景、路线图、产品层叙事。
2. `02_Architecture/`
	只放系统架构、网关、日志、安全、生产运维架构。
3. `03_Smart_Contract_Payment/`
	只放充值、扣费、结算、退款、提现、账本、合约和资金链路。
4. `04_Synapse_Network/`
	只放后端实现补充说明，不重新定义 canonical 协议。
5. `05_Frontend_UX/`
	只放前端信息架构、体验设计、页面结构。
6. `06_Developer_Guides/`
	只放本地开发、测试、环境、运维 Runbook、用户操作手册。
7. `feature_designs/`
	只放前端或后台的专题补充设计。
8. `admin/`
	只放管理后台独立体系文档。

## 6. 文档维护规则

1. 任何 Runtime、API、数据库、前端 IA 变更，优先更新 canonical 文档和对应业务域 README。
2. 新文档先决定它属于哪个功能域，不要再直接堆到 `docs/` 根目录。
3. `agent/` 已定义的协议、身份、资金模型，其他目录只能补充，不得重复定义。
4. `docs/plan/` 只放收敛计划、执行计划，不放长期 canonical 设计。
5. 如果旧文档已失效，先修正 README 和子目录入口，再决定归档或删除。

## 7. 迁移说明索引

下面这些入口保留是为了兼容旧搜索路径或历史阅读习惯，但它们已经不再是 canonical 事实源：

1. `04_Synapse_Network/README.md`
	迁移目标：所有 Runtime 协议、Manifest、Credential、Budget 主定义，统一迁移到 `agent/` 与 `api.md`；本目录只保留 Gateway / Provider 控制面的实现补充。
2. `06_Developer_Guides/Buyer_SDK_Quickstart.md`
	迁移目标：统一迁移到 `06_Developer_Guides/Agent_SDK_Quickstart.md`、`api.md`、`agent/02_Discovery_Quote_Invoke_API_Design.md`、`agent/04_Credential_Budget_Risk_Model.md`。
3. `04_Synapse_Network/API_Billing_Deduction_Protocol.md`
	迁移目标：协议与账本主定义迁移到 `agent/02_Discovery_Quote_Invoke_API_Design.md`、`agent/04_Credential_Budget_Risk_Model.md`、`03_Smart_Contract_Payment/Settlement_and_Deduction_Logic.md`。
4. `04_Synapse_Network/Service_Manifest_Registration.md`
	迁移目标：Manifest 主字段标准迁移到 `agent/03_Service_Manifest_Field_Standard.md`，接口契约迁移到 `api.md`。
5. `04_Synapse_Network/Credential_and_RateLimit.md`
	迁移目标：Runtime 凭据和预算主模型迁移到 `agent/04_Credential_Budget_Risk_Model.md` 与 `agent/06_Build_For_Agent_Database_Rebuild.md`。
6. `04_Synapse_Network/平台费率动态计算.md`
	迁移目标：对外字段与结算链路迁移到 `api.md`、`03_Smart_Contract_Payment/Settlement_and_Deduction_Logic.md`、`Gateway_Database_Design.md`。

## 8. 当前维护基准

Synapse 当前已经不是“给人类手工管理 API key 的平台”，而是：

1. Owner 一次性入金与授权
2. Agent Runtime 负责发现、报价、调用、消费预算
3. Provider 负责注册服务、运营收益、申请提现
4. Platform Gateway 负责鉴权、代理转发、记账、日志、审计和清算

这套文档结构也必须围绕这四条主线长期维护。
