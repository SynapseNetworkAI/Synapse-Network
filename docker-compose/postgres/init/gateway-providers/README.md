# gateway-providers init

该目录用于独立的 provider-side PostgreSQL bootstrap 脚本。

当前已接入执行链路的脚本：

1. `000_create_provider_database_and_roles.sh`
2. `001_apply_provider_schema.sh`
3. `001_provider_schema.sql`

当前 provider 独立数据库：

1. `synapse_gateway_providers`

当前已纳入部署链路的表：

1. `provider_sentiment_snapshots`
2. `provider_sentiment_raw_feeds`
3. `provider_protocol_briefs`
4. `provider_protocol_brief_raw_feeds`
5. `provider_api_invocations`
6. `provider_contract_audit_reports`
7. `provider_whale_flow_snapshots`
8. `provider_oss_security_reports`
9. `provider_twitter_video_assets`
10. `provider_youtube_video_assets`
11. `provider_tiktok_video_assets`
12. `provider_reddit_media_assets`

`001_provider_schema.sql` 现在是唯一权威 schema，直接包含 sentiment / protocol brief / audit / whale / oss / twitter / youtube / tiktok / reddit / github-release / paper-pdf 所有 provider 表的最终形态。

canonical 说明文档已经迁到：

1. `docs/03_Projects/infra/Postgres_Init_Gateway_Providers_Notes.md`

本目录保留直接执行型脚本与最短入口说明。

运行原则也同步收口：

1. runtime repository 不允许自动建表、补列或偷偷迁移。
2. schema 变更必须直接修改 `001_provider_schema.sql`，不要再追加一串 `00x_upgrade_*` 历史脚本。
3. 本地需要重建 provider 库时，先跑 `000_create_provider_database_and_roles.sh`，再跑 `001_apply_provider_schema.sh`。
