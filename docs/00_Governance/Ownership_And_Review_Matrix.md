# Ownership And Review Matrix

## 1. Purpose

本文件定义：

1. 哪类主题的 canonical 文档落在哪一层
2. 修改该主题时，至少要检查哪些代码与数据库真理源
3. 应由哪类维护责任人复核

这里的 owner 指职责域，不要求和 GitHub CODEOWNERS 完全同名。

## 2. Matrix

| 主题 | Canonical 目录 | 必查代码路径 | 必查 DB / 结构真理源 | 责任域 |
| --- | --- | --- | --- | --- |
| 仓库级规则、文档治理 | `docs/AGENTS.md`, `docs/00_Governance/` | `.github/instructions/`, project `AGENTS.md` | 无 | repo governance |
| 顶层系统边界 | `docs/ARCHITECTURE.md`, `docs/02_System_Architecture/` | `gateway/`, `admin/gateway-admin/`, `apps/frontend/`, `provider_service/` | `docker-compose/postgres/init/gateway/001_synapse_schema.sql` | architecture |
| Agent runtime 身份与控制链路 | `docs/02_System_Architecture/` | `gateway/src/`, `sdk/python/`, `apps/frontend/src/` | `001_synapse_schema.sql` | runtime/backend |
| discover / quote / invoke 协议 | `docs/03_Core_Workflows/`, `docs/06_Reference/` | `gateway/src/api/`, `sdk/python/`, `apps/frontend/src/utils/` | `001_synapse_schema.sql`, gateway tests | runtime/backend |
| Service manifest / SDK / agent-facing contract | `docs/06_Reference/` | `gateway/src/domain/`, `gateway/src/services/provider/`, `sdk/python/` | `001_synapse_schema.sql` | runtime/backend + sdk |
| Owner 入金、结算、审计、提现 | `docs/03_Core_Workflows/`, `docs/04_Database_Design/` | `gateway/src/services/owner/`, `gateway/src/services/platform/`, `contracts/` | `001_synapse_schema.sql`, contract deployment / migrations | finance/backend |
| 数据模型、账本、一致性 | `docs/04_Database_Design/` | `gateway/src/storage/`, `admin/gateway-admin/src/storage/` | `001_synapse_schema.sql`, admin migrations | finance/backend |
| 本地环境、CI/CD、运维 | `docs/05_DevOps_Deployment/` | `tools/scripts/`, `scripts/`, `package.json` | runtime scripts and compose files | devops |
| 项目边界、本地开发、项目规则 | `docs/03_Projects/` | target project directory | target project commands / env files | project maintainers |
| Admin control plane 设计 | `docs/admin/` | `admin/gateway-admin/src/`, `admin/admin-front/src/` | admin migrations / projection views | admin control plane |
| 前端 IA、设计系统、体验原则 | `docs/01_Product_Frontend/` | `apps/frontend/src/`, `admin/admin-front/src/` | 无 | frontend/product |
| 孵化专题设计 | `docs/feature_designs/` | target implementation path | target implementation path | feature owner |

## 3. Review Minimums

不同主题变更时，最低复核要求如下：

1. API / 协议变更：代码 + tests + `06_Reference/` + `03_Core_Workflows/`
2. DB / 账本变更：SQL / migration + `04_Database_Design/` + 受影响流程文档
3. Admin 语义变更：`docs/admin/` + `docs/03_Projects/gateway-admin/` + admin tests
4. 前端 IA 变更：`01_Product_Frontend/` + 受影响项目页 + adapter / service expectations
5. 文档结构变更：`docs/README.md` + `llms.txt` + 受影响入口页

## 4. Former Agent Layer Migration Rule

former `docs/agent/` 的迁移执行由以下责任域共同复核：

1. `02_System_Architecture/` 归口内容：architecture
2. `03_Core_Workflows/` 归口内容：runtime/backend
3. `04_Database_Design/` 归口内容：finance/backend
4. `06_Reference/` 归口内容：runtime/backend + sdk

任何 former `docs/agent/*.md` 的拆分迁移，至少要同时检查：

1. `docs/README.md`
2. `llms.txt`
3. `docs/03_Projects/gateway/README.md`
4. 目标模块 README