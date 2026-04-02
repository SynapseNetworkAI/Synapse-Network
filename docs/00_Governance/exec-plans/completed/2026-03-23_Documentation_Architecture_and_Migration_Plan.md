# Synapse Documentation Architecture And Migration Plan

> 归档说明：本文最初位于 `docs/plan/`，现已迁入 `docs/exec-plans/completed/` 作为已完成的历史治理计划保留。

## 0. 状态说明

这份文档是 2026-03-23 的第一版文档治理方案，主要价值在于记录“为什么要做这轮整理”。

后续实际迁移已经继续收敛，当前执行与落地状态请优先看：

1. [2026-03-23_Project_Docs_Centralization_Migration_Plan.md](./2026-03-23_Project_Docs_Centralization_Migration_Plan.md)

当前应这样理解这两份文档的关系：

1. 本文档保留为“第一版治理思路与问题盘点”历史记录。
2. `2026-03-23_Project_Docs_Centralization_Migration_Plan.md` 是后续集中化迁移的执行版计划。
3. 项目文档现状已经不再停留在本文描述的早期混合阶段，`docs/03_Projects/` 已经从项目导航层演进为项目文档集中维护层。

## 1. 目标

这份规划要解决 4 个问题：

1. 文档应该集中放在一个 `docs/` 目录，还是分散在各项目目录里。
2. 当前仓库到底有几个项目，各自职责是什么。
3. 现在文档分布在哪里，哪些是重复、混放、边界不清。
4. 后续应该按什么结构迁移，才能支撑继续扩项目而不失控。

一句话结论：

**Synapse 这种 monorepo 不适合“每个项目各写各的 docs 作为主体系”，应该采用“根目录 `docs/` 集中治理 + 各项目只保留极少量贴身文档”的混合模式。**

补充说明：

这个“一开始的混合模式”已经在后续执行中进一步收敛为更强的集中维护模式：项目 canonical 文本统一进入根 `docs/03_Projects/`，项目目录只保留入口壳和必要执行镜像。

## 2. 结论先行

### 2.1 推荐方案

采用：

1. **根目录 `docs/` 作为唯一 canonical 文档中心**
2. **各项目目录只保留最小贴身文档**

### 2.2 为什么不是“所有文档都散在各项目里”

因为 Synapse 不是多个互不相干的小仓库，而是一个强耦合的产品系统：

1. `gateway`、`contracts`、`frontend`、`sdk`、`provider_service`、`gateway-admin` 之间存在明确接口和流程依赖。
2. 绝大多数文档不是“某个单项目的私有说明”，而是跨项目真相：产品定义、架构、数据库、资金流程、API 契约、运维策略。
3. 如果每个项目自己维护一套 docs，结果一定是：
   - 契约重复定义
   - 字段变了改不全
   - 同一能力在多个地方有多个版本
   - 新同学不知道先看哪里

### 2.3 为什么也不是“所有文档都必须只在根 docs，没有任何项目内文档”

因为每个项目仍然需要少量“贴身文档”：

1. 本项目 `README.md`
2. 本项目 `AGENTS.md`
3. 本项目本地启动/调试/运维最小手册

这类文档离代码越近越好，因为它们是“进入目录立即执行”的说明，不是跨系统真相。

## 3. 当前项目盘点

## 3.1 核心运行项目

### 1. `gateway/`

- 职责：核心结算网关，负责 Agent Runtime 的发现、报价、调用、扣费、结算、余额与链下高速路径。
- 类型：核心后端服务。
- 当前文档位置：
  - 根 `docs/` 为主
  - 本目录几乎没有独立 docs 体系

### 2. `contracts/`

- 职责：链上金库合约与 USDC 充值/提现相关合约逻辑。
- 类型：智能合约工程。
- 当前文档位置：
  - 根 `docs/` 为主
  - 合约目录内无系统化文档

### 3. `apps/frontend/`

- 职责：面向用户/Owner/开发者的主前端控制台与 Marketplace 入口。
- 类型：Next.js 前端应用。
- 当前文档位置：
  - `apps/frontend/README.md`
  - `apps/frontend/AGENTS.md`
  - 根 `docs/01_Product_Frontend/` 中有大量前端与 IA 文档

### 4. `admin/gateway-admin/`

