# Project Navigation

- Status: canonical
- Code paths: `gateway/`, `contracts/`, `apps/frontend/`, `admin/gateway-admin/`, `admin/admin-front/`, `provider_service/`, `sdk/python/`, `docker-compose/`, `scripts/`, `tools/`
- Last verified against code: 2026-03-25

本目录不是复制各项目自己的 `README.md`，而是给整个 Synapse 仓库提供一层稳定的“按项目阅读”入口。

它回答 6 个固定问题：

1. 这个项目在系统里的职责是什么
2. 代码在哪里
3. 它和哪些系统发生依赖
4. 项目内应该保留哪些贴身文档
5. 对应的 canonical 文档在根 `docs/` 的哪里
6. 新同学应该先读什么，再动什么

## 项目索引

1. [gateway](./gateway/README.md)
2. [contracts](./contracts/README.md)
3. [frontend](./frontend/README.md)
4. [gateway-admin](./gateway-admin/README.md)
5. [admin-front](./admin-front/README.md)
6. [provider-service](./provider-service/README.md)
7. [sdk-python](./sdk-python/README.md)
8. [infra](./infra/README.md)

## 使用规则

1. 先用本目录判断“要改哪一个项目”。
2. 再进入对应项目页，看职责边界、代码入口和关联文档。
3. 再进入对应项目页下的本地开发说明文档执行具体动作。
4. 项目目录里的 `README.md` 现在只作为入口壳，不再承载完整正文。
5. 如果任务是跨项目或多阶段修改，先创建 `docs/exec-plans/` 下的执行计划，再回到对应项目页实施。

## 边界说明

1. 项目级导航页负责职责、边界、链接聚合，并作为项目说明文档的统一入口。
2. API 契约、数据库设计、主流程、运维规则仍以根 `docs/` 中对应 canonical 文档为准。
3. 如果项目内 `README.md` 与本目录冲突，应优先修正根 `docs/03_Projects/` 中的 canonical 文档，再把本地 README 改回入口壳。