# Synapse Project Docs Centralization And Merge Plan

## 1. 背景

在前一轮整理中，仓库已经建立了两层结构：

1. 根 `docs/` 作为主要知识库。
2. 项目目录内只保留少量贴身文档。

这个模型适合第一阶段止血，但用户现在的目标已经更明确：**把项目中的文档统一迁入根 `docs/` 集中维护**。

因此，这份方案对 [2026-03-23_Documentation_Architecture_and_Migration_Plan.md](./2026-03-23_Documentation_Architecture_and_Migration_Plan.md) 做进一步收敛：

1. 项目文档的 canonical 内容统一进入根 `docs/`。
2. 项目目录不再承载完整文档，只保留最小入口壳文件。
3. `docs/03_Projects/` 从“导航层”升级为“项目文档集中维护层”。

## 2. 目标结论

## 2.0 当前执行进度

截至 2026-03-23，本方案的执行状态如下：

1. 批次 A 已完成：7 个项目 `README.md` 正文已迁入 `docs/03_Projects/<project>/*_Local_Development.md`，项目目录内 `README.md` 已收缩为入口壳。
2. 批次 B 已完成：`provider_service/docs/` 的 Markdown 正文已迁入 `docs/03_Projects/provider-service/`，并补齐了 `provider_service/agents.md` 本地执行镜像。
3. 批次 C 已完成：`admin/gateway-admin/docs/` 的 Markdown 正文已迁入 `docs/03_Projects/gateway-admin/`，并补齐了 root canonical 运维、环境变量、systemd 与 agent 规则文档。
4. 批次 D 已完成：`provider_service`、`gateway-admin`、`apps/frontend`、`admin/admin-front` 已建立 “root canonical + 本地执行镜像” 双轨结构。
5. 批次 E 已完成：`gateway-providers` init 说明已上提到根 `docs/03_Projects/infra/`，`admin/README.md` 已收缩为工作区入口壳。
6. 最终例外项已确认：`gateway/` 与 `contracts/` 暂不新增独立 `agents.md`，因为当前没有足够稳定、值得单独维护的 project-level rules。
7. 当前状态可以视为：**迁移已基本完成，仅保留例外项说明与后续增量维护。**

### 2.1 最终治理原则

后续项目文档统一遵循 4 条规则：

1. **所有项目级说明文档统一维护在根 `docs/`。**
2. **`docs/03_Projects/<project>/` 成为每个代码项目的集中目录。**
3. **项目目录下的 `README.md` 只保留跳转入口，不再放完整说明。**
4. **项目目录下的 `agents.md` 视为执行型配置文件，短期保留本地副本，但 canonical 文本迁入根 `docs/`。**

### 2.2 什么属于“要迁入 `docs/` 的项目文档”

以下内容都纳入集中迁移范围：

1. 项目本地开发说明。
2. 项目运行、测试、调试、联调说明。
3. 项目运维手册、环境变量说明、部署样例。
4. 项目 AI 编码规则、文档同步规则、测试约束。

### 2.3 什么不属于这次迁移的重点

以下内容不做“全文搬迁”，只做边界修正：

1. 根 `docs/agents.md`，它继续作为仓库级规则入口。
2. 根 `docs/admin/`、`docs/provider_service/`、`docs/sdk/` 这类系统专题文档，它们本来就已经在根 `docs/`。
3. SQL、脚本、配置样例这类可执行文件，它们继续留在代码目录，只在根 `docs/` 写说明与入口。

## 3. 目标目录结构

## 3.1 项目文档统一落位

后续项目文档统一收敛到如下结构：

