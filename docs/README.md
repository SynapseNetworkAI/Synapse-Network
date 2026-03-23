## 1. 先理解这套文档怎么组织

阅读和维护遵守三条规则：

1. 先读 `agent/`、`api.md`、`Gateway_Database_Design.md`，建立当前身份、协议和资金模型。
2. 再进入六个官方模块，按产品、架构、流程、数据库、运维、参考分层阅读。
3. 专题设计、后台文档、产品愿景保留为补充层，不再承担 Runtime canonical 定义职责。

### 1.1 docs/ 文件地图（Agent File Map）

下面这份目录树按当前仓库实际文件生成，供 Agent 快速定位文档，不需要再手工猜目录。

```text
docs/
├── 03_Projects/
│   ├── README.md
│   ├── gateway/
│   │   └── README.md
│   ├── contracts/
│   │   └── README.md
│   ├── frontend/
│   │   └── README.md
│   ├── gateway-admin/
│   │   └── README.md
│   ├── admin-front/
│   │   └── README.md
│   ├── provider-service/
│   │   └── README.md
│   ├── sdk-python/
│   │   └── README.md
│   └── infra/
│       └── README.md
├── 01_Product_Frontend/
│   ├── 01_Product_Positioning_and_Role_Model.md
│   ├── 02_Gateway_Console_Information_Architecture.md
│   ├── 03_Admin_Control_Plane_Architecture.md
│   ├── 04_Frontend_Design_System_Application.md
│   ├── README.md
│   ├── AGENTS.md
│   └── owner_agent_guide/
│       └── agents_guide.md
├── 01_Product_Vision/
│   ├── Business_Plan.md
│   ├── Future_Plans.md
│   ├── MVP.md
│   ├── Monetization_Model.md
│   ├── Pitch_Deck_Material.md
│   ├── Product_Thinking.md
│   ├── README.md
│   ├── ROADMAP.md
│   └── slogan.md
├── 02_System_Architecture/
│   ├── 01_System_Topology_and_Request_Routing.md
│   ├── 02_Gateway_Runtime_Architecture.md
│   ├── 03_Identity_Authentication_and_Risk_Control.md
│   ├── 04_Domain_Model_and_Bounded_Contexts.md
│   └── README.md
├── 03_Core_Workflows/
│   ├── 01_Deposit_and_Idempotency.md
│   ├── 02_Discovery_and_Gateway_Call.md
│   ├── 03_Billing_Settlement_and_Audit.md
│   ├── 04_Provider_Registration_and_Agreement.md
│   ├── 05_Withdrawal_and_Risk_Gates.md
│   ├── 06_Deposit_Entry_Architecture_Comparison.md
│   └── README.md
├── 04_Database_Design/
│   ├── 01_SQL_Schema_Overview.md
│   ├── 02_Core_Tables_and_Relationships.md
│   ├── 03_Balance_Ledger_and_Reservation_Model.md
│   ├── 04_Concurrency_Idempotency_and_Consistency.md
│   └── README.md
├── 05_DevOps_Deployment/
│   ├── 01_Local_Environment_and_Runtime_Setup.md
│   ├── 02_CI_CD_and_Release_Gates.md
│   ├── 03_Observability_Logging_and_Indexer_Operations.md
│   ├── 04_Financial_Incident_Response_and_Production_Operations.md
│   └── README.md
├── 06_Reference/
│   ├── 01_API_Contract_Index.md
│   ├── 02_Error_Code_and_Runtime_Response_Contract.md
│   ├── 03_Service_Manifest_and_Runtime_Object_Reference.md
│   ├── 04_Development_Testing_and_Integration_Reference.md
│   └── README.md
├── admin/
│   ├── Admin_API_Contract_Phase1.md
│   ├── Admin_Approval_Workflow.md
│   ├── Admin_Audit_and_Compliance.md
│   ├── Admin_Database_Design.md
│   ├── Admin_Finance_Operations_Runbook.md
│   ├── Admin_PostgreSQL_Deployment_Design.md
│   ├── Admin_RBAC_Design.md
│   ├── Platform_Admin_Backoffice_Architecture.md
│   └── README.md
├── agent/
│   ├── 00_Platform_Role_Identity_Model.md
│   ├── 01_Agent_Runtime_Product_Architecture.md
│   ├── 02_Discovery_Quote_Invoke_API_Design.md
│   ├── 03_Service_Manifest_Field_Standard.md
│   ├── 04_Credential_Budget_Risk_Model.md
│   ├── 05_Dashboard_IA_and_Onboarding.md
│   ├── 06_Build_For_Agent_Database_Rebuild.md
│   ├── 07_Agent_SDK_Integration_Guide.md
│   └── agent_design.md
├── feature_designs/
│   ├── README.md
│   ├── backend_admin/
│   │   └── Deposit_Reconciliation_Backoffice_Requirements.md
│   ├── frontend_product/
│   │   ├── Homepage_V2_Functional_Design.md
│   │   ├── Provider_Console_IA_V3.md
│   │   ├── Security-Key-Management.md
│   │   └── Wallet_Auth_Challenge_Session_Design.md
│   ├── 战略.md
│   └── 路演准备.md
├── sdk/
│   └── README.md
├── plan/
│   ├── 2026-03-17_Docs_Information_Architecture_Consolidation_Plan.md
│   ├── 2026-03-23_Project_Docs_Centralization_Migration_Plan.md
│   └── sql/
│       └── 2026-03-17_owner_provider_target_state_schema_cutover.sql
├── 竞品调研/
│   └── EigenFlux.md
├── 平台资金监控方案.md
├── 测试文档.md
├── AGENTS.md
├── api.md
├── Design.md
├── Gateway_Database_Design.md
├── Gateway_Error_Codes.md
├── README.md
├── soul.png
└── 充值退款审批流程.md
```

