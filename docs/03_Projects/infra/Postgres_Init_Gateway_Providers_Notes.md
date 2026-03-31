# Postgres Init Gateway Providers Notes

`docker-compose/postgres/init/gateway-providers/` 用于独立 provider-side PostgreSQL bootstrap 脚本。

当前仓库里的 PostgreSQL 初始化仍以 `gateway` 和 `gateway-admin` 两组数据库对象为主，但 `provider_service` 的 Web3 sentiment runtime 现在已经切到独立数据库 `synapse_gateway_providers`。

当前已纳入部署链路的 provider-side 对象：

1. 数据库：`synapse_gateway_providers`
2. app role：`synapse_provider_app`
3. readonly role：`synapse_provider_ro`
4. 表：`provider_sentiment_snapshots`
5. 表：`provider_sentiment_raw_feeds`
6. 表：`provider_api_invocations`
7. 表：`provider_protocol_briefs`
8. 表：`provider_protocol_brief_raw_feeds`
9. 表：`provider_contract_audit_reports`
10. 表：`provider_whale_flow_snapshots`
11. 表：`provider_oss_security_reports`
12. 表：`provider_twitter_video_assets`
13. 表：`provider_youtube_video_assets`
14. 表：`provider_tiktok_video_assets`
15. 表：`provider_reddit_media_assets`

对应执行入口：

1. `docker-compose/postgres/init/gateway-providers/000_create_provider_database_and_roles.sh`
2. `docker-compose/postgres/init/gateway-providers/001_provider_schema.sql`
3. `docker-compose/postgres/init/gateway-providers/001_apply_provider_schema.sh`

`001_provider_schema.sql` 现在是 provider-side PostgreSQL 的唯一权威 schema，直接包含所有当前表的最终形态，不再追加零碎 upgrade SQL。

## 相关目录

1. `docker-compose/postgres/init/gateway/`
2. `docker-compose/postgres/init/gateway-admin/`
3. `docker-compose/postgres/init/gateway-providers/`
4. `docker-compose/postgres/init/000_run_init_tree.sh`

## 维护原则

1. 顶层目录负责调度，不要把 provider 初始化逻辑散落到其他 bootstrap 目录。
2. provider-side 数据库对象一旦落地，相关 SQL 与 shell 初始化说明同步更新本文档。
3. 如果只是执行型占位说明，项目目录内保留短入口即可，canonical 内容统一维护在根 `docs/03_Projects/infra/`。

现在的维护规则更硬：

1. repository/runtime 不允许自动建表、补列或偷偷迁移。
2. provider schema 变化必须直接修改 `001_provider_schema.sql`。
3. 如果要本地重建 provider 库，先跑 `000_create_provider_database_and_roles.sh`，再跑 `001_apply_provider_schema.sh`。
