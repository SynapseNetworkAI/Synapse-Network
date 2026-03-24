# Postgres Init Gateway Providers Notes

`docker-compose/postgres/init/gateway-providers/` 用于独立 provider-side PostgreSQL bootstrap 脚本。

当前仓库里的 PostgreSQL 初始化仍以 `gateway` 和 `gateway-admin` 两组数据库对象为主，但 `provider_service` 的 Web3 sentiment runtime 现在已经切到独立数据库 `synapse_gateway_providers`。

当前已纳入部署链路的 provider-side 对象：

1. 数据库：`synapse_gateway_providers`
2. app role：`synapse_provider_app`
3. readonly role：`synapse_provider_ro`
1. `provider_sentiment_snapshots`
2. `provider_sentiment_raw_feeds`

对应执行入口：

1. `docker-compose/postgres/init/gateway-providers/000_create_provider_database_and_roles.sh`
2. `docker-compose/postgres/init/gateway-providers/001_provider_sentiment_schema.sql`
3. `docker-compose/postgres/init/gateway-providers/001_apply_provider_sentiment_schema.sh`
4. `docker-compose/postgres/init/gateway-providers/002_provider_sentiment_observability_upgrade.sql`
5. `docker-compose/postgres/init/gateway-providers/002_apply_provider_sentiment_observability_upgrade.sh`

`002_*` 的职责不是重复建表，而是把已经存在的 `provider_sentiment_snapshots` / `provider_sentiment_raw_feeds` 平滑升级到 production-v1 schema，补齐以下观测字段：

1. snapshot 侧的 `symbol`、`chain`、`lookback_hours`、`source_count`、`generated_at`、`sentiment_score`、`market_temperature` 等业务元数据。
2. raw feed 侧的 `fetched_at`、`source_timestamp`、`latency_ms`、`retry_count`、`timeout_ms`、`http_status`、`payload_hash`、`error_code`、`error_message` 等抓取观测元数据。

如果后续 `provider_service` 再新增 schema 版本，继续按 `00x_*.sql + 00x_apply_*.sh` 的顺序追加，不要回写旧脚本，保持部署链路可审计、可重放。

## 相关目录

1. `docker-compose/postgres/init/gateway/`
2. `docker-compose/postgres/init/gateway-admin/`
3. `docker-compose/postgres/init/gateway-providers/`
4. `docker-compose/postgres/init/000_run_init_tree.sh`

## 维护原则

1. 顶层目录负责调度，不要把 provider 初始化逻辑散落到其他 bootstrap 目录。
2. provider-side 数据库对象一旦落地，相关 SQL 与 shell 初始化说明同步更新本文档。
3. 如果只是执行型占位说明，项目目录内保留短入口即可，canonical 内容统一维护在根 `docs/03_Projects/infra/`。