建议 Agent 读取顺序：

1. 先读 `AGENTS.md`、`Design.md`、`agent/` 下 canonical 文档。
2. 需要产品与 IA 时进入 `01_Product_Frontend/`。
3. 需要 Runtime 协议与主流程时进入 `02_System_Architecture/`、`03_Core_Workflows/`、`06_Reference/`。
4. 需要数据库真相时进入 `04_Database_Design/` 与 `Gateway_Database_Design.md`。
5. 需要先按代码项目定位职责边界时，先读 `03_Projects/`。
6. 需要补充专题和历史方案时再读 `feature_designs/`、`admin/`、`plan/`。

## 2. Canonical Source of Truth

### 2.1 项目原则与设计基线

1. [AGENTS.md](./AGENTS.md)
2. [Design.md](./Design.md)
3. [agent/00_Platform_Role_Identity_Model.md](./agent/00_Platform_Role_Identity_Model.md)
4. [agent/01_Agent_Runtime_Product_Architecture.md](./agent/01_Agent_Runtime_Product_Architecture.md)

### 2.2 Runtime 协议与平台 API

1. [agent/02_Discovery_Quote_Invoke_API_Design.md](./agent/02_Discovery_Quote_Invoke_API_Design.md)
2. [agent/03_Service_Manifest_Field_Standard.md](./agent/03_Service_Manifest_Field_Standard.md)
3. [agent/04_Credential_Budget_Risk_Model.md](./agent/04_Credential_Budget_Risk_Model.md)
4. [agent/07_Agent_SDK_Integration_Guide.md](./agent/07_Agent_SDK_Integration_Guide.md)
5. [api.md](./api.md)
6. [Gateway_Error_Codes.md](./Gateway_Error_Codes.md)

### 2.3 数据库与资金真相层

1. [agent/06_Build_For_Agent_Database_Rebuild.md](./agent/06_Build_For_Agent_Database_Rebuild.md)
2. [Gateway_Database_Design.md](./Gateway_Database_Design.md)
3. [04_Database_Design/README.md](./04_Database_Design/README.md)
4. [../docker-compose/postgres/init/gateway/001_synapse_schema.sql](../docker-compose/postgres/init/gateway/001_synapse_schema.sql)

## 3. 官方六模块

1. [01_Product_Frontend/README.md](./01_Product_Frontend/README.md)
   产品定位、Gateway Console IA、Admin Control Plane、前端设计系统落地。
2. [02_System_Architecture/README.md](./02_System_Architecture/README.md)
   系统拓扑、Gateway Runtime、身份与风控、bounded contexts。