- 职责：后台管理员控制面后端，负责管理员认证、RBAC、审批流、审计、执行编排、只读投影聚合。
- 类型：后台控制面后端服务。
- 当前文档位置：
  - `admin/gateway-admin/README.md`
  - `admin/gateway-admin/AGENTS.md`
  - `admin/gateway-admin/docs/`
  - 根 `docs/admin/`

### 5. `admin/admin-front/`

- 职责：管理员前端控制台。
- 类型：Next.js 后台前端。
- 当前文档位置：
  - `admin/admin-front/README.md`
  - `admin/admin-front/AGENTS.md`
  - 许多设计说明仍在根 `docs/admin/` 与 `docs/01_Product_Frontend/`

### 6. `provider_service/`

- 职责：独立 Provider 微服务样板工程，用于挂载可被 Gateway 调用的 Provider API。
- 类型：独立 Python Provider Runtime。
- 当前文档位置：
  - `provider_service/README.md`
  - `provider_service/docs/AGENTS.md`
  - `provider_service/docs/Operations-Runbook.md`
  - 根 `docs/provider_service/`

### 7. `sdk/python/`

- 职责：官方 Python SDK，封装 discover / quote / invoke / receipt 运行时调用。
- 类型：Python SDK / package。
- 当前文档位置：
  - `sdk/python/README.md`
  - 根 `docs/sdk/README.md`

## 3.2 基础设施与支撑项目

### 8. `docker-compose/`

- 职责：本地基础设施编排、PostgreSQL 初始化。
- 类型：基础设施目录。
- 当前文档位置：
  - 说明散落在根 `README.md`、`docs/05_DevOps_Deployment/`、`docs/admin/`、SQL 注释中

### 9. `scripts/` 与 `tools/`

- 职责：本地环境启动、停止、重启、辅助运维与开发脚本。
- 类型：工具目录。
- 当前文档位置：
  - 说明散落在根 `README.md`、各项目 `README.md`、`docs/05_DevOps_Deployment/`

## 4. 当前文档分布现状

## 4.1 现有主要文档区

### A. 根目录 `docs/`

这是当前最完整的一套文档体系，已经承载：

1. 产品愿景
2. 系统架构
3. 核心工作流
4. 数据库设计
5. DevOps 与部署
6. 参考契约
7. admin 专题
8. provider_service 专题
9. plan / feature design / 竞品调研

### B. 项目内文档目录

当前已有：

1. `admin/gateway-admin/docs/`
2. `provider_service/docs/`

同时各项目又有自己的：

1. `README.md`
2. `AGENTS.md`

## 4.2 现状问题

### 问题 1：同一主题跨两层甚至三层存在

例如：admin 相关文档同时出现在：

1. `docs/admin/`
2. `admin/gateway-admin/docs/`
3. `admin/gateway-admin/README.md`

### 问题 2：项目内文档目录命名不统一

现在同时存在：

1. `docs/`
2. `doc/`

这会导致：

1. 搜索习惯不一致
2. 自动化约定难统一
3. 新项目不知道该用 `doc` 还是 `docs`

### 问题 3：根 docs 已经按“知识领域”分层，但项目维度仍弱

当前根 `docs/` 更像“知识库”，但不是“项目导航图”。

结果是：

1. 新人知道看产品、架构、数据库
2. 但不容易迅速回答“哪个文档属于哪个项目”

### 问题 4：贴身运维文档和系统级文档边界混乱

例如：

1. 某些本地启动说明适合留在项目内
2. 某些部署与金融事故处理明明是系统级，却分散在多个项目目录

## 5. 文档治理目标结构

## 5.1 总体原则

未来文档分三层：

### 第一层：根 `docs/` 唯一真相中心

承载跨项目、跨团队、长期稳定的 canonical 文档。

### 第二层：项目贴身文档

每个项目目录只保留：

1. `README.md`
2. `AGENTS.md`
3. `docs/` 下极少量本项目运行手册（如果确实需要）

### 第三层：归档层

历史方案、废弃设计、迁移草案、临时研究，统一进入归档区，不和当前真相混在一起。

## 5.2 推荐目标结构

