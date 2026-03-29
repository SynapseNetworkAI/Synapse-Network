# Documentation Inventory

## 1. Purpose

本文件是 Synapse 文档治理层的显式 inventory。

它解决四个问题：

1. 哪些文档属于高价值 root entrypoint、governance entrypoint 或 canonical truth
2. 每份关键文档对应哪个职责域负责复核
3. 最近一次 review / code verification 时间是什么时候
4. docs gate 应该对哪些文档执行 completeness 与 freshness 校验

## 2. Scope

这不是全仓 140+ Markdown 的平铺清单。

当前 inventory 主要覆盖五类文档：

1. root `docs/` 入口文件
2. governance 层强约束文档
3. official module `README.md` 入口
4. `docs/03_Projects/*/README.md` 项目入口页
5. 当前已经显式声明或实际承担 canonical truth 的核心文档

补充性专题、草案、legacy archive 和 completed execution plans 不要求全部进 inventory，除非它们升级为长期入口、项目导航入口或 canonical 语义源。

注意：不进 inventory 不代表可以没有治理。所有 `docs/**/README.md` 入口页即使不进入 inventory，也必须声明显式生命周期状态，避免深层目录重新长出无状态入口壳。

## 3. Review Rules

inventory 中每条记录都必须至少声明：

1. `path`
2. `tier`
3. `status`
4. `owner`
5. `lastReviewed`
6. `reviewCadenceDays`
7. `codePaths`
8. `validation`

当前 docs gate 会对 inventory 执行以下校验：

1. JSON 结构是否合法
2. path 是否存在且唯一
3. owner / tier / status 是否在允许集合内
4. root entrypoints、official module READMEs、project entrypoints 和显式 canonical 文档是否全部纳入 inventory
5. 文档头部若声明了 `Status` 或 `Last verified against code`，是否和 inventory 对齐
6. 非 `legacy` / `archive` 文档是否超过 review cadence

## 4. Maintenance Rule

当以下任一事项发生时，必须同步更新 inventory：

1. 新增 root entrypoint
2. 新增 governance hard rule
3. official module README 或 project entrypoint 发生新增、删除、改名
4. 某文档升级为 canonical
5. canonical 文档 owner 变化
6. canonical 文档完成新的 code verification

## 5. Machine Inventory

说明：下方 JSON block 是 docs gate 的唯一 machine-readable inventory source。修改字段时，必须同时更新 `scripts/validate_docs.js` 的校验规则。

