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

当前 provider 独立数据库：

1. `synapse_gateway_providers`

当前已纳入部署链路的表：

1. `provider_sentiment_snapshots`
2. `provider_sentiment_raw_feeds`
3. `provider_protocol_briefs`
4. `provider_protocol_brief_raw_feeds`

其中 `002_*` 用于对已经存在的 provider sentiment 表执行 production-v1 observability 字段升级，补齐 source timeout/retry/http status/payload hash 等落库能力。

`004_*` 用于给 `svc_protocol_fundamental_brief` 增加显式初始化的 brief snapshot / raw feed 表，继续保持 runtime repository 无 DDL 副作用。

canonical 说明文档已经迁到：

1. `docs/03_Projects/infra/Postgres_Init_Gateway_Providers_Notes.md`

本目录保留直接执行型脚本与最短入口说明。