3. [03_Core_Workflows/README.md](./03_Core_Workflows/README.md)
   入金、发现调用、结算审计、Provider 注册、提现风控主流程。
4. [04_Database_Design/README.md](./04_Database_Design/README.md)
   SQL 概览、核心表关系、账本模型、一致性与幂等。
5. [05_DevOps_Deployment/README.md](./05_DevOps_Deployment/README.md)
   本地环境、CI/CD、观测、索引器运行、金融事故响应。
6. [06_Reference/README.md](./06_Reference/README.md)
   API 索引、错误码契约、Manifest 与 Runtime 对象、开发测试参考。
7. [测试文档.md](./测试文档.md)
   本地测试、清库 SQL、链路重置与执行前后校验说明。
8. [平台资金监控方案.md](./平台资金监控方案.md)
   解释 reconciliation 指标，并定义充值、计费、收入、退款、提现、Vault 总账的监控漏斗方案。

## 3.1 项目文档集中维护层

在六个官方知识模块之外，`03_Projects/` 现在已经不是纯导航层，而是按代码项目组织的集中维护层：

1. [03_Projects/README.md](./03_Projects/README.md)
2. [03_Projects/gateway/README.md](./03_Projects/gateway/README.md)
3. [03_Projects/contracts/README.md](./03_Projects/contracts/README.md)
4. [03_Projects/frontend/README.md](./03_Projects/frontend/README.md)
5. [03_Projects/gateway-admin/README.md](./03_Projects/gateway-admin/README.md)
6. [03_Projects/admin-front/README.md](./03_Projects/admin-front/README.md)
7. [03_Projects/provider-service/README.md](./03_Projects/provider-service/README.md)
8. [03_Projects/sdk-python/README.md](./03_Projects/sdk-python/README.md)
9. [03_Projects/infra/README.md](./03_Projects/infra/README.md)

这层目录现在承担两类职责：

1. 帮助人先判断“我要改哪个项目、该先回到根 docs 的哪个模块”。
2. 集中维护各项目的本地开发说明、运维手册和 project-level agent rules canonical 文本。

## 4. 补充模块

这些目录继续保留，但只承担补充职责：

1. [01_Product_Vision/README.md](./01_Product_Vision/README.md)
   商业定位、路线图、品牌叙事。
2. [03_Projects/README.md](./03_Projects/README.md)
   按代码项目聚合职责、代码位置、本地说明、project rules 与 canonical 文档入口。
3. [admin/README.md](./admin/README.md)
   管理后台代码工作区入口壳，系统级后台文档以 `docs/admin/` 为准。
4. [feature_designs/README.md](./feature_designs/README.md)
   前端和后台专题深化设计。
5. [plan/](./plan/)
   收敛计划和历史执行记录。
6. [plan/2026-03-23_Project_Docs_Centralization_Migration_Plan.md](./plan/2026-03-23_Project_Docs_Centralization_Migration_Plan.md)
   项目目录文档统一迁入根 `docs/` 的专项迁移与合并方案。
7. [竞品调研/](./竞品调研/)
   市场和竞品研究材料。
8. [sdk/README.md](./sdk/README.md)
   Python SDK 的测试、联调、发布前检查与常见故障排查。

## 5. 推荐阅读路径

### 5.1 新同学入门

1. [AGENTS.md](./AGENTS.md)
2. [agent/00_Platform_Role_Identity_Model.md](./agent/00_Platform_Role_Identity_Model.md)
3. [agent/01_Agent_Runtime_Product_Architecture.md](./agent/01_Agent_Runtime_Product_Architecture.md)
4. [03_Core_Workflows/README.md](./03_Core_Workflows/README.md)
5. [04_Database_Design/README.md](./04_Database_Design/README.md)
6. [03_Projects/README.md](./03_Projects/README.md)

### 5.2 看 Owner 资金与 Agent Runtime 主链路