```text
docs/
├── README.md
├── AGENTS.md
├── 00_Governance/
│   ├── Documentation_Standards.md
│   ├── Contribution_Rules.md
│   └── Naming_and_Lifecycle.md
├── 01_Product/
│   ├── Vision/
│   ├── Frontend/
│   ├── Admin/
│   └── Provider_Marketplace/
├── 02_Architecture/
│   ├── Runtime/
│   ├── Identity/
│   ├── Routing/
│   └── Bounded_Contexts/
├── 03_Projects/
│   ├── gateway/
│   ├── contracts/
│   ├── frontend/
│   ├── gateway-admin/
│   ├── admin-front/
│   ├── provider-service/
│   ├── sdk-python/
│   └── infra/
├── 04_Workflows/
├── 05_Data/
├── 06_Operations/
├── 07_Reference/
├── 08_ADR/
├── 09_Plans/
└── 10_Archive/
```

## 5.3 这套结构怎么理解

### `01_Product/`

放产品定位、角色模型、IA、前端体验、后台产品设计。

### `02_Architecture/`

放系统拓扑、网关运行时、身份鉴权、领域边界。

### `03_Projects/`

这是本次建议新增的关键层。

它的作用不是复制每个项目的 README，而是：

1. 给每个项目一份统一的项目说明入口
2. 说明项目职责、边界、依赖关系、运行方式、关联文档
3. 让人一眼知道“这个项目属于系统什么位置”

### `04_Workflows/`

放跨项目主流程，例如：

1. 充值
2. 发现/报价/调用
3. 结算与审计
4. Provider 注册与提现

### `05_Data/`

放数据库、表结构、账本模型、一致性、投影模型。

### `06_Operations/`

放系统级运维、CI/CD、部署、故障响应、观测。

### `07_Reference/`

放 API、错误码、Manifest、SDK 参考、测试参考。

### `08_ADR/`

放架构决策记录，例如：

1. 为什么采用中心化网关 + 链上结算
2. 为什么 Provider 公开协议不暴露结算面
3. 为什么 admin 独立 control plane

### `09_Plans/`

放执行计划、迁移计划、里程碑规划。

### `10_Archive/`

放历史文档、废弃方案、过时目录，不再和当前真相混放。

## 6. 各项目目录内应该保留什么

## 6.1 每个项目一律保留

1. `README.md`
2. `AGENTS.md`

## 6.2 项目内 `docs/` 只允许保留这些类型

1. 本项目本地运行手册
2. 本项目环境变量说明
3. 本项目 operator 手册
4. 本项目与代码紧耦合、且使用者主要在该目录工作的说明

## 6.3 项目内不要再保留这些类型

以下内容应迁移到根 `docs/`：

1. 系统架构设计
2. 跨项目 API 契约
3. 跨项目数据库设计
4. 产品级 IA / 角色模型
5. 通用部署策略
6. 平台级运维规则

## 6.4 项目内文档命名统一

以后统一使用：

1. `README.md`
2. `AGENTS.md`
3. `docs/`

禁止继续新增：

1. `doc/`
2. `manual/`
3. `notes/`

也就是说，`provider_service` 的本地文档目录已在第一批迁移中统一为 `provider_service/docs/`，后续继续只保留贴身运行文档，把系统级内容迁回根 `docs/`。

## 7. 当前项目职责与推荐文档落位

## 7.1 `gateway/`

- 职责：运行时结算与调用主链路。
- 推荐文档：
  - 项目内：`README.md`、`AGENTS.md`、必要时 `docs/Local_Runbook.md`
  - 根目录：`docs/03_Projects/gateway/`、`docs/02_Architecture/`、`docs/04_Workflows/`、`docs/05_Data/`、`docs/07_Reference/`

## 7.2 `contracts/`

- 职责：链上 Vault 与签名提现。
- 推荐文档：
  - 项目内：`README.md`
  - 根目录：`docs/03_Projects/contracts/`、`docs/02_Architecture/`、`docs/05_Data/`

## 7.3 `apps/frontend/`

- 职责：Owner / Developer 主前端。
- 推荐文档：
  - 项目内：`README.md`、`AGENTS.md`
  - 根目录：`docs/03_Projects/frontend/`、`docs/01_Product/Frontend/`

## 7.4 `admin/gateway-admin/`

- 职责：后台控制面 API。
- 推荐文档：
  - 项目内：`README.md`、`AGENTS.md`、`docs/Operations.md`、`docs/Env.md`
  - 根目录：`docs/03_Projects/gateway-admin/`、`docs/01_Product/Admin/`、`docs/06_Operations/`

## 7.5 `admin/admin-front/`

- 职责：后台前端控制台。
- 推荐文档：
  - 项目内：`README.md`、`AGENTS.md`
  - 根目录：`docs/03_Projects/admin-front/`、`docs/01_Product/Admin/`