```text
docs/
└── 03_Projects/
    ├── gateway/
    │   ├── README.md
    │   └── Gateway_Local_Development.md
    ├── contracts/
    │   ├── README.md
    │   └── Contracts_Local_Development.md
    ├── frontend/
    │   ├── README.md
    │   ├── Frontend_Local_Development.md
    │   └── Frontend_Agent_Rules.md
    ├── gateway-admin/
    │   ├── README.md
    │   ├── Gateway_Admin_Local_Development.md
    │   ├── Gateway_Admin_Agent_Rules.md
    │   ├── Gateway_Admin_Operations_Runbook.md
    │   ├── Gateway_Admin_Environment_Variables.md
    │   └── Gateway_Admin_Systemd_Deployment_Example.md
    ├── admin-front/
    │   ├── README.md
    │   ├── Admin_Front_Local_Development.md
    │   └── Admin_Front_Agent_Rules.md
    ├── provider-service/
    │   ├── README.md
    │   ├── Provider_Service_Local_Development.md
    │   ├── Provider_Service_Agent_Rules.md
    │   └── Provider_Service_Operations_Runbook.md
    ├── sdk-python/
    │   ├── README.md
    │   └── SDK_Python_Local_Development.md
    └── infra/
        ├── README.md
        └── Postgres_Init_Gateway_Providers_Notes.md
```

## 3.2 三类文档职责边界

### A. `docs/03_Projects/<project>/`

承载某个代码项目自己的集中说明：

1. 本地启动。
2. 测试命令。
3. 目录结构入口。
4. 项目级运维与联调说明。
5. 项目级 `agents` 规则的 canonical 版本。

### B. 根 `docs/` 其他模块

继续承载跨项目 canonical 文档：

1. `docs/admin/` 承载后台系统设计，不承载局部启动说明。
2. `docs/provider_service/` 承载 Provider 体系设计，不承载某次本地运行指令。
3. `docs/05_DevOps_Deployment/` 承载跨项目运维策略、部署规范、事故处理。

### C. 项目目录本地文件

迁移后只保留：

1. `README.md` 入口壳文件。
2. `agents.md` 执行型镜像文件。
3. 必须与代码同目录存在的脚本、配置、样例文件。

## 4. 当前需迁移清单

## 4.1 第一组: 项目 README

| 当前路径 | 目标路径 | 动作 |
| --- | --- | --- |
| `gateway/README.md` | `docs/03_Projects/gateway/Gateway_Local_Development.md` | 迁移正文，原地保留跳转壳 |
| `contracts/README.md` | `docs/03_Projects/contracts/Contracts_Local_Development.md` | 迁移正文，原地保留跳转壳 |
| `apps/frontend/README.md` | `docs/03_Projects/frontend/Frontend_Local_Development.md` | 迁移正文，原地保留跳转壳 |
| `admin/admin-front/README.md` | `docs/03_Projects/admin-front/Admin_Front_Local_Development.md` | 迁移正文，原地保留跳转壳 |
| `admin/gateway-admin/README.md` | `docs/03_Projects/gateway-admin/Gateway_Admin_Local_Development.md` | 迁移正文，原地保留跳转壳 |
| `provider_service/README.md` | `docs/03_Projects/provider-service/Provider_Service_Local_Development.md` | 迁移正文，原地保留跳转壳 |
| `sdk/python/README.md` | `docs/03_Projects/sdk-python/SDK_Python_Local_Development.md` | 迁移正文，原地保留跳转壳 |

## 4.2 第二组: 项目 agents 规则

| 当前路径 | 目标路径 | 动作 |
| --- | --- | --- |
| `apps/frontend/agents.md` | `docs/03_Projects/frontend/Frontend_Agent_Rules.md` | 迁移 canonical 文本，本地保留执行镜像 |
| `admin/admin-front/agents.md` | `docs/03_Projects/admin-front/Admin_Front_Agent_Rules.md` | 迁移 canonical 文本，本地保留执行镜像 |
| `admin/gateway-admin/agents.md` | `docs/03_Projects/gateway-admin/Gateway_Admin_Agent_Rules.md` | 迁移 canonical 文本，本地保留执行镜像 |
| `provider_service/docs/agents.md` | `docs/03_Projects/provider-service/Provider_Service_Agent_Rules.md` | 迁移 canonical 文本，删除项目内 `docs/agents.md` |

说明：

1. `agents.md` 不是普通文档，它会直接影响 Agent 行为。
2. 因此不能一步到位删掉本地 `agents.md`，否则工具发现链会退化。
3. 推荐做法是先把规范正文上提到根 `docs/03_Projects/`，然后让本地 `agents.md` 保留精简镜像与跳转说明。

## 4.3 第三组: 项目运行与运维文档

