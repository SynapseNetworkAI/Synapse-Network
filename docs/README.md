# Documentation Map

- Status: canonical
- Code paths: `docs/`, `llms.txt`, `tools/scripts/validate_docs.js`
- Verified with: `npm run ci:docs`
- Last verified against code: 2026-03-25

## 1. 先理解这套文档怎么组织

阅读和维护遵守三条规则：

1. 先读 `AGENTS.md`、`ARCHITECTURE.md`、`06_Reference/AI_Quick_Reference.md` 与官方模块 README，建立当前系统全貌。
2. 再按产品、架构、流程、数据库、运维、参考六个官方模块深入阅读。
3. 专题设计、后台文档、产品愿景保留为补充层；原 `docs/agent/` 目录已经退役，相关历史迁移关系统一回看治理层记录。

AI 协作优先入口新增如下：

1. 仓库根 `llms.txt` 作为机器可消费的最短入口。
2. `ARCHITECTURE.md` 作为全仓顶层结构地图。
3. `Harness_engineering.md` 作为 AI 文档治理与落地顺序说明。
4. `exec-plans/` 作为多步骤任务的标准执行计划目录。
5. `00_Governance/Documentation_Constraints.md` 作为 `docs/` 目录硬边界说明。
6. `06_Reference/Validation_Entry_Points.md` 作为当前校验入口地图。

### 1.1 docs/ 文件地图（Agent File Map）

这里不再展开完整目录树，而是保留稳定入口分组。完整机器入口优先看根 `llms.txt`；这里负责给人类和 Agent 一个更快的首屏地图。

### Root entrypoints

1. [AGENTS.md](./AGENTS.md)
2. [ARCHITECTURE.md](./ARCHITECTURE.md)
3. [Harness_engineering.md](./Harness_engineering.md)
4. [00_Governance/README.md](./00_Governance/README.md)
5. [00_Governance/Documentation_Constraints.md](./00_Governance/Documentation_Constraints.md)
6. [00_Governance/Documentation_Inventory.md](./00_Governance/Documentation_Inventory.md)
7. [06_Reference/Validation_Entry_Points.md](./06_Reference/Validation_Entry_Points.md)
8. [Design.md](./Design.md)
9. [文档迁移.md](./%E6%96%87%E6%A1%A3%E8%BF%81%E7%A7%BB.md)

说明：root `docs/` 当前只保留全局入口、治理文件和少量 supplementary 过渡文档，不再作为数据库、测试、监控或审批流程的长期 canonical 落点。

### Official modules

1. [00_Governance/README.md](./00_Governance/README.md)
2. [01_Product_Frontend/README.md](./01_Product_Frontend/README.md)
3. [02_System_Architecture/README.md](./02_System_Architecture/README.md)
4. [03_Core_Workflows/README.md](./03_Core_Workflows/README.md)
5. [03_Projects/README.md](./03_Projects/README.md)
6. [04_Database_Design/README.md](./04_Database_Design/README.md)
7. [05_DevOps_Deployment/README.md](./05_DevOps_Deployment/README.md)
8. [06_Reference/README.md](./06_Reference/README.md)

### Runtime canonical docs

说明：原 `docs/agent/` 迁移层已经完成退役，相关 Runtime canonical 内容已全部回收到官方模块。

历史迁移记录：

1. [00_Governance/Agent_Docs_Migration_Map.md](./00_Governance/Agent_Docs_Migration_Map.md)
2. [exec-plans/completed/2026-03-24_Documentation_Migration_Execution_Plan.md](./exec-plans/completed/2026-03-24_Documentation_Migration_Execution_Plan.md)

### Project entrypoints

1. [03_Projects/README.md](./03_Projects/README.md)
2. [03_Projects/gateway/README.md](./03_Projects/gateway/README.md)
3. [03_Projects/contracts/README.md](./03_Projects/contracts/README.md)
4. [03_Projects/frontend/README.md](./03_Projects/frontend/README.md)
5. [03_Projects/gateway-admin/README.md](./03_Projects/gateway-admin/README.md)
6. [03_Projects/admin-front/README.md](./03_Projects/admin-front/README.md)
7. [03_Projects/provider-service/README.md](./03_Projects/provider-service/README.md)
8. [03_Projects/sdk-python/README.md](./03_Projects/sdk-python/README.md)
9. [03_Projects/infra/README.md](./03_Projects/infra/README.md)

