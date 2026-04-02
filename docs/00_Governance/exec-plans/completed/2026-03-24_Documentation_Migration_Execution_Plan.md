# Documentation Migration Execution Plan

## 0. Metadata

- Status: completed
- Owner: repo governance
- Date: 2026-03-24
- Related systems: `docs/`, `llms.txt`, `docs/00_Governance/`, `docs/03_Core_Workflows/`, `docs/04_Database_Design/`, `docs/05_DevOps_Deployment/`, `docs/06_Reference/`, `docs/admin/`, `docs/03_Projects/`
- Related docs:
  - `docs/文档迁移.md`
  - `docs/README.md`
  - `docs/00_Governance/Documentation_Lifecycle.md`
  - `docs/00_Governance/Ownership_And_Review_Matrix.md`
  - `docs/00_Governance/Drift_Checklist.md`
  - `docs/00_Governance/Agent_Docs_Migration_Map.md`
  - `docs/exec-plans/README.md`

## 1. Background

Synapse 的文档治理主框架已经落地，但迁移仍停在中间态。

当前已经完成的部分包括：

1. `docs/00_Governance/` 已建立生命周期、owner、漂移检查和 `docs/agent/` 映射规则。
2. root `docs/` 中的 `api.md` 和 `Gateway_Error_Codes.md` 已降为 redirect shell，并把 canonical 内容收口到 `docs/06_Reference/`。
3. `docs/exec-plans/` 已成为标准执行计划目录。

当前仍未完成的部分包括：

1. root `docs/` 仍保留若干承载正文的散点文件，例如数据库、测试、监控与审批流程文档。
2. `docs/agent/` 仍被阅读路径视为 runtime canonical 入口之一，尚未完成按主题并入 `00-06` 模块。
3. 部分 supplementary / legacy 文档仍缺少统一状态标记与 canonical 指向。

因此，这份计划不是重新设计目录，而是把已经确立的治理原则落实成分批执行、分批验收的实际迁移工作。

## 2. Goal

完成一轮可验证的文档迁移收口，使 Synapse 文档体系达到以下状态：

1. root `docs/` 仅承担全局入口、治理和过渡 redirect 角色，不再承载分散的长期正文真理源。
2. `docs/agent/` 从独立 canonical 层退为过渡跳转层，其有效内容分别并入官方模块。
3. 每个主题只有一个明确的 canonical 入口，并能追溯到对应代码路径或数据库真理源。
4. `docs/README.md`、`llms.txt`、项目入口页与实际真理源一致。

## 3. Non-Goals

本计划不包含以下工作：

1. 不重写所有历史文档正文，只迁移当前主阅读路径上会误导读者的文档。
2. 不在本计划内修改业务代码、数据库 schema 或运行时行为。
3. 不一次性清空 `docs/feature_designs/`、`docs/plan/` 或所有历史中文文档。
4. 不把所有 supplementary 文档都改成双语或统一重写风格。

## 4. Scope

本计划覆盖以下对象：

1. root `docs/` 散点正文文档：
   - `docs/Gateway_Database_Design.md`
   - `docs/测试文档.md`
   - `docs/平台资金监控方案.md`
   - `docs/充值退款审批流程.md`
2. `docs/agent/` 全部现存迁移对象：
   - `00_Platform_Role_Identity_Model.md`
   - `01_Agent_Runtime_Product_Architecture.md`
   - `02_Discovery_Quote_Invoke_API_Design.md`
   - `03_Service_Manifest_Field_Standard.md`
   - `04_Credential_Budget_Risk_Model.md`
   - `05_Dashboard_IA_and_Onboarding.md`
   - `06_Build_For_Agent_Database_Rebuild.md`
   - `07_Agent_SDK_Integration_Guide.md`
   - `agent_design.md`
3. 治理与入口索引：
   - `docs/README.md`
   - `llms.txt`
   - `docs/00_Governance/*`
   - 受影响的模块 README
   - 受影响的 `docs/03_Projects/*/README.md`
4. 归档与状态治理：
   - `docs/archive/` 或现有 archive 入口
   - supplementary / legacy / archive banner 与元信息

## 5. Prerequisite Reading

执行本计划前必须阅读：

1. `docs/AGENTS.md`
2. `llms.txt`
3. `docs/README.md`
4. `docs/文档迁移.md`
5. `docs/00_Governance/Documentation_Lifecycle.md`
6. `docs/00_Governance/Ownership_And_Review_Matrix.md`
7. `docs/00_Governance/Drift_Checklist.md`
8. `docs/00_Governance/Agent_Docs_Migration_Map.md`
9. `docs/exec-plans/README.md`

