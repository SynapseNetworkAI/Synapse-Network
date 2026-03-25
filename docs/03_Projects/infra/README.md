# infra

- Status: canonical
- Code paths: `docker-compose/`, `scripts/`, `tools/`, `docs/03_Projects/infra/`
- Verified with: `npm run ci:contracts`, `npm run ci:gateway`, `npm run ci:provider-service`, `npm run ci:docs`
- Last verified against code: 2026-03-25

## 1. 项目定位

`infra` 不是单一代码目录，而是对 Synapse 基础设施支撑层的项目导航聚合。

它覆盖：

1. `docker-compose/`
2. `scripts/`
3. `tools/`

它们共同负责：

1. 本地环境编排
2. PostgreSQL 初始化与 bootstrap
3. 开发、联调、重启、停止等运维脚本
4. 支撑 Gateway、Admin、Provider、SDK 的开发运行底座

## 2. 代码位置

- 编排目录：`docker-compose/`
- 初始化 SQL 与脚本：`docker-compose/postgres/init/`
- 本地与运维脚本：`scripts/`
- 辅助脚本：`tools/`

## 3. 当前结构重点

PostgreSQL 初始化已经按职责拆分为：

1. `docker-compose/postgres/init/gateway/`
2. `docker-compose/postgres/init/gateway-admin/`
3. `docker-compose/postgres/init/gateway-providers/`
4. 顶层调度脚本：`docker-compose/postgres/init/000_run_init_tree.sh`

## 4. 职责边界

`infra` 应该承担：

1. 基础环境拉起与关闭
2. 数据库初始化、迁移、投影视图 bootstrap
3. 本地开发与测试的统一脚本入口

`infra` 不应该承担：

1. 业务协议真相定义
2. 页面产品设计
3. SDK 客户端逻辑
4. Provider 业务实现本体

## 5. 直接依赖关系

1. 为 `gateway/`、`gateway-admin/`、`provider_service/`、前端和 SDK 提供本地运行底座
2. 与根 `docs/05_DevOps_Deployment/`、`docs/04_Database_Design/` 强关联

## 6. Canonical 文档入口

1. `docs/05_DevOps_Deployment/README.md`
2. `docs/05_DevOps_Deployment/01_Local_Environment_and_Runtime_Setup.md`
3. `docs/05_DevOps_Deployment/02_CI_CD_and_Release_Gates.md`
4. `docs/04_Database_Design/README.md`
5. `docs/admin/Admin_PostgreSQL_Deployment_Design.md`

## 7. 项目内贴身文档原则

`docker-compose/`、`scripts/`、`tools/` 原则上不再扩出复杂 docs 体系。

如果必须补充说明，优先写回根 `docs/05_DevOps_Deployment/`，只在目录内保留极少量直接执行型说明。

当前根 `docs/03_Projects/infra/` 已集中维护：

1. [Postgres_Init_Gateway_Providers_Notes.md](./Postgres_Init_Gateway_Providers_Notes.md)