### Production release gates

1. [ops/10_Production_Go_No_Go_Security_Verification.md](./ops/10_Production_Go_No_Go_Security_Verification.md)
2. [ops/11_Performance_and_Reliability_Verification.md](./ops/11_Performance_and_Reliability_Verification.md)
3. [ops/12_Gateway_Pre_Launch_Stress_Review.md](./ops/12_Gateway_Pre_Launch_Stress_Review.md)
4. [ops/13_Production_Monitoring_Alerting_and_Backup_Restore.md](./ops/13_Production_Monitoring_Alerting_and_Backup_Restore.md)
4. [plans/production-go-live-security-verification/README.md](./plans/production-go-live-security-verification/README.md)
5. [security/README.md](./security/README.md)
6. [security/SynapseCore_Internal_Production_Security_Audit_Report.md](./security/SynapseCore_Internal_Production_Security_Audit_Report.md)
7. [security/SynapseCore_Internal_Audit_Closure_Log.md](./security/SynapseCore_Internal_Audit_Closure_Log.md)
8. [security/SynapseCore_Internal_Audit_Risk_Acceptance.md](./security/SynapseCore_Internal_Audit_Risk_Acceptance.md)
9. [security/SynapseCore_Production_Audit_Verification_Report.md](./security/SynapseCore_Production_Audit_Verification_Report.md)

### Supplement layers

1. [01_Product_Vision/README.md](./01_Product_Vision/README.md)
2. [admin/README.md](./admin/README.md)
3. [feature_designs/README.md](./feature_designs/README.md)
4. [exec-plans/README.md](./exec-plans/README.md)
5. [sdk/README.md](./sdk/README.md)

### Archive and on-demand layers

1. [plan/README.md](./plan/README.md)
2. [文档迁移.md](./%E6%96%87%E6%A1%A3%E8%BF%81%E7%A7%BB.md)

建议 Agent 读取顺序：

1. 先读 [AGENTS.md](./AGENTS.md)、[ARCHITECTURE.md](./ARCHITECTURE.md)、[00_Governance/README.md](./00_Governance/README.md)、[06_Reference/AI_Quick_Reference.md](./06_Reference/AI_Quick_Reference.md)。
2. 若任务涉及文档结构、入口或治理，先读 [00_Governance/Documentation_Constraints.md](./00_Governance/Documentation_Constraints.md)、[00_Governance/Documentation_Inventory.md](./00_Governance/Documentation_Inventory.md) 与 [06_Reference/Validation_Entry_Points.md](./06_Reference/Validation_Entry_Points.md)。
3. 需要 Runtime 协议时直接看官方模块；若需要追溯旧迁移关系，再进入 [00_Governance/Agent_Docs_Migration_Map.md](./00_Governance/Agent_Docs_Migration_Map.md)。
4. 需要业务主流程时进入 [03_Core_Workflows/README.md](./03_Core_Workflows/README.md)。
5. 需要数据库真相时进入 [04_Database_Design/README.md](./04_Database_Design/README.md) 与 [04_Database_Design/01_SQL_Schema_Overview.md](./04_Database_Design/01_SQL_Schema_Overview.md)。
6. 需要按代码项目定位时进入 [03_Projects/README.md](./03_Projects/README.md)。
7. 需要补充专题或活跃执行计划时再进入 supplement layers；只有在追溯历史迁移、旧计划或归档背景时才进入 archive and on-demand layers。

## 2. Canonical Source of Truth

### 2.1 项目原则与设计基线