## 6. Implementation Steps

1. 建立迁移台账并冻结范围。
   - 为所有待迁文档补一份统一 inventory，至少记录路径、主题、当前状态、目标状态、canonical 目标目录、owner、代码路径、DB 真理源、计划批次。
   - inventory 可以并入 `docs/00_Governance/Agent_Docs_Migration_Map.md`，也可以新增独立治理文档，但必须保持单一入口。

2. 先收口 root `docs/` 散点正文。
   - 将 `docs/Gateway_Database_Design.md` 中的稳定数据库语义回写到 `docs/04_Database_Design/`。
   - 将 `docs/测试文档.md` 回写到 `docs/06_Reference/04_Development_Testing_and_Integration_Reference.md`，必要时补 `docs/05_DevOps_Deployment/`。
   - 将 `docs/平台资金监控方案.md` 的监控、对账与观测内容回写到 `docs/05_DevOps_Deployment/` 和 `docs/admin/`。
   - 将 `docs/充值退款审批流程.md` 的主流程与控制面语义分别回写到 `docs/03_Core_Workflows/` 和 `docs/admin/`。
   - 回写完成后，把 root 文件降级为 redirect shell 或 supplementary 文档，并增加 canonical 指向。

3. 按主题拆分 `docs/agent/`。
   - 架构波次：迁移角色、身份、控制链路到 `docs/02_System_Architecture/` 与 `docs/ARCHITECTURE.md`。
   - 流程波次：迁移 discover / quote / invoke 流程语义到 `docs/03_Core_Workflows/`。
   - reference 波次：迁移 manifest、SDK、稳定对象字段到 `docs/06_Reference/`。
   - 数据模型波次：迁移 budget、risk、Agent-first 数据模型到 `docs/04_Database_Design/`。
   - 旧 IA / 旧综合设计波次：判定 `05_Dashboard_IA_and_Onboarding.md` 与 `agent_design.md` 的当前有效部分并入目标模块，其余转 `legacy` 或 `archive`。

4. 在每次正文回写后同步修正入口。
   - 更新 `docs/README.md`。
   - 更新 `llms.txt`。
   - 更新目标模块 README。
   - 更新受影响的 `docs/03_Projects/<project>/README.md`。
   - 确保旧入口仍有 redirect 或替代说明，避免断链。

5. 补全文档生命周期元信息。
   - 为核心 canonical 文档补 `Status`、`Code paths`、`DB sources`、`Supersedes`、`Last verified against code`。
   - 为 supplementary / legacy / archive 文档补 `Status`、`Superseded by`、`Why retained`。
   - 优先处理 root 入口、`docs/agent/` 原文件、官方模块 README 和中文补充文档。

6. 统一整理历史层与 archive。
   - 把已被替代但仍有审计价值的设计、计划、旧 IA 统一放入 `docs/archive/` 或既有 archive 结构。
   - 每份 archive 文档必须写清替代文档、退役时间和保留原因。

7. 固化迁移后的治理规则。
   - 在治理文档或执行模板中写明“新增功能文档必须先选择 canonical 层，再创建正文”。
   - 把结构调整时的同步检查固定为最小完成标准：`docs/README.md`、`llms.txt`、模块入口页、旧文档 redirect 必须同时更新。

## 7. Acceptance Criteria

1. root `docs/` 中不再存在未标状态、未指向 canonical、且承载长期正文真理源的散点文件。
2. `docs/Gateway_Database_Design.md`、`docs/测试文档.md`、`docs/平台资金监控方案.md`、`docs/充值退款审批流程.md` 均已完成回写并降级为 supplementary 或 redirect。
3. `docs/agent/` 不再被 `docs/README.md` 与 `llms.txt` 视为长期独立 canonical 层。
4. `docs/agent/` 各文件都存在明确去向，且原文件已带 redirect、banner 或 archive 说明。
5. `docs/README.md`、`llms.txt`、目标模块 README、项目入口页的链接与描述与当前真理源一致。
6. 所有新旧入口都能明确回答三件事：当前状态、canonical 指向、保留原因。

## 8. Risks And Rollback

主要风险：

1. 迁移正文时拆分粒度不稳，导致目标模块里出现新的重复定义。
2. 先删或先降级旧文件，但入口索引未同步，导致阅读路径断裂。
3. `docs/agent/` 同一篇文档被拆到多个目标模块后，出现并列 canonical 问题。
4. supplementary 文档未明确声明地位，继续被读者误读为当前真理源。

