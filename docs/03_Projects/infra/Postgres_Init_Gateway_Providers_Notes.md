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

对应执行入口：

1. `docker-compose/postgres/init/gateway-providers/000_create_provider_database_and_roles.sh`
2. `docker-compose/postgres/init/gateway-providers/001_provider_sentiment_schema.sql`
3. `docker-compose/postgres/init/gateway-providers/001_apply_provider_sentiment_schema.sh`
4. `docker-compose/postgres/init/gateway-providers/002_provider_sentiment_observability_upgrade.sql`
5. `docker-compose/postgres/init/gateway-providers/002_apply_provider_sentiment_observability_upgrade.sh`
6. `docker-compose/postgres/init/gateway-providers/004_provider_protocol_brief_schema.sql`
7. `docker-compose/postgres/init/gateway-providers/004_apply_provider_protocol_brief_schema.sh`
8. `docker-compose/postgres/init/gateway-providers/005_provider_contract_audit_schema.sql`
9. `docker-compose/postgres/init/gateway-providers/005_apply_provider_contract_audit_schema.sh`
10. `docker-compose/postgres/init/gateway-providers/006_provider_contract_audit_observability_upgrade.sql`
11. `docker-compose/postgres/init/gateway-providers/006_apply_provider_contract_audit_observability_upgrade.sh`
12. `docker-compose/postgres/init/gateway-providers/007_provider_whale_oss_schema.sql`
13. `docker-compose/postgres/init/gateway-providers/007_apply_provider_whale_oss_schema.sh`
14. `docker-compose/postgres/init/gateway-providers/008_provider_twitter_video_schema.sql`
15. `docker-compose/postgres/init/gateway-providers/008_apply_provider_twitter_video_schema.sh`
16. `docker-compose/postgres/init/gateway-providers/009_provider_youtube_video_schema.sql`
17. `docker-compose/postgres/init/gateway-providers/009_apply_provider_youtube_video_schema.sh`

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

`007_*` 用于新增 `provider_whale_flow_snapshots` 与 `provider_oss_security_reports`，支撑 `whale-flow-monitor` 与 `oss-security-healthcheck` 两个服务的快照缓存和降级回退。


`008_*` 用于新增 `provider_twitter_video_assets`，支撑 twitter 视频下载服务的 MinIO 对象映射与元数据持久化。


`009_*` 用于新增 `provider_youtube_video_assets`，支撑 youtube 视频下载服务的 MinIO 对象映射与元数据持久化。