1. [03_Core_Workflows/01_Deposit_and_Idempotency.md](./03_Core_Workflows/01_Deposit_and_Idempotency.md)
2. [03_Core_Workflows/06_Deposit_Entry_Architecture_Comparison.md](./03_Core_Workflows/06_Deposit_Entry_Architecture_Comparison.md)
3. [agent/02_Discovery_Quote_Invoke_API_Design.md](./agent/02_Discovery_Quote_Invoke_API_Design.md)
4. [03_Core_Workflows/03_Billing_Settlement_and_Audit.md](./03_Core_Workflows/03_Billing_Settlement_and_Audit.md)
5. [03_Core_Workflows/05_Withdrawal_and_Risk_Gates.md](./03_Core_Workflows/05_Withdrawal_and_Risk_Gates.md)
6. [agent/07_Agent_SDK_Integration_Guide.md](./agent/07_Agent_SDK_Integration_Guide.md)
7. [03_Projects/gateway/README.md](./03_Projects/gateway/README.md)

### 5.3 看 Provider 注册、转发、收益、提现

1. [agent/03_Service_Manifest_Field_Standard.md](./agent/03_Service_Manifest_Field_Standard.md)
2. [03_Core_Workflows/04_Provider_Registration_and_Agreement.md](./03_Core_Workflows/04_Provider_Registration_and_Agreement.md)
3. [02_System_Architecture/01_System_Topology_and_Request_Routing.md](./02_System_Architecture/01_System_Topology_and_Request_Routing.md)
4. [03_Core_Workflows/05_Withdrawal_and_Risk_Gates.md](./03_Core_Workflows/05_Withdrawal_and_Risk_Gates.md)
5. [03_Projects/provider-service/README.md](./03_Projects/provider-service/README.md)

### 5.4 看数据库和持久化真相

1. [agent/06_Build_For_Agent_Database_Rebuild.md](./agent/06_Build_For_Agent_Database_Rebuild.md)
2. [Gateway_Database_Design.md](./Gateway_Database_Design.md)
3. [04_Database_Design/02_Core_Tables_and_Relationships.md](./04_Database_Design/02_Core_Tables_and_Relationships.md)
4. [../docker-compose/postgres/init/gateway/001_synapse_schema.sql](../docker-compose/postgres/init/gateway/001_synapse_schema.sql)
5. [03_Projects/infra/README.md](./03_Projects/infra/README.md)

## 6. 目录职责

### 根目录文件

只保留这些全局入口：

1. 项目原则
2. API 合约
3. 数据库总览
4. 错误码
5. 总索引

### 子目录职责

1. `01_Product_Frontend/`
   官方产品与前端模块。
2. `02_System_Architecture/`
   官方系统架构模块。
3. `03_Core_Workflows/`
   官方业务主流程模块。
4. `04_Database_Design/`
   官方数据库与一致性模块。
5. `05_DevOps_Deployment/`
   官方运维与部署模块。
6. `06_Reference/`
   官方协议和开发参考模块。
7. `03_Projects/`
   代码项目集中维护层，负责职责、边界、代码位置、本地开发说明与 project-level rules 聚合。
8. `agent/`
   Runtime canonical 设计源。
9. `admin/`、`feature_designs/`、`01_Product_Vision/`
   补充材料。

## 7. 目录退役说明

以下旧技术目录已在 Phase 5 正式退役并移出主阅读路径：

1. `02_Architecture/`
2. `03_Smart_Contract_Payment/`
3. `04_Synapse_Network/`
4. `05_Frontend_UX/`
5. `06_Developer_Guides/`

它们承载的当前有效内容已被收敛进六个新官方模块、`agent/`、`api.md` 和根级真理源。

## 8. 维护规则

1. 任何 Runtime、API、数据库、前端 IA 变更，优先更新 canonical 文档和对应官方模块 README。
2. 新文档先决定归属模块，不再向根目录和已退役技术目录散落文件。
3. `agent/` 已定义的协议、身份、资金模型，其他目录只能解释实现和应用，不能并列重定义。
4. `plan/` 只保留计划与历史记录，不再作为当前协议入口；当前执行状态以最新专项计划为准。

## 9. 当前维护基准

Synapse 的当前文档体系围绕四条主线长期维护：

1. Owner 一次性入金与授权
2. Agent Runtime 自动发现、报价、调用、消费预算
3. Provider 注册服务、积累收益、申请提现
4. Platform Gateway 负责鉴权、路由、记账、审计和清算