控制措施：

1. 每次只迁一篇或一组强相关文档，不混批迁移跨多个主题。
2. 固定执行顺序为：回写正文 -> 更新入口 -> 旧文件降级。
3. 所有迁移都以 `docs/00_Governance/Ownership_And_Review_Matrix.md` 和 `Agent_Docs_Migration_Map.md` 为目标归口依据。
4. 每次结束前执行 `Drift_Checklist` 中的结构检查。

回滚策略：

1. 如果某一批迁移造成入口混乱，回滚该批次中对 README / redirect 的修改，恢复原入口，再重新拆分正文。
2. 在确认所有入口已稳定前，不删除旧文件，只允许降级为 redirect 或 supplementary。
3. 如果目标模块出现重定义冲突，保留旧文件说明，撤回目标模块新增段落，重新确定唯一归口。

## 9. Decision Log

### 2026-03-24

- Decision: 将本轮工作定义为“执行性迁移收口”，而不是新一轮目录重构。
- Reason: 目录主骨架、治理规则、部分 redirect 已存在，重复做结构设计只会延长中间态。
- Rejected alternatives: 重新设计 `docs/` 顶层结构；一次性整体移动 `docs/agent/`；先大规模归档历史层再回写 canonical。

### 2026-03-24

- Decision: 先处理 root 散点正文，再处理 `docs/agent/`。
- Reason: root 正文更容易误导阅读路径，且回收成本低、收益高。
- Rejected alternatives: 先迁 `docs/agent/` 再回收 root；并行迁全部主题导致入口同步难度上升。

### 2026-03-24

- Decision: 迁移时必须保留旧文件为 redirect、supplementary 或 archive，不能直接删除。
- Reason: 当前 `docs/README.md`、`llms.txt`、项目入口页仍可能引用旧路径，直接删除会造成断链。
- Rejected alternatives: 完成目标模块回写后立即移除旧文件。

### 2026-03-24

- Decision: 将本计划在本轮收口后移入 `docs/exec-plans/completed/`，archive 进一步规范化留作后续独立治理工作。
- Reason: 本计划的 acceptance criteria 已满足；剩余事项主要是更细粒度 archive 优化，不再阻塞本轮文档迁移收口完成判定。
- Rejected alternatives: 继续将计划保留在 `active/`，把后续 archive 优化与本轮 canonical 收口混在同一执行窗口中。

## 10. Validation Log

### 2026-03-24

- Command or check: 阅读 `docs/exec-plans/README.md` 与 `docs/exec-plans/templates/Exec_Plan_Template.md`，确认执行计划格式。
- Result: 已确认执行计划必须包含背景、目标、非目标、范围、前置阅读、实施步骤、验收、风险、决策与验证日志。
- Follow-up: 按模板创建 active plan。

### 2026-03-24

- Command or check: 核对 `docs/00_Governance/*` 与 `docs/README.md`、`llms.txt`，确认当前迁移完成度。
- Result: 已确认治理层存在、API 与错误码 redirect 已完成，但 root 散点正文与 `docs/agent/` 专项迁移仍未完成。
- Follow-up: 将批次重点放在 root 收口和 `docs/agent/` 回写。

### 2026-03-24

- Command or check: 完成 root 散点正文第一轮收口，给目标模块补 canonical 收口声明，并把四份 root 文档降级为 supplementary。
- Result: `docs/Gateway_Database_Design.md`、`docs/测试文档.md`、`docs/平台资金监控方案.md`、`docs/充值退款审批流程.md` 已补状态与 canonical 指向；`llms.txt` 与相关模块 README 已同步调整入口语义。
- Follow-up: 继续执行 `docs/README.md` 的阅读路径收口，并开始 `docs/agent/` 分主题迁移。

### 2026-03-24

- Command or check: 完成 `docs/agent/00` 与 `docs/agent/01` 的第一波迁移，回写到 `docs/02_System_Architecture/` 与 `docs/ARCHITECTURE.md`。
- Result: 身份模型已收口到 `02_System_Architecture/03_Identity_Authentication_and_Risk_Control.md`；Runtime 五层架构和控制/执行链路已收口到 `02_System_Architecture/02_Gateway_Runtime_Architecture.md`；原 agent 文档已降级为 supplementary。
- Follow-up: 继续迁移 `docs/agent/02`、`03`、`04`、`07` 到 `03_Core_Workflows/`、`06_Reference/` 与 `04_Database_Design/`。

