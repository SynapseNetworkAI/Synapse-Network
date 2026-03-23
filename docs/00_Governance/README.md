# Documentation Governance

本目录收敛 Synapse 文档体系的治理规则，而不是业务语义本身。

它回答四个问题：

1. 什么文档可以成为 canonical
2. 一份文档处于什么生命周期状态
3. 哪类主题由哪一层文档负责
4. 如何在代码、数据库、API 变更时防止文档漂移

## 文件索引

1. `Documentation_Lifecycle.md`
2. `Ownership_And_Review_Matrix.md`
3. `Drift_Checklist.md`
4. `Agent_Docs_Migration_Map.md`

## 使用顺序

1. 先读 `Documentation_Lifecycle.md`，判断一份文档应该处于哪个状态。
2. 再读 `Ownership_And_Review_Matrix.md`，判断主题应该归属哪个 canonical 目录。
3. 在实施 API / DB / 运维 / 架构修改前，读 `Drift_Checklist.md` 做同步检查。
4. 当处理 `docs/agent/` 专项拆分时，读 `Agent_Docs_Migration_Map.md`。

## 模块边界

本目录不承担：

1. Runtime 协议定义
2. 数据库结构定义
3. 项目本地开发说明
4. 产品 IA 或页面设计

这些内容仍分别回到 `02_System_Architecture/`、`03_Core_Workflows/`、`04_Database_Design/`、`03_Projects/`、`01_Product_Frontend/` 等对应模块。

## 核心结论

Synapse 的文档治理目标，不是让目录看起来整齐，而是让任何实现改动都能在固定的真理源层级中被定位、验证和回写。