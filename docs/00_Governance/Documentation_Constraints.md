# Documentation Constraints

## 1. Purpose

本文件定义 Synapse `docs/` 目录的硬边界。

目标不是让文档“看起来更整齐”，而是防止后续维护重新回到：

1. root `docs/` 散落正文
2. 退役入口复活
3. README 入口页重新变回无状态壳文件
4. canonical 文档缺少可机读元信息
4. 索引文件和真实入口逐步漂移

## 2. Root Docs Admission Rule

root `docs/` 只允许保留全局入口、治理地图和稳定顶层说明。

当前允许存在的 root Markdown 文件只有：

1. `docs/AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/Design.md`
4. `docs/Harness_engineering.md`
5. `docs/README.md`
6. `docs/文档迁移.md`

除非先修改本文件与 docs gate，否则不要新增新的 root Markdown 文件。

任何新的长期正文，都必须进入对应模块目录，而不是回到 root `docs/`。

## 3. Canonical Placement Rule

当前稳定语义只能落在以下目录：

1. `docs/00_Governance/`
2. `docs/01_Product_Frontend/`
3. `docs/02_System_Architecture/`
4. `docs/03_Core_Workflows/`
5. `docs/03_Projects/`
6. `docs/04_Database_Design/`
7. `docs/05_DevOps_Deployment/`
8. `docs/06_Reference/`
9. `docs/admin/`

对应原则：

1. 产品与 IA 真相不回 root。
2. Runtime 协议与架构真相不回专题散文。
3. 数据库与资金真相不回 quick reference 壳文件。
4. 项目本地说明统一回 `docs/03_Projects/`。

## 4. Retired Paths Reserve List

以下路径已经退役，不得恢复为活跃入口：

1. `docs/agent/`
2. `docs/api.md`
3. `docs/Gateway_Error_Codes.md`
4. `docs/Gateway_Database_Design.md`
5. `docs/测试文档.md`
6. `docs/平台资金监控方案.md`
7. `docs/充值退款审批流程.md`

如果需要追溯历史，只能在治理文档、迁移记录或 completed execution plans 中提及它们，不能把它们重新接回主导航。

## 5. Canonical Metadata Minimum

任何位于 `docs/**/README.md` 的入口页，都必须在文档头部显式声明生命周期状态。

规则如下：

1. `canonical` README 必须同时提供 `Code paths`、`Verified with` 与 `Last verified against code`
2. `supplementary` / `legacy` / `archive` README 必须同时提供 `Canonical counterpart` 或 `Superseded by`，以及 `Why retained`
3. `incubation` README 必须同时提供 `Canonical target` 与 `Why retained`

原因很简单：README 在 Synapse 文档体系里天然承担导航和首屏入口职责，如果没有状态，AI 和维护者都会把它当作未分层的默认真相源。

任何在文档头部声明 `- Status: canonical` 的文档，必须在同一段元信息内同时提供：

1. `Code paths`
2. `Verified with`
3. `Last verified against code`

推荐同时提供：

1. `DB sources`
2. `Supersedes`

原因很简单：canonical 文档如果不能告诉 AI “对应哪里”、“用什么校验它” 和 “最近按什么代码核过”，它就不够稳定。

## 6. Index Sync Rule

当新增、移动、归档、退役文档时，至少同步检查：

1. `docs/README.md`
2. `llms.txt`
3. `docs/06_Reference/Validation_Entry_Points.md`
4. 受影响模块的 `README.md`
5. 受影响项目页 under `docs/03_Projects/`

如果文档变更影响的是 AI 导航、校验入口或长期 canonical 归属，以上文件不能漏更新。

## 7. Historical Exceptions

以下位置允许保留历史提及、迁移说明和已退役路径引用：

1. `docs/文档迁移.md`
2. `docs/00_Governance/Agent_Docs_Migration_Map.md`
3. `docs/exec-plans/completed/`
4. `docs/plan/`

但这些位置不应再承担活跃入口职责。

## 8. Enforced Gate

当前轻量校验入口：

1. `npm run ci:docs`

它当前负责检查：

1. root `docs/` Markdown 文件是否越界膨胀
2. 退役路径是否被重新创建
3. 活跃 Markdown 导航是否重新链接到退役入口
4. `llms.txt` 是否重新暴露退役入口
5. `docs/**/README.md` 入口页是否缺少生命周期元信息
6. canonical README 的 `Verified with` 是否缺失或引用失效的 root `npm run` 脚本
7. canonical 文档的最小元信息是否缺失
8. `docs/00_Governance/Documentation_Inventory.md` 是否覆盖 root entrypoints 和显式 canonical 文档
9. inventory freshness 是否超过 review cadence

这不是最终形态的 doc freshness system，但已经足够把最容易复发的膨胀和漂移挡在门外。