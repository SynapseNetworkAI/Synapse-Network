# gateway-providers init

该目录用于独立的 provider-side PostgreSQL bootstrap 脚本。

当前已接入执行链路的脚本：

1. `000_create_provider_database_and_roles.sh`
2. `001_apply_provider_sentiment_schema.sh`
3. `001_provider_sentiment_schema.sql`
4. `002_apply_provider_sentiment_observability_upgrade.sh`
5. `002_provider_sentiment_observability_upgrade.sql`
6. `004_apply_provider_protocol_brief_schema.sh`
7. `004_provider_protocol_brief_schema.sql`
8. `005_apply_provider_contract_audit_schema.sh`
9. `005_provider_contract_audit_schema.sql`
10. `006_apply_provider_contract_audit_observability_upgrade.sh`
11. `006_provider_contract_audit_observability_upgrade.sql`
12. `007_apply_provider_whale_oss_schema.sh`
13. `007_provider_whale_oss_schema.sql`
14. `008_apply_provider_twitter_video_schema.sh`
15. `008_provider_twitter_video_schema.sql`
16. `009_apply_provider_youtube_video_schema.sh`
17. `009_provider_youtube_video_schema.sql`
18. `010_apply_provider_tiktok_reddit_schema.sh`
19. `010_provider_tiktok_reddit_schema.sql`

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

其中 `002_*` 用于对已经存在的 provider sentiment 表执行 production-v1 observability 字段升级，补齐 source timeout/retry/http status/payload hash 等落库能力。

`004_*` 用于给 `svc_protocol_fundamental_brief` 增加显式初始化的 brief snapshot / raw feed 表，继续保持 runtime repository 无 DDL 副作用。

`005_*` 用于给 `svc_smart_contract_audit` 增加公共调用日志表和审计报告快照表，继续保持 runtime repository 无 DDL 副作用。

`006_*` 用于给现有 `provider_api_invocations` 和 `provider_contract_audit_reports` 增加 `observability_json` 字段，保留 verified-source fallback 失败明细与解析路径。

canonical 说明文档已经迁到：

1. `docs/03_Projects/infra/Postgres_Init_Gateway_Providers_Notes.md`

本目录保留直接执行型脚本与最短入口说明。

`007_*` 用于给 `svc_whale_flow_monitor` 与 `svc_oss_security_healthcheck` 增加显式初始化快照表，继续保持 runtime repository 无 DDL 副作用。

`008_*` 用于给 `svc_twitter_video_download` 增加视频资产元数据表，配合 MinIO 存储实现可落库可回放。

`009_*` 用于给 `svc_youtube_video_download` 增加视频资产元数据表，配合 MinIO 存储实现可落库可回放。

`010_*` 用于给 `svc_tiktok_video_download` 与 `svc_reddit_media_download` 增加资产元数据表，配合 MinIO 存储实现可落库可回放。