1. [AGENTS.md](./AGENTS.md)
2. [ARCHITECTURE.md](./ARCHITECTURE.md)
3. [Harness_engineering.md](./Harness_engineering.md)
4. [exec-plans/README.md](./exec-plans/README.md)
5. [06_Reference/AI_Quick_Reference.md](./06_Reference/AI_Quick_Reference.md)
6. [06_Reference/Validation_Entry_Points.md](./06_Reference/Validation_Entry_Points.md)
7. [00_Governance/Documentation_Constraints.md](./00_Governance/Documentation_Constraints.md)
8. [00_Governance/Documentation_Inventory.md](./00_Governance/Documentation_Inventory.md)
9. [Design.md](./Design.md)
10. [02_System_Architecture/README.md](./02_System_Architecture/README.md)
11. [01_Product_Frontend/README.md](./01_Product_Frontend/README.md)

### 2.2 Runtime 协议与平台 API

1. [03_Core_Workflows/02_Discovery_and_Gateway_Call.md](./03_Core_Workflows/02_Discovery_and_Gateway_Call.md)
2. [06_Reference/03_Service_Manifest_and_Runtime_Object_Reference.md](./06_Reference/03_Service_Manifest_and_Runtime_Object_Reference.md)
3. [02_System_Architecture/03_Identity_Authentication_and_Risk_Control.md](./02_System_Architecture/03_Identity_Authentication_and_Risk_Control.md)
4. [06_Reference/04_Development_Testing_and_Integration_Reference.md](./06_Reference/04_Development_Testing_and_Integration_Reference.md)
5. [06_Reference/05_Runtime_API_Contract.md](./06_Reference/05_Runtime_API_Contract.md)
6. [06_Reference/06_Runtime_Error_Code_Catalog.md](./06_Reference/06_Runtime_Error_Code_Catalog.md)

### 2.3 数据库与资金真相层

1. [04_Database_Design/README.md](./04_Database_Design/README.md)
2. [04_Database_Design/01_SQL_Schema_Overview.md](./04_Database_Design/01_SQL_Schema_Overview.md)
3. [../docker-compose/postgres/init/gateway/001_synapse_schema.sql](../docker-compose/postgres/init/gateway/001_synapse_schema.sql)

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
7. [reference/Money_Contract.md](./reference/Money_Contract.md)
   API 索引、错误码契约、Manifest 与 Runtime 对象、开发测试参考。

生产上线前必须同时阅读 [ops/10_Production_Go_No_Go_Security_Verification.md](./ops/10_Production_Go_No_Go_Security_Verification.md)、[ops/11_Performance_and_Reliability_Verification.md](./ops/11_Performance_and_Reliability_Verification.md)、[ops/12_Gateway_Pre_Launch_Stress_Review.md](./ops/12_Gateway_Pre_Launch_Stress_Review.md)、[ops/13_Production_Monitoring_Alerting_and_Backup_Restore.md](./ops/13_Production_Monitoring_Alerting_and_Backup_Restore.md)、[plans/production-go-live-security-verification/README.md](./plans/production-go-live-security-verification/README.md) 与 [security/README.md](./security/README.md)。所有 P0 门禁和证据包通过前，禁止上线。

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
5. [plan/README.md](./plan/README.md)
   旧 `docs/plan/` 目录的 legacy archive 入口，仅保留未标准化的历史计划材料与增长/路演草稿，不再承担执行计划职责。
6. [竞品调研/](./竞品调研/)
   市场和竞品研究材料。
7. [sdk/README.md](./sdk/README.md)
   Python SDK 的测试、联调、发布前检查与常见故障排查。

## 5. 推荐阅读路径

### 5.1 新同学入门

1. [AGENTS.md](./AGENTS.md)
2. [ARCHITECTURE.md](./ARCHITECTURE.md)
3. [06_Reference/AI_Quick_Reference.md](./06_Reference/AI_Quick_Reference.md)
4. [02_System_Architecture/README.md](./02_System_Architecture/README.md)
5. [03_Core_Workflows/README.md](./03_Core_Workflows/README.md)
6. [04_Database_Design/README.md](./04_Database_Design/README.md)
7. [06_Reference/README.md](./06_Reference/README.md)
8. [03_Projects/README.md](./03_Projects/README.md)

### 5.2 看 Owner 资金与 Agent Runtime 主链路