| 当前路径 | 目标路径 | 动作 |
| --- | --- | --- |
| `provider_service/docs/Operations-Runbook.md` | `docs/03_Projects/provider-service/Provider_Service_Operations_Runbook.md` | 迁移正文，原地删除 |
| `provider_service/docs/README.md` | 合并进 `docs/03_Projects/provider-service/README.md` | 删除项目内目录索引 |
| `admin/gateway-admin/docs/运维手册.md` | `docs/03_Projects/gateway-admin/Gateway_Admin_Operations_Runbook.md` | 迁移正文，原地删除 |
| `admin/gateway-admin/docs/环境变量配置说明.md` | `docs/03_Projects/gateway-admin/Gateway_Admin_Environment_Variables.md` | 迁移正文，原地删除 |
| `admin/gateway-admin/docs/systemd生产部署示例.md` | `docs/03_Projects/gateway-admin/Gateway_Admin_Systemd_Deployment_Example.md` | 迁移正文，原地删除 |
| `admin/gateway-admin/docs/README.md` | 合并进 `docs/03_Projects/gateway-admin/README.md` | 删除项目内目录索引 |

## 4.4 第四组: 基础设施局部 README

| 当前路径 | 目标路径 | 动作 |
| --- | --- | --- |
| `docker-compose/postgres/init/gateway-providers/README.md` | `docs/03_Projects/infra/Postgres_Init_Gateway_Providers_Notes.md` | 迁移正文，原地保留简短说明或删除 |
| `admin/README.md` | 内容拆分进 `docs/admin/README.md` 与 `docs/03_Projects/README.md` | 原地改为导航壳 |

## 5. 迁移后本地目录保留策略

## 5.1 README 策略

项目目录下的 `README.md` 迁移后统一改成 3 段式短文件：

1. 这个目录的职责一句话说明。
2. canonical 文档入口链接。
3. 常用启动/测试命令的一行索引。

要求：

1. 不再维护长篇正文。
2. 不再重复粘贴系统设计、字段解释、流程定义。

## 5.2 agents 策略

项目目录下的 `agents.md` 迁移后采用“双轨”策略：

1. 根 `docs/03_Projects/<project>/...Agent_Rules.md` 作为 canonical 文本。
2. 本地 `agents.md` 保留可执行版镜像，内容尽量压缩，但不能缺失关键硬规则。

原因：

1. 很多 Agent 工具优先发现项目目录里的 `agents.md`。
2. 如果本地只留一行跳转，AI 很可能不会自动补读根文档。
3. 所以 `agents.md` 在工程上更接近“执行配置”，不能按普通 README 同样处理。

## 5.3 项目内 `docs/` 目录策略

完成迁移后，项目内 `docs/` 目录按以下规则收敛：

1. `provider_service/docs/` 目标是清空并删除。
2. `admin/gateway-admin/docs/` 目标是清空并删除。
3. 后续新项目默认不再创建项目内 `docs/` 目录，统一进入根 `docs/03_Projects/`。

## 6. 合并与去重规则

## 6.1 合并优先级

同一主题出现多个版本时，统一按以下顺序收敛：

1. 根 `docs/` 中已存在的系统级文档优先。
2. 项目内文档只保留项目运行、启动、部署、调试细节。
3. 如果项目内文档包含系统定义内容，迁移时拆分并并入现有 root canonical 文档。

## 6.2 命名规则

根 `docs/03_Projects/` 下统一使用英文文件名，保持可搜索和稳定链接：

1. `README.md` 作为项目索引。
2. `*_Local_Development.md` 对应原项目 README 主体。
3. `*_Agent_Rules.md` 对应项目 AI/工程规则。
4. `*_Operations_Runbook.md` 对应运行与排障。
5. `*_Environment_Variables.md` 对应环境变量说明。
6. `*_Systemd_Deployment_Example.md` 对应部署样例。

## 6.3 链接修复规则

每一批迁移都必须同步做 3 件事：

1. 修复根 `docs/` 内部链接。
2. 修复项目 README、脚本注释中的路径引用。
3. 全仓搜索旧路径，确认没有残留引用。

## 7. 推荐执行批次

## 批次 A: 先迁移风险最低的 README

范围：

1. `gateway/README.md`
2. `contracts/README.md`
3. `provider_service/README.md`
4. `sdk/python/README.md`
5. `apps/frontend/README.md`
6. `admin/admin-front/README.md`
7. `admin/gateway-admin/README.md`

