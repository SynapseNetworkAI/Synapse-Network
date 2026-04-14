# Staging-First GCE Rollout

- Status: canonical
- Code paths: `infra/docker/staging/`, `scripts/deploy/`, `services/user-front/.env*.example`
- Last verified against code: 2026-04-13

## Decision

当前阶段采用最低机器成本的上线顺序：

1. 先只准备 `1 台 GCE` 作为 `staging`
2. 用 Docker Compose 共机运行：
   - `Synapse-Network`
   - `Synapse-Network-Provider`
   - `Postgres`
   - `Kafka`
   - `ClickHouse`
   - reverse proxy
3. 暂不启用正式 `prod`
4. 通过 `GitHub Actions -> SSH -> staging deploy script` 做部署
5. 等 staging 连续稳定、用户支持入口与备份监控齐备后，再购买第 2 台 GCE 做 `prod`

## Why

之所以不先上 Cloud Run，也不先做 staging/prod 两套完整环境，是因为当前阶段的真实约束是：

1. 请求量很低，主要是你自己调试
2. 系统包含常驻依赖，不是单个无状态 Web 服务
3. 前期目标是压低机器费用，而不是压低运维复杂度

在这个前提下，单机 `staging` 比“两台机器 + 完整 prod”更合适。

## Single-VM Staging Shape

建议在这台机器上固定：

1. `gateway`
2. `user-front`
3. `provider runtime`
4. `postgres`
5. `kafka`
6. `clickhouse`
7. `caddy` 或 `nginx`

现有基础设施入口：

1. `infra/docker/staging/docker-compose.yml`
2. `scripts/deploy/staging.sh`
3. `Synapse-Network-Provider/scripts/deploy/staging.sh`

## Minimum Launch Gates Before Production

在购买第 2 台 `prod` 机器前，至少补齐：

1. 用户支持入口
   - `NEXT_PUBLIC_SUPPORT_EMAIL`
   - 可选 `NEXT_PUBLIC_SUPPORT_PORTAL_URL`
2. 充值/服务注册失败时的人工兜底
3. staging 域名、TLS、secrets、healthcheck 联调
4. PostgreSQL 备份
5. 至少一次 restore drill
6. 基础监控
   - health
   - disk
   - process
   - error log

## Environment Contract

前端支持入口通过公开环境变量配置：

1. `NEXT_PUBLIC_SUPPORT_EMAIL`
2. `NEXT_PUBLIC_SUPPORT_PORTAL_URL`

示例已经写入：

1. `services/user-front/.env.example`
2. `services/user-front/.env.local.example`
3. `services/user-front/.env.staging.example`
4. `services/user-front/.env.prod.example`