## 7.6 `provider_service/`

- 职责：Provider 样板微服务。
- 推荐文档：
  - 项目内：`README.md`、`AGENTS.md`、`docs/Operations.md`
  - 根目录：`docs/03_Projects/provider-service/`、`docs/01_Product/Provider_Marketplace/`、`docs/07_Reference/`

## 7.7 `sdk/python/`

- 职责：官方 Python SDK。
- 推荐文档：
  - 项目内：`README.md`
  - 根目录：`docs/03_Projects/sdk-python/`、`docs/07_Reference/`

## 7.8 `docker-compose/` / `scripts/` / `tools/`

- 职责：基础设施与运维支撑。
- 推荐文档：
  - 项目内：尽量不建复杂 docs
  - 根目录：`docs/03_Projects/infra/`、`docs/06_Operations/`

## 8. 迁移策略

## 8.1 Phase 1: 先定规则，不大搬家

先做这几件事：

1. 确认根 `docs/` 是唯一 canonical 中心
2. 统一规定项目内只保留最小贴身文档
3. 统一项目内文档目录名称为 `docs/`
4. 新增 `docs/03_Projects/` 作为项目导航层

## 8.2 Phase 2: 做项目导航页

先不要急着搬正文，先给每个项目建立一份导航页：

1. `docs/03_Projects/gateway/README.md`
2. `docs/03_Projects/contracts/README.md`
3. `docs/03_Projects/frontend/README.md`
4. `docs/03_Projects/gateway-admin/README.md`
5. `docs/03_Projects/admin-front/README.md`
6. `docs/03_Projects/provider-service/README.md`
7. `docs/03_Projects/sdk-python/README.md`
8. `docs/03_Projects/infra/README.md`

每页只写：

1. 项目职责
2. 代码位置
3. 对外边界
4. 依赖关系
5. 相关 canonical 文档链接
6. 本地 README / agents 链接

这样迁移时不会迷路。

## 8.3 Phase 3: 清理项目内重文档

### `admin/gateway-admin/docs/`

处理方式：

1. 保留纯本地运维与环境说明
2. 其余系统级内容迁移到根 `docs/`

### `provider_service/docs/`

处理方式：

1. 目录改名为 `provider_service/docs/`
2. 只保留本地运维手册
3. 系统设计继续统一放根 `docs/provider_service/` 或未来 `docs/03_Projects/provider-service/`

## 8.4 Phase 4: 重构根 docs 信息架构

建议顺序：

1. 先增加 `03_Projects/`
2. 再把 `plan/` 重命名为 `09_Plans/`
3. 增加 `10_Archive/`
4. 再逐步把历史散落文件归档或归类

## 9. 执行优先级

## P0

1. 确认治理原则：根 `docs/` 为唯一真相中心
2. 统一项目内目录命名为 `docs/`
3. 盘点并冻结“哪些文档允许留在项目目录”

## P1

1. 建立 `docs/03_Projects/` 项目导航层
2. 给每个项目建立 README 导航页
3. 更新 `docs/README.md`，把项目维度加入主入口

## P2

1. 迁移 `admin/gateway-admin/docs/` 中系统级内容
2. 继续检查 `provider_service/docs/` 中是否还有可上提内容
3. 清理重复文档与旧路径引用

## P3

1. 增加 `08_ADR/`
2. 增加 `10_Archive/`
3. 清理历史失效目录和失效命名

## 10. 最终建议

### 最适合 Synapse 的答案不是二选一，而是：

1. **统一文档中心放根 `docs/`**
2. **每个项目只维护极少量贴身文档**

也就是：

**canonical 统一，执行说明贴身，历史方案归档。**

这样做的好处：

1. 新人知道去哪看真相
2. 项目负责人仍然能在子目录快速找到运行说明
3. 文档不会因为 monorepo 扩大而继续散成碎片
4. 后续新增项目时，只要复制“项目 README + agents + 根 docs/03_Projects 导航页”这套模板即可

## 11. 下一步建议

建议按下面顺序推进实际迁移：

1. 先创建 `docs/03_Projects/` 项目导航层
2. 再统一 `provider_service/doc -> provider_service/docs`
3. 再收敛 `admin/gateway-admin/docs/` 中非贴身文档到根 `docs/`
4. 最后更新 `docs/README.md`，让它同时支持“知识域阅读”和“项目维度阅读”两条入口