<!-- docs-inventory:start -->
```json
[
  {
    "path": "docs/AGENTS.md",
    "tier": "root-entrypoint",
    "status": "canonical",
    "owner": "repo governance",
    "lastReviewed": "2026-03-29",
    "reviewCadenceDays": 30,
    "codePaths": [
      ".github/instructions",
      "apps/frontend/AGENTS.md",
      "admin/gateway-admin/AGENTS.md",
      "provider_service/AGENTS.md"
    ],
    "validation": ["npm run ci:docs"]
  },
  {
    "path": "docs/ARCHITECTURE.md",
    "tier": "root-entrypoint",
    "status": "canonical",
    "owner": "architecture",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 30,
    "codePaths": [
      "gateway",
      "admin/gateway-admin",
      "apps/frontend",
      "provider_service",
      "contracts",
      "sdk/python"
    ],
    "validation": ["npm run ci:docs"]
  },
  {
    "path": "docs/README.md",
    "tier": "root-entrypoint",
    "status": "canonical",
    "owner": "repo governance",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 14,
    "codePaths": [
      "docs",
      "llms.txt",
      "tools/scripts/validate_docs.js"
    ],
    "validation": ["npm run ci:docs"]
  },
  {
    "path": "docs/Harness_engineering.md",
    "tier": "root-entrypoint",
    "status": "canonical",
    "owner": "repo governance",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 30,
    "codePaths": [
      "docs",
      "llms.txt",
      "tools/scripts/validate_docs.js"
    ],
    "validation": ["npm run ci:docs"]
  },
  {
    "path": "docs/Design.md",
    "tier": "root-entrypoint",
    "status": "supplementary",
    "owner": "frontend/product",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 45,
    "codePaths": [
      "apps/frontend/src",
      "admin/admin-front/src"
    ],
    "validation": ["npm run ci:docs"]
  },
  {
    "path": "docs/文档迁移.md",
    "tier": "root-entrypoint",
    "status": "archive",
    "owner": "repo governance",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 180,
    "codePaths": [
      "docs",
      "llms.txt"
    ],
    "validation": ["npm run ci:docs"]
  },
  {
    "path": "docs/00_Governance/README.md",
    "tier": "governance-entrypoint",
    "status": "canonical",
    "owner": "repo governance",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 30,
    "codePaths": [
      "docs/00_Governance",
      "tools/scripts/validate_docs.js"
    ],
    "validation": ["npm run ci:docs"]
  },
  {
    "path": "docs/00_Governance/Documentation_Constraints.md",
    "tier": "governance-entrypoint",
    "status": "canonical",
    "owner": "repo governance",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 21,
    "codePaths": [
      "docs",
      "llms.txt",
      "tools/scripts/validate_docs.js"
    ],
    "validation": ["npm run ci:docs"]
  },
  {
    "path": "docs/00_Governance/Documentation_Lifecycle.md",
    "tier": "governance-entrypoint",
    "status": "canonical",
    "owner": "repo governance",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 21,
    "codePaths": [
      "docs",
      "tools/scripts/validate_docs.js"
    ],
    "validation": ["npm run ci:docs"]
  },
  {
    "path": "docs/00_Governance/Ownership_And_Review_Matrix.md",
    "tier": "governance-entrypoint",
    "status": "canonical",
    "owner": "repo governance",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 30,
    "codePaths": [
      ".github/instructions",
      "gateway",
      "admin/gateway-admin",
      "apps/frontend",
      "provider_service"
    ],
    "validation": ["npm run ci:docs"]
  },
  {
    "path": "docs/00_Governance/Drift_Checklist.md",
    "tier": "governance-entrypoint",
    "status": "canonical",
    "owner": "repo governance",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 21,
    "codePaths": [
      "package.json",
      "scripts",
      "gateway",
      "admin/gateway-admin",
      "apps/frontend",
      "provider_service",
      "sdk/python"
    ],
    "validation": ["npm run ci:docs"]
  },
  {
    "path": "docs/00_Governance/Documentation_Inventory.md",
    "tier": "governance-entrypoint",
    "status": "canonical",
    "owner": "repo governance",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 14,
    "codePaths": [
      "docs/00_Governance/Documentation_Inventory.md",
      "tools/scripts/validate_docs.js",
      "llms.txt"
    ],
    "validation": ["npm run ci:docs"]
  },
  {
    "path": "docs/exec-plans/README.md",
    "tier": "governance-entrypoint",
    "status": "canonical",
    "owner": "repo governance",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 30,
    "codePaths": [
      "docs/exec-plans",
      "tools/scripts/validate_docs.js"
    ],
    "validation": ["npm run ci:docs"]
  },
  {
    "path": "docs/03_Core_Workflows/README.md",
    "tier": "canonical-module",
    "status": "canonical",
    "owner": "runtime/backend",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 30,
    "codePaths": [
      "gateway/src",
      "contracts",
      "admin/gateway-admin/src",
      "docker-compose/postgres/init/gateway/001_synapse_schema.sql"
    ],
    "validation": ["npm run ci:docs", "npm run ci:gateway", "npm run ci:admin-gateway"]
  },
  {
    "path": "docs/03_Projects/README.md",
    "tier": "canonical-module",
    "status": "canonical",
    "owner": "repo governance",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 30,
    "codePaths": [
      "docs/03_Projects",
      "gateway",
      "contracts",
      "apps/frontend",
      "admin/gateway-admin",
      "admin/admin-front",
      "provider_service",
      "sdk/python",
      "docker-compose",
      "scripts",
      "tools"
    ],
    "validation": ["npm run ci:docs"]
  },
  {
    "path": "docs/01_Product_Frontend/README.md",
    "tier": "canonical-module",
    "status": "canonical",
    "owner": "frontend/product",
    "lastReviewed": "2026-03-24",
    "reviewCadenceDays": 30,
    "codePaths": [
      "apps/frontend/src",
      "admin/admin-front/src",
      "docs/feature_designs/frontend_product"
    ],
    "validation": ["npm run ci:docs", "npm run ci:frontend", "npm run ci:admin-front"]
  },
  {
    "path": "docs/02_System_Architecture/README.md",
    "tier": "canonical-module",
    "status": "canonical",
    "owner": "architecture",
    "lastReviewed": "2026-03-24",
    "reviewCadenceDays": 30,
    "codePaths": [
      "gateway",
      "admin/gateway-admin",
      "apps/frontend",
      "provider_service",
      "contracts"
    ],
    "validation": ["npm run ci:docs"]
  },
  {
    "path": "docs/02_System_Architecture/02_Gateway_Runtime_Architecture.md",
    "tier": "canonical-module",
    "status": "canonical",
    "owner": "architecture",
    "lastReviewed": "2026-03-24",
    "reviewCadenceDays": 30,
    "codePaths": [
      "gateway/src",
      "sdk/python",
      "apps/frontend/src"
    ],
    "validation": ["npm run ci:docs", "npm run ci:gateway"]
  },
  {
    "path": "docs/02_System_Architecture/03_Identity_Authentication_and_Risk_Control.md",
    "tier": "canonical-module",
    "status": "canonical",
    "owner": "runtime/backend",
    "lastReviewed": "2026-03-24",
    "reviewCadenceDays": 30,
    "codePaths": [
      "gateway/src",
      "sdk/python",
      "apps/frontend/src"
    ],
    "validation": ["npm run ci:docs", "npm run ci:gateway"]
  },
  {
    "path": "docs/03_Core_Workflows/02_Discovery_and_Gateway_Call.md",
    "tier": "canonical-module",
    "status": "canonical",
    "owner": "runtime/backend",
    "lastReviewed": "2026-03-24",
    "reviewCadenceDays": 30,
    "codePaths": [
      "gateway/src/api",
      "sdk/python",
      "apps/frontend/src"
    ],
    "validation": ["npm run ci:docs", "npm run ci:gateway", "npm run ci:sdk-python"]
  },
  {
    "path": "docs/04_Database_Design/README.md",
    "tier": "canonical-module",
    "status": "canonical",
    "owner": "finance/backend",
    "lastReviewed": "2026-03-24",
    "reviewCadenceDays": 30,
    "codePaths": [
      "gateway/src/storage",
      "admin/gateway-admin/src/storage",
      "docker-compose/postgres/init/gateway/001_synapse_schema.sql"
    ],
    "validation": ["npm run ci:docs", "npm run ci:gateway", "npm run ci:admin-gateway"]
  },
  {
    "path": "docs/04_Database_Design/01_SQL_Schema_Overview.md",
    "tier": "canonical-module",
    "status": "canonical",
    "owner": "finance/backend",
    "lastReviewed": "2026-03-24",
    "reviewCadenceDays": 30,
    "codePaths": [
      "gateway/src/storage",
      "admin/gateway-admin/src/storage",
      "docker-compose/postgres/init/gateway/001_synapse_schema.sql"
    ],
    "validation": ["npm run ci:docs", "npm run ci:gateway", "npm run ci:admin-gateway"]
  },
  {
    "path": "docs/05_DevOps_Deployment/03_Observability_Logging_and_Indexer_Operations.md",
    "tier": "canonical-module",
    "status": "canonical",
    "owner": "devops",
    "lastReviewed": "2026-03-24",
    "reviewCadenceDays": 30,
    "codePaths": [
      "scripts",
      "tools/scripts",
      "docker-compose"
    ],
    "validation": ["npm run ci:docs"]
  },
  {
    "path": "docs/05_DevOps_Deployment/README.md",
    "tier": "canonical-module",
    "status": "canonical",
    "owner": "devops",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 30,
    "codePaths": [
      "docker-compose",
      "scripts",
      "tools",
      "package.json"
    ],
    "validation": ["npm run ci:docs"]
  },
  {
    "path": "docs/06_Reference/README.md",
    "tier": "canonical-module",
    "status": "canonical",
    "owner": "runtime/backend + sdk",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 30,
    "codePaths": [
      "gateway/src/api",
      "sdk/python",
      "provider_service",
      "docs/06_Reference"
    ],
    "validation": ["npm run ci:docs", "npm run ci:gateway", "npm run ci:sdk-python"]
  },
  {
    "path": "docs/06_Reference/03_Service_Manifest_and_Runtime_Object_Reference.md",
    "tier": "canonical-module",
    "status": "canonical",
    "owner": "runtime/backend + sdk",
    "lastReviewed": "2026-03-24",
    "reviewCadenceDays": 30,
    "codePaths": [
      "gateway/src/domain",
      "gateway/src/services/provider",
      "sdk/python"
    ],
    "validation": ["npm run ci:docs", "npm run ci:gateway", "npm run ci:sdk-python"]
  },
  {
    "path": "docs/06_Reference/04_Development_Testing_and_Integration_Reference.md",
    "tier": "canonical-module",
    "status": "canonical",
    "owner": "runtime/backend",
    "lastReviewed": "2026-03-24",
    "reviewCadenceDays": 30,
    "codePaths": [
      "gateway/tests",
      "provider_service/tests",
      "sdk/python",
      "package.json"
    ],
    "validation": ["npm run ci:docs", "npm run ci:pr"]
  },
  {
    "path": "docs/06_Reference/05_Runtime_API_Contract.md",
    "tier": "canonical-module",
    "status": "canonical",
    "owner": "runtime/backend + sdk",
    "lastReviewed": "2026-03-24",
    "reviewCadenceDays": 30,
    "codePaths": [
      "gateway/src/api",
      "sdk/python",
      "apps/frontend/src"
    ],
    "validation": ["npm run ci:docs", "npm run ci:gateway", "npm run ci:sdk-python"]
  },
  {
    "path": "docs/06_Reference/06_Runtime_Error_Code_Catalog.md",
    "tier": "canonical-module",
    "status": "canonical",
    "owner": "runtime/backend",
    "lastReviewed": "2026-03-24",
    "reviewCadenceDays": 30,
    "codePaths": [
      "gateway/src/api",
      "gateway/src/services",
      "gateway/tests"
    ],
    "validation": ["npm run ci:docs", "npm run ci:gateway"]
  },
  {
    "path": "docs/06_Reference/Validation_Entry_Points.md",
    "tier": "governance-entrypoint",
    "status": "canonical",
    "owner": "devops",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 21,
    "codePaths": [
      "package.json",
      "scripts",
      "apps/frontend/package.json",
      "admin/admin-front/package.json",
      "provider_service/AGENTS.md"
    ],
    "validation": ["npm run ci:docs"]
  },
  {
    "path": "docs/admin/Admin_Approval_Workflow.md",
    "tier": "canonical-module",
    "status": "canonical",
    "owner": "admin control plane",
    "lastReviewed": "2026-03-24",
    "reviewCadenceDays": 30,
    "codePaths": [
      "admin/gateway-admin/src",
      "admin/admin-front/src"
    ],
    "validation": ["npm run ci:docs", "npm run ci:admin-gateway", "npm run ci:admin-front"]
  },
  {
    "path": "docs/admin/Admin_Funds_Observability_Metrics_Design.md",
    "tier": "canonical-module",
    "status": "canonical",
    "owner": "admin control plane",
    "lastReviewed": "2026-03-24",
    "reviewCadenceDays": 30,
    "codePaths": [
      "admin/gateway-admin/src",
      "admin/admin-front/src",
      "gateway/src"
    ],
    "validation": ["npm run ci:docs", "npm run ci:admin-gateway", "npm run ci:admin-front"]
  },
  {
    "path": "docs/admin/README.md",
    "tier": "canonical-module",
    "status": "canonical",
    "owner": "admin control plane",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 30,
    "codePaths": [
      "docs/admin",
      "admin/gateway-admin/src",
      "admin/admin-front/src"
    ],
    "validation": ["npm run ci:docs", "npm run ci:admin-gateway", "npm run ci:admin-front"]
  },
  {
    "path": "docs/03_Projects/gateway/README.md",
    "tier": "project-entrypoint",
    "status": "canonical",
    "owner": "runtime/backend",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 30,
    "codePaths": [
      "gateway",
      "docs/03_Projects/gateway"
    ],
    "validation": ["npm run ci:docs", "npm run ci:gateway"]
  },
  {
    "path": "docs/03_Projects/contracts/README.md",
    "tier": "project-entrypoint",
    "status": "canonical",
    "owner": "finance/backend",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 30,
    "codePaths": [
      "contracts",
      "docs/03_Projects/contracts",
      "hardhat.config.js"
    ],
    "validation": ["npm run ci:docs", "npm run ci:contracts"]
  },
  {
    "path": "docs/03_Projects/frontend/README.md",
    "tier": "project-entrypoint",
    "status": "canonical",
    "owner": "frontend/product",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 30,
    "codePaths": [
      "apps/frontend",
      "docs/03_Projects/frontend"
    ],
    "validation": ["npm run ci:docs", "npm run ci:frontend"]
  },
  {
    "path": "docs/03_Projects/gateway-admin/README.md",
    "tier": "project-entrypoint",
    "status": "canonical",
    "owner": "admin control plane",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 30,
    "codePaths": [
      "admin/gateway-admin",
      "docs/03_Projects/gateway-admin"
    ],
    "validation": ["npm run ci:docs", "npm run ci:admin-gateway"]
  },
  {
    "path": "docs/03_Projects/admin-front/README.md",
    "tier": "project-entrypoint",
    "status": "canonical",
    "owner": "admin control plane",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 30,
    "codePaths": [
      "admin/admin-front",
      "docs/03_Projects/admin-front"
    ],
    "validation": ["npm run ci:docs", "npm run ci:admin-front"]
  },
  {
    "path": "docs/03_Projects/provider-service/README.md",
    "tier": "project-entrypoint",
    "status": "canonical",
    "owner": "runtime/backend",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 21,
    "codePaths": [
      "provider_service",
      "docs/03_Projects/provider-service",
      "docs/provider_service"
    ],
    "validation": ["npm run ci:docs", "npm run ci:provider-service"]
  },
  {
    "path": "docs/03_Projects/sdk-python/README.md",
    "tier": "project-entrypoint",
    "status": "canonical",
    "owner": "runtime/backend + sdk",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 30,
    "codePaths": [
      "sdk/python",
      "docs/03_Projects/sdk-python",
      "docs/sdk"
    ],
    "validation": ["npm run ci:docs", "npm run ci:sdk-python"]
  },
  {
    "path": "docs/03_Projects/infra/README.md",
    "tier": "project-entrypoint",
    "status": "canonical",
    "owner": "devops",
    "lastReviewed": "2026-03-25",
    "reviewCadenceDays": 30,
    "codePaths": [
      "docker-compose",
      "scripts",
      "tools",
      "docs/03_Projects/infra"
    ],
    "validation": ["npm run ci:docs"]
  }
]
```
<!-- docs-inventory:end -->
