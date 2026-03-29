# Agent Docs Migration Map

## 1. Purpose

本文件是 former `docs/agent/` 专项拆分迁移的执行地图。

目标不是保留 `agent/` 作为长期独立层，而是把 former `docs/agent/` 的内容按主题吸收进 `00-06` 对应模块。

## 2. Migration Rules

1. 每次只迁移一篇或一组强相关文档。
2. 先迁正文，再补入口链接，再给原文档加 redirect banner。
3. 在删除原目录前，先修正 `docs/README.md`、`llms.txt` 和项目页引用。
4. 迁移后的 canonical 归口必须唯一，禁止一篇拆出两个并列真理源。

## 3. Mapping

| 当前文件 | 主要内容 | 目标模块 | 处理方式 |
| --- | --- | --- | --- |
| `docs/agent/00_Platform_Role_Identity_Model.md` | Owner / Agent / Provider 角色、身份模型 | `docs/02_System_Architecture/` | 拆并为角色与身份边界主文档 |
| `docs/agent/01_Agent_Runtime_Product_Architecture.md` | Runtime 总体结构、控制链路与执行链路 | `docs/02_System_Architecture/` + `docs/ARCHITECTURE.md` | 主体并入架构模块，顶层摘要回写 ARCHITECTURE |
| `docs/agent/02_Discovery_Quote_Invoke_API_Design.md` | discover / quote / invoke 协议 | `docs/03_Core_Workflows/` + `docs/06_Reference/` | 流程语义回写 workflows，字段/contract 回写 reference |
| `docs/agent/03_Service_Manifest_Field_Standard.md` | manifest 字段规范 | `docs/06_Reference/` | 作为稳定对象参考吸收 |
| `docs/agent/04_Credential_Budget_Risk_Model.md` | credential / budget / risk | `docs/02_System_Architecture/` + `docs/04_Database_Design/` | 边界归架构，数据对象归数据库 |
| `docs/agent/05_Dashboard_IA_and_Onboarding.md` | dashboard IA 与 onboarding | `docs/01_Product_Frontend/` 或 `docs/archive/` | 若已过时则归档，当前事实部分并入产品前台模块 |
| `docs/agent/06_Build_For_Agent_Database_Rebuild.md` | Agent-first 数据模型重建 | `docs/04_Database_Design/` | 并入数据库模型与演进说明 |
| `docs/agent/07_Agent_SDK_Integration_Guide.md` | SDK 集成 | `docs/06_Reference/` | 并入 reference 层 |
| `docs/agent/agent_design.md` | 旧综合设计 | `docs/02_System_Architecture/` 或 `docs/archive/` | 先判定是否仍有 canonical 内容 |

## 4. Execution Order

建议顺序：

1. `00_Platform_Role_Identity_Model.md`
2. `01_Agent_Runtime_Product_Architecture.md`
3. `02_Discovery_Quote_Invoke_API_Design.md`
4. `03_Service_Manifest_Field_Standard.md`
5. `04_Credential_Budget_Risk_Model.md`
6. `06_Build_For_Agent_Database_Rebuild.md`
7. `07_Agent_SDK_Integration_Guide.md`
8. `05_Dashboard_IA_and_Onboarding.md`
9. `agent_design.md`

## 5. Completion Criteria

former `docs/agent/` 可以退为跳转层或移除，需同时满足：

1. `docs/README.md` 不再把 `agent/` 当作长期独立 canonical 层
2. `llms.txt` 已更新为新入口
3. `docs/03_Projects/gateway/README.md` 等项目入口已改指向新模块
4. 原文档全部有替代说明或已迁入 archive

当前状态补记：上述条件已经满足，`docs/agent/` 目录已从仓库移除，本文件与执行计划仅保留历史迁移轨迹。