1. [03_Core_Workflows/01_Deposit_and_Idempotency.md](./03_Core_Workflows/01_Deposit_and_Idempotency.md)
2. [03_Core_Workflows/06_Deposit_Entry_Architecture_Comparison.md](./03_Core_Workflows/06_Deposit_Entry_Architecture_Comparison.md)
3. [03_Core_Workflows/02_Discovery_and_Gateway_Call.md](./03_Core_Workflows/02_Discovery_and_Gateway_Call.md)
4. [03_Core_Workflows/03_Billing_Settlement_and_Audit.md](./03_Core_Workflows/03_Billing_Settlement_and_Audit.md)
5. [03_Core_Workflows/05_Withdrawal_and_Risk_Gates.md](./03_Core_Workflows/05_Withdrawal_and_Risk_Gates.md)
6. [06_Reference/04_Development_Testing_and_Integration_Reference.md](./06_Reference/04_Development_Testing_and_Integration_Reference.md)
7. [03_Projects/gateway/README.md](./03_Projects/gateway/README.md)

### 5.3 看 Provider 注册、转发、收益、提现

1. [06_Reference/03_Service_Manifest_and_Runtime_Object_Reference.md](./06_Reference/03_Service_Manifest_and_Runtime_Object_Reference.md)
2. [03_Core_Workflows/04_Provider_Registration_and_Agreement.md](./03_Core_Workflows/04_Provider_Registration_and_Agreement.md)
3. [02_System_Architecture/01_System_Topology_and_Request_Routing.md](./02_System_Architecture/01_System_Topology_and_Request_Routing.md)
4. [03_Core_Workflows/05_Withdrawal_and_Risk_Gates.md](./03_Core_Workflows/05_Withdrawal_and_Risk_Gates.md)
5. [03_Projects/provider-service/README.md](./03_Projects/provider-service/README.md)

### 5.4 看数据库和持久化真相

1. [04_Database_Design/01_SQL_Schema_Overview.md](./04_Database_Design/01_SQL_Schema_Overview.md)
2. [04_Database_Design/02_Core_Tables_and_Relationships.md](./04_Database_Design/02_Core_Tables_and_Relationships.md)
3. [../docker-compose/postgres/init/gateway/001_synapse_schema.sql](../docker-compose/postgres/init/gateway/001_synapse_schema.sql)
4. [03_Projects/infra/README.md](./03_Projects/infra/README.md)

## 6. 目录职责

### 根目录文件

只保留这些全局入口：

1. 项目原则
2. 总索引
3. 全局治理与少量顶层地图

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
8. `admin/`、`feature_designs/`、`01_Product_Vision/`
   补充材料。

## 7. 目录退役说明

以下旧技术目录已在 Phase 5 正式退役并移出主阅读路径：

1. `02_Architecture/`
2. `03_Smart_Contract_Payment/`
3. `04_Synapse_Network/`
4. `05_Frontend_UX/`
5. `06_Developer_Guides/`

它们承载的当前有效内容已被收敛进六个新官方模块、`06_Reference/05_Runtime_API_Contract.md` 与 `06_Reference/06_Runtime_Error_Code_Catalog.md`；原 `docs/agent/` 层也已完成退役。

## 8. 维护规则

1. 任何 Runtime、API、数据库、前端 IA 变更，优先更新 canonical 文档和对应官方模块 README。
2. 新文档先决定归属模块，不再向根目录和已退役技术目录散落文件。
3. Runtime 协议、身份、资金模型统一以官方模块为准，其他目录只能解释实现和应用，不能并列重定义。
4. `plan/` 只保留计划与历史记录，不再作为当前协议入口；当前执行状态以最新专项计划为准。
5. 任何 `docs/` 结构、入口或治理变更结束前，必须运行 `npm run ci:docs`。

## 9. 当前维护基准

Synapse 的当前文档体系围绕四条主线长期维护：

1. Owner 一次性入金与授权
2. Agent Runtime 自动发现、报价、调用、消费预算
3. Provider 注册服务、积累收益、申请提现
4. Platform Gateway 负责鉴权、路由、记账、审计和清算
