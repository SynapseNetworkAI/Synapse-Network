# Documentation Lifecycle

## 1. Purpose

本文件定义 Synapse 文档的生命周期状态和准入规则。

任何文档都必须能回答两个问题：

1. 它是不是当前真理源
2. 它是否还应该继续维护

## 2. Allowed States

每份文档必须属于以下五种状态之一：

1. `canonical`
2. `supplementary`
3. `incubation`
4. `legacy`
5. `archive`

没有状态的文档，默认视为治理缺失。

## 3. State Rules

### 3.1 `canonical`

适用条件：

1. 该文档定义当前稳定语义。
2. 代码、数据库、接口或流程变更时，必须同步更新它。
3. 其他文档只能引用它，不能并列重定义。

典型位置：

1. `docs/AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/02_System_Architecture/`
4. `docs/03_Core_Workflows/`
5. `docs/04_Database_Design/`
6. `docs/06_Reference/`
7. `docs/03_Projects/`
8. `docs/admin/`

### 3.2 `supplementary`

适用条件：

1. 它提供补充说明、示例、中文说明或阅读辅助。
2. 它不能单独定义当前系统真相。
3. 必须显式指向对应 canonical 文档。

典型位置：

1. former root `docs/测试文档.md`
2. former root `docs/平台资金监控方案.md`
3. former root `docs/充值退款审批流程.md`

### 3.3 `incubation`

适用条件：

1. 文档描述正在试验或尚未稳定的设计。
2. 该设计尚未完全成为当前实现事实。
3. 必须声明未来 canonical 目标目录。

典型位置：

1. `docs/feature_designs/`

### 3.4 `legacy`

适用条件：

1. 文档有历史价值，但已不再作为当前主语义来源。
2. 保留它是为了理解旧实现、迁移背景或商业背景。
3. 必须写清楚已被什么替代。

典型位置：

1. `docs/plan/`
2. 被标记为旧 IA、旧命名、旧流程的页面

### 3.5 `archive`

适用条件：

1. 文档已彻底退役。
2. 保留原因是审计、追溯或决策记录。
3. 不再进入主阅读路径。

典型位置：

1. `docs/archive/`
2. `docs/exec-plans/completed/`

## 4. Required Metadata

所有 `docs/**/README.md` 入口页都必须在文档头部显式声明生命周期状态。

README 的最小要求如下：

1. `canonical` README 必须提供 `Status`、`Code paths`、`Last verified against code`
2. `supplementary` / `legacy` / `archive` README 必须提供 `Status`、`Canonical counterpart` 或 `Superseded by`、`Why retained`
3. `incubation` README 必须提供 `Status`、`Canonical target`、`Why retained`

所有 `canonical` 文档应逐步补齐以下元信息：

1. `Status`
2. `Code paths`
3. `DB sources`
4. `Supersedes`
5. `Last verified against code`

当前轻量硬门槛：任何在头部显式声明 `- Status: canonical` 的文档，必须至少同时给出：

1. `Code paths`
2. `Last verified against code`

另外，承担 root entrypoint、governance entrypoint 或 canonical truth 职责的高价值文档，必须登记到 `Documentation_Inventory.md`，由 inventory 提供 owner、review cadence 与最近 review 时间。

所有 `incubation`、`legacy`、`archive` 文档应至少补齐：

1. `Status`
2. `Superseded by`
3. `Why retained`

如果它本身是 README 入口页，则也可以使用 `Canonical counterpart` 代替 `Superseded by`，只要当前真相源指向明确且不制造并列定义。

## 5. Graduation Rules

`incubation` 文档升级为 `canonical` 前，应满足：

1. 相关实现已经进入代码主路径
2. 关键字段、路由、状态语义已经稳定
3. 对应测试或验证入口已存在
4. 已回写到目标 canonical 模块

升级完成后：

1. 原文档转为 `supplementary`
2. 或转为 `archive`
3. 或保留短跳转页

## 6. Deprecation Rules

当一份 `canonical` 文档被替代时：

1. 先创建新的 canonical 文档
2. 修复 `docs/README.md`、`llms.txt`、项目入口页链接
3. 再将旧文档改成 `legacy` 或 `archive`

禁止直接删除仍被入口索引引用的文档。

## 7. Root Admission Rule

root `docs/` 不再是自由落点。

新增 root Markdown 文件前，必须先回答：

1. 为什么它不能进入官方模块、`docs/03_Projects/`、`docs/admin/` 或治理目录
2. 为什么它必须成为长期顶层入口
3. 是否已同步更新 `Documentation_Constraints.md` 与 docs gate

如果回答不清楚，就说明它不该落在 root。