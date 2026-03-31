# Public Deployment Checklist

## 0. Metadata

- Status: active
- Owner: Founder / CTO hat
- Date: 2026-03-30
- Related systems: `apps/frontend`, `gateway`, `provider_service`, `contracts`
- Related docs:
  - `docs/exec-plans/active/2026-03-30_Public_Environment_Status_Register.md`
  - `docs/exec-plans/active/2026-03-30_Readiness_Gap_List.md`
  - `docs/exec-plans/active/2026-03-30_Hero_Demo_Runbook.md`
  - `docs/exec-plans/active/2026-03-31_GCP_Staging_Deployment_Blueprint.md`
  - `docs/03_Projects/frontend/Frontend_Local_Development.md`
  - `docs/03_Projects/gateway/Gateway_Local_Development.md`
  - `docs/03_Projects/provider-service/Provider_Service_Local_Development.md`

## 1. Purpose

把 `frontend / gateway / provider_service` 的公网部署收口成一份可以直接执行的上线清单。

这份文档只回答 3 个问题：

1. 三个服务各自怎么部署
2. 上线前必须补哪些环境变量
3. 什么条件下可以宣布公网 demo 可用

## 2. Deployment Topology

建议的最小公网拓扑：

1. `frontend`
   - 角色：Owner / Developer console
   - 端口：`3000`
   - 依赖：`gateway`
2. `gateway`
   - 角色：discover / quote / invoke / billing / credential runtime
   - 端口：`8000`
   - 依赖：`Postgres`, `RPC`, `contracts`, `provider_service`
3. `provider_service`
   - 角色：sample provider runtime
   - 端口：`8100`
   - 依赖：`Postgres`, optional `MinIO`, optional external APIs

## 3. Deployment Artifacts

这次已补的部署骨架：

1. `apps/frontend/Dockerfile`
2. `apps/frontend/.env.example`
3. `apps/frontend/.env.staging.example`
4. `apps/frontend/.env.prod.example`
5. `gateway/Dockerfile`
6. `provider_service/Dockerfile`

## 4. Service-Specific Launch Checklist

### 4.1 Frontend

部署前必须确认：

1. `NEXT_PUBLIC_GATEWAY_BASE_URL` 指向公网 `gateway`
2. `NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS` 已设置
3. 如需 WalletConnect，已配置 `NEXT_PUBLIC_REOWN_PROJECT_ID` 或 `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
4. `apps/frontend/src/contract-config.json` 已与 `Arbitrum Sepolia` 保持一致
5. 可直接从 `apps/frontend/src/contract-config.arbitrum-sepolia.example.json` 复制为首版模板
6. 共享测试网优先使用 `apps/frontend/.env.staging.example`，正式公网再切 `apps/frontend/.env.prod.example`

容器入口：

```bash
docker build -t synapse-frontend ./apps/frontend
docker run --rm -p 3000:3000 --env-file apps/frontend/.env.staging synapse-frontend
```

上线后最小验收：

1. `/` 页面可打开
2. 服务列表能从公网 `gateway` 取回数据
3. 钱包连接弹层能正常工作

### 4.2 Gateway

部署前必须确认：

1. `POSTGRES_DSN` 已配置为公网数据库
2. `JWT_SECRET` 与 `AUTH_SECRET` 已替换成生产强随机值
3. `RPC_URL` 已指向 `Arbitrum Sepolia` RPC
4. `ROUTER_ADDRESS` 与 `USDC_TOKEN_ADDRESS` 已填 `Arbitrum Sepolia` 真实地址
5. `PRIVATE_KEY` 已替换成独立 withdraw signer
6. `INDEXER_ADMIN_WALLETS` 与 `PLATFORM_FEE_ADMIN_WALLETS` 已配置
7. 如需 Redis 限流，`REDIS_URL` 已配置
8. 共享测试网部署优先读取 `gateway/.env.staging`，正式公网再切 `gateway/.env.prod`

容器入口：

```bash
docker build -t synapse-gateway ./gateway
docker run --rm -p 8000:8000 --env-file gateway/.env.staging synapse-gateway
```

上线后最小验收：

1. `GET /health` 返回 `200`
2. `discover / quote / invoke` 能打公网 `provider_service`
3. `credentials/agent/issue` 能成功签发
4. `indexer/status` 能被 admin wallet 正常读取

### 4.3 Provider Service

部署前必须确认：

1. `PROVIDER_SERVICE_POSTGRES_DSN` 已配置
2. `GATEWAY_PROVIDER_SIGNATURE_ENABLED=true`
3. `GATEWAY_PROVIDER_SIGNATURE_SECRET` 与 `gateway` 保持一致
4. 如启用 sentiment 持久化，`SENTIMENT_REPOSITORY_BACKEND=postgres`
5. 如启用媒体下载，`VIDEO_STORAGE_MINIO_*` 已配置
6. 如启用链上源码审计，`ETHERSCAN_API_KEY` 已配置
7. 共享测试网部署优先读取 `provider_service/.env.staging`，正式公网再切 `provider_service/.env.prod`

容器入口：

```bash
docker build -t synapse-provider-service ./provider_service
docker run --rm -p 8100:8100 --env-file provider_service/.env.staging synapse-provider-service
```

上线后最小验收：

1. `GET /health` 返回 `200`
2. 三个样板服务 endpoint 可达
3. Gateway HMAC 验签成功
4. `web3 sentiment / smart contract audit / whale-flow-monitor` 至少一项能稳定返回

## 5. Go / No-Go Gate

只有同时满足下面 7 条，才能宣布公网 demo ready：

1. `frontend` 公网 URL 已登记
2. `gateway` 公网 URL 已登记
3. `provider_service` 公网 URL 已登记
4. `testnet` 与 `contract address` 已登记
5. `discover -> quote -> invoke` 在公网至少成功 1 次
6. `Hero Demo` 所需两条链至少 1 条可公网复现
7. `Public_Environment_Status_Register` 不再有关键 `TBD`

## 6. Immediate Next Actions

建议按这个顺序推进：

1. 先把 `gateway` 上到 `staging`
2. 再把 `provider_service` 挂到 `staging`
3. 最后把 `frontend` 指向公网 `gateway`
4. 成功后立刻回填 `Public_Environment_Status_Register`

## 7. Validation Log

### 2026-03-30

- Check: 为 `frontend / gateway / provider_service` 补最小部署骨架与上线清单
- Result: 已新增三份 Dockerfile、前端 env example 和一份统一 deployment checklist
- Follow-up: 下一步把真实公网 URL、链地址与环境变量值填入 `Public_Environment_Status_Register`