### 2026-03-24

- Command or check: 完成 `docs/agent/02`、`docs/agent/03`、`docs/agent/07` 的第二波迁移，回写到 `docs/03_Core_Workflows/` 与 `docs/06_Reference/`。
- Result: discover / quote / invoke 的流程语义已收口到 `03_Core_Workflows/02_Discovery_and_Gateway_Call.md`；Manifest 字段标准已收口到 `06_Reference/03_Service_Manifest_and_Runtime_Object_Reference.md`；SDK integration posture 已收口到 `06_Reference/04_Development_Testing_and_Integration_Reference.md`；原 agent 文档已降级为 supplementary。
- Follow-up: 继续迁移 `docs/agent/04` 与 `docs/agent/06`，把 credential / budget / risk 和 Agent-first 数据模型回写到 `02_System_Architecture/` 与 `04_Database_Design/`。

### 2026-03-24

- Command or check: 完成 `docs/agent/04` 与 `docs/agent/06` 的第三波迁移，回写到 `02_System_Architecture/` 与 `04_Database_Design/`。
- Result: credential / budget / runtime risk 的架构边界已收口到 `02_System_Architecture/03_Identity_Authentication_and_Risk_Control.md`；Agent-first 数据库重建 rationale 与旧表重构边界已收口到 `04_Database_Design/01_SQL_Schema_Overview.md`；原 agent 文档已降级为 supplementary。
- Follow-up: 评估 `docs/agent/05_Dashboard_IA_and_Onboarding.md` 与 `docs/agent/agent_design.md` 的当前有效部分，决定并入 `01_Product_Frontend/` / `02_System_Architecture/` 或迁入 archive。

### 2026-03-24

- Command or check: 完成 `docs/agent/05_Dashboard_IA_and_Onboarding.md` 的前台收口，并把 `docs/agent/agent_design.md` 降级为 legacy 索引壳。
- Result: Owner Console 的高层 IA 与首次激活路径已收口到 `docs/01_Product_Frontend/README.md`；`docs/agent/agent_design.md` 已明确退为历史入口，不再承担当前导航职责。
- Follow-up: 下一轮收口可评估是否把 `docs/agent/` 目录整体退为 redirect 层，并同步更新 `docs/03_Projects/*/README.md` 的入口引用。

### 2026-03-24

- Command or check: 为 `docs/agent/` 新增目录级总入口，并同步更新 `docs/README.md` 与 `llms.txt`，明确其仅为迁移层。
- Result: `docs/agent/README.md` 已建立统一迁移入口；`docs/README.md` 的阅读路径、canonical source of truth、目录职责已改为官方模块优先；`llms.txt` 已把 `docs/agent/` 声明为 migration-layer index。
- Follow-up: 如后续没有新的外部引用兼容需求，可评估是否继续收缩每篇 `docs/agent/*` 的正文体量，仅保留 redirect 与必要历史上下文。

### 2026-03-24

- Command or check: 将 `docs/agent/*.md` 再压缩一轮，统一收成更薄的 redirect shell。
- Result: `docs/agent/00-07` 与 `agent_design.md` 已去掉大段展开正文，统一仅保留状态、canonical 去向、极少量历史上下文和维护规则；`docs/agent/README.md` 也已同步收紧为“极少量历史上下文”口径。
- Follow-up: 后续若确认外部引用已稳定，可继续评估是否把部分 supplementary 单文档进一步收成仅一屏跳转壳。

### 2026-03-24

- Command or check: 依据 `docs/exec-plans/README.md`、`docs/00_Governance/Drift_Checklist.md` 与本计划 acceptance criteria 做最终收尾评估。
- Result: 已确认 root 散点正文均已降级并指向 canonical；`docs/agent/` 已退为迁移层且各文件都有明确去向；`docs/README.md`、`llms.txt`、受影响模块 README 与 `docs/03_Projects/*` 入口已完成改链；本计划满足移入 `completed/` 的条件。
- Follow-up: 将文件从 `docs/exec-plans/active/` 移入 `docs/exec-plans/completed/`，保留为仓库记忆。

## 11. Completion Notes

当前状态：本计划主目标已完成，可转入 `completed/`。

实际迁移的文件清单：