原因：

1. 风险低。
2. 便于先建立统一模板。
3. 可以快速把 `docs/03_Projects/` 从导航层升级为正文层。

当前状态：已完成。

## 批次 B: 迁移 `provider_service/docs/`

范围：

1. `provider_service/docs/Operations-Runbook.md`
2. `provider_service/docs/README.md`
3. `provider_service/docs/agents.md`

目标：

1. 完整清空 `provider_service/docs/`。
2. 保留 `provider_service/README.md` 跳转壳。

当前状态：已完成。

## 批次 C: 迁移 `admin/gateway-admin/docs/`

范围：

1. `admin/gateway-admin/docs/运维手册.md`
2. `admin/gateway-admin/docs/环境变量配置说明.md`
3. `admin/gateway-admin/docs/systemd生产部署示例.md`
4. `admin/gateway-admin/docs/README.md`
5. `admin/gateway-admin/agents.md`

目标：

1. 完整清空 `admin/gateway-admin/docs/`。
2. 把 `gateway-admin` 的项目文档全部集中到根 `docs/03_Projects/gateway-admin/`。

当前状态：已完成。

## 批次 D: 收敛 agents 双轨策略

范围：

1. `apps/frontend/agents.md`
2. `admin/admin-front/agents.md`
3. `admin/gateway-admin/agents.md`
4. 项目化后的 `provider_service` 本地 `agents.md`

目标：

1. 为每个项目建立根 `docs` canonical 版本。
2. 本地 `agents.md` 压缩为执行镜像。
3. 建立“修改时双处同步”的明确规则。

当前状态：已完成。

已完成：

1. `provider_service/agents.md`
2. `admin/gateway-admin/agents.md` 建立 root canonical 链接
3. `apps/frontend/agents.md`
4. `admin/admin-front/agents.md`
5. 已明确决定 `gateway/` 与 `contracts/` 不新增独立 `agents.md`

## 批次 E: 基础设施与目录收尾

范围：

1. `docker-compose/postgres/init/gateway-providers/README.md`
2. `admin/README.md`
3. `docs/README.md`
4. `docs/03_Projects/README.md`

目标：

1. 补齐 infra 与 admin 入口。
2. 让根 `docs/README.md` 直接反映最终结构。

当前状态：已完成。

已完成：

1. `docker-compose/postgres/init/gateway-providers/README.md` canonical 内容已迁入 `docs/03_Projects/infra/Postgres_Init_Gateway_Providers_Notes.md`
2. `admin/README.md` 已改为入口壳
3. `docs/README.md` 与 `docs/03_Projects/README.md` 已按当前结构完成索引收口

## 8. 执行完成后的状态定义

当满足以下条件时，认为“项目文档已统一迁入根 `docs/`”完成：

1. 所有项目长文档都能在 `docs/03_Projects/` 找到 canonical 版本。
2. `provider_service/docs/` 与 `admin/gateway-admin/docs/` 已删除。
3. 项目目录里的 `README.md` 全部缩成跳转壳。
4. 项目目录里的 `agents.md` 都有对应 root canonical 文本。
5. 仓库搜索不再出现旧项目文档路径的正文型引用。

补充说明：

这里的第 4 条不表示“每个项目都必须有 `agents.md`”。最终标准是：

1. 需要稳定 project-level rules 的项目，必须有 `root canonical + 本地执行镜像`。
2. 不需要独立规则的项目，可以明确作为例外项，不强行新增空 `agents.md`。

## 9. 下一步建议

当前这份方案的主体迁移已经基本落地，后续不再有新的强制迁移批次。

后续只保留两类增量维护动作：

1. 后续新增项目时，直接复用当前已经成型的模式：
    - 根 `docs/03_Projects/<project>/` 维护 canonical 本地说明与 project rules
    - 项目目录 `README.md` 保留入口壳
    - 项目目录 `agents.md` 只在确实存在稳定规则时保留执行镜像
2. 当已有项目出现新的长期稳定 project-level rules 时，再补对应 `*_Agent_Rules.md` 与本地镜像；否则维持当前例外项，不为形式统一制造空规则文件。