1. root supplementary 收口：`docs/Gateway_Database_Design.md`、`docs/测试文档.md`、`docs/平台资金监控方案.md`、`docs/充值退款审批流程.md`
2. canonical 模块回写：`docs/ARCHITECTURE.md`、`docs/01_Product_Frontend/README.md`、`docs/02_System_Architecture/README.md`、`docs/02_System_Architecture/02_Gateway_Runtime_Architecture.md`、`docs/02_System_Architecture/03_Identity_Authentication_and_Risk_Control.md`、`docs/03_Core_Workflows/README.md`、`docs/03_Core_Workflows/02_Discovery_and_Gateway_Call.md`、`docs/04_Database_Design/README.md`、`docs/04_Database_Design/01_SQL_Schema_Overview.md`、`docs/04_Database_Design/03_Balance_Ledger_and_Reservation_Model.md`、`docs/05_DevOps_Deployment/README.md`、`docs/05_DevOps_Deployment/03_Observability_Logging_and_Indexer_Operations.md`、`docs/06_Reference/03_Service_Manifest_and_Runtime_Object_Reference.md`、`docs/06_Reference/04_Development_Testing_and_Integration_Reference.md`、`docs/admin/Admin_Approval_Workflow.md`、`docs/admin/Admin_Funds_Observability_Metrics_Design.md`
3. 入口索引：`docs/README.md`、`llms.txt`、`docs/03_Projects/gateway/README.md`、`docs/03_Projects/gateway/Gateway_Local_Development.md`、`docs/03_Projects/frontend/README.md`、`docs/03_Projects/frontend/Frontend_Local_Development.md`、`docs/03_Projects/frontend/Frontend_Agent_Rules.md`、`docs/03_Projects/contracts/README.md`、`docs/03_Projects/sdk-python/README.md`、`docs/03_Projects/sdk-python/SDK_Python_Local_Development.md`
4. 迁移层壳：`docs/agent/README.md`、`docs/agent/00_Platform_Role_Identity_Model.md`、`docs/agent/01_Agent_Runtime_Product_Architecture.md`、`docs/agent/02_Discovery_Quote_Invoke_API_Design.md`、`docs/agent/03_Service_Manifest_Field_Standard.md`、`docs/agent/04_Credential_Budget_Risk_Model.md`、`docs/agent/05_Dashboard_IA_and_Onboarding.md`、`docs/agent/06_Build_For_Agent_Database_Rebuild.md`、`docs/agent/07_Agent_SDK_Integration_Guide.md`、`docs/agent/agent_design.md`

新增或改写的 canonical 文档入口：

1. runtime 身份、架构、流程、Manifest、SDK、数据库与前台入口均已回收到官方模块 README 与对应主题文档。
2. `docs/README.md` 与 `llms.txt` 已改为官方模块优先，不再把 `docs/agent/` 当独立 canonical 层。
3. `docs/03_Projects/*` 受影响项目入口已全部改指向新的 canonical 模块。

已降级为 redirect / supplementary / legacy 的旧文件：

1. root 四份散点正文已降级为 supplementary。
2. `docs/agent/00-07` 已降级为 supplementary migration shell。
3. `docs/agent/agent_design.md` 已降级为 legacy shell。

尚未处理的后续债务：

1. archive 层仍可在后续专项中进一步规范化，但不影响本计划完成判定。

## 12. Post-Completion Addendum

### 2026-03-24

- Command or check: 清理最后一轮活跃入口与治理文档中的 `docs/agent/` 依赖，并移除整个目录。
- Result: `docs/README.md`、`llms.txt`、官方模块 README、项目入口与治理说明均已改为官方模块或历史迁移记录优先；`docs/agent/` 目录已从仓库删除。
- Follow-up: 后续若需追溯这次拆分，只查看 `docs/00_Governance/Agent_Docs_Migration_Map.md` 与本执行计划，不再恢复目录级跳转壳。

### 2026-03-24

- Command or check: 删除 root `docs/` 下最后一批 redirect / supplementary 壳文件，并同步修正项目入口与机器入口。
- Result: `docs/api.md`、`docs/Gateway_Error_Codes.md`、`docs/Gateway_Database_Design.md`、`docs/测试文档.md`、`docs/平台资金监控方案.md`、`docs/充值退款审批流程.md` 已从仓库移除；`docs/README.md`、`llms.txt`、模块 README 与 `docs/03_Projects/*` 活跃入口已全部改为 canonical 文档。
- Follow-up: 后续若再做 archive 专项，只处理历史计划与策略材料，不再恢复任何 root redirect shell。