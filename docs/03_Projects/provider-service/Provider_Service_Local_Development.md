# Provider Service Local Development

`provider_service/` 是用于测试“平台接入第三方服务”场景的独立 Python 微服务。

当前运行时主要提供以下接口：

1. `GET /health`
2. `POST /provider-services/web3-sentiment-index/invoke`
3. `POST /provider-services/protocol-fundamental-brief/invoke`
4. `POST /provider-services/smart-contract-audit/invoke`
5. `POST /provider-services/whale-flow-monitor/invoke`
6. `POST /provider-services/oss-security-healthcheck/invoke`
7. `POST /provider-services/twitter-video-download/invoke`
8. `POST /provider-services/youtube-video-download/invoke`
9. `POST /provider-services/tiktok-video-download/invoke`
10. `POST /provider-services/reddit-media-download/invoke`
11. `POST /api/v1/quotes/famous`
12. `POST /api/v1/quotes/famous/top3`

## 为什么单独新建一个文件夹

这里采用仓库根目录下独立目录 `provider_service/`，而不是混到 `gateway/` 或 `sdk/python/`：

1. `gateway` 是核心结算网关。
2. `sdk/python` 是开发者客户端代码。
3. `provider_service` 是可独立部署的服务进程，职责边界更清晰。

## 目录结构

```text
provider_service/
├── app/
│   ├── main.py
│   ├── core/config.py
│   ├── api/v1/router.py
│   ├── api/v1/endpoints/quotes.py
│   ├── schemas/quote.py
│   ├── services/deepseek_client.py
│   └── data/famous_quotes_100.json
├── .env.example
├── requirements.txt
├── README.md
└── tests/
```

## 接口说明

### 1. 健康检查

`GET /health`

### 2. 名人名言

`POST /api/v1/quotes/famous`

### 3. 名人名言 Top3

`POST /api/v1/quotes/famous/top3`

## 快速启动

```bash
cd /Users/cliff/workspace/Synapse-Network/provider_service
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
./scripts/start.local.sh
```

本地开发调试默认使用 `local` 环境：

1. 读取 `provider_service/.env.local`
2. 默认走独立 provider PostgreSQL：`synapse_gateway_providers`
3. `DEEPSEEK_API_KEY` 仍可留空
4. `GATEWAY_PROVIDER_SIGNATURE_ENABLED` 本地可设为 `false`，便于直接用 curl 调试 provider 接口
5. `SENTIMENT_SCHEDULER_ENABLED` 是否开启按本地需要决定
6. `SENTIMENT_SCHEDULER_LEASE_TTL_S` 默认建议保持 `120`
7. freshness policy 默认阈值为 `60s / 300s / 900s`
8. PostgreSQL 表结构需先由 `docker-compose/postgres/init/gateway-providers/` 初始化，provider runtime 不会自动建表；scheduler state 依赖 `provider_sentiment_scheduler_jobs`
9. 如果抓取 worker 需要走代理池，设置 `SENTIMENT_PROXY_POOL_ENABLED=true`，并把 `SENTIMENT_PROXY_POOL_URLS_JSON` 配成代理 URL 的 JSON 数组
10. 在 `.env.local` / `.env.prod` 里要写成 shell-safe 形式，例如 `SENTIMENT_PROXY_POOL_URLS_JSON='["http://127.0.0.1:7890"]'`，否则脚本 `source` 后会把内部双引号吃掉
11. 开启代理池但没填代理地址时，启动脚本会拒绝启动，避免误配后仍然直连外网
12. 单代理本地联调建议把 `SENTIMENT_PROXY_TIMEOUT_FLOOR_S` 设为至少 `8`，否则代理 connect/read latency 很容易打穿默认单源 timeout
13. 代理模式下 scheduler 会自动按代理池大小收敛刷新并发，避免同一个本地代理被多份快照刷新同时压爆
14. `Protocol Fundamental Brief` 的 Phase 4 缓存策略当前采用 `in-memory hot cache + persisted snapshot fallback`：单机本地调试默认不需要 Redis，只有在多实例共享热缓存时才建议引入
15. `provider_service` 现在统一使用 `PROVIDER_SERVICE_POSTGRES_DSN` 作为共享数据库连接串；protocol brief repository 固定走 postgres，本地不再依赖 file snapshot
16. 如果要验证 protocol brief 持久化回退链路，直接确保 `PROVIDER_SERVICE_POSTGRES_DSN` 指向已初始化的 `synapse_gateway_providers`，同时确认 `docker-compose/postgres/init/gateway-providers/004_provider_protocol_brief_schema.sql` 已执行
17. `Smart Contract Audit Model` 的地址模式当前默认走 `Sourcify -> Blockscout -> Etherscan` fallback 链
18. `SOURCIFY_BASE_URL` / `SOURCIFY_TIMEOUT_S` 控制 Sourcify 拉取
19. `BLOCKSCOUT_BASE_URLS_JSON` / `BLOCKSCOUT_TIMEOUT_S` 控制链级 Blockscout explorer fallback
20. `ETHERSCAN_API_KEY`、`ETHERSCAN_BASE_URL`、`ETHERSCAN_TIMEOUT_S` 控制 Etherscan fallback；未配置 API key 时会自动跳过这一层

如果需要生产模式脚本入口：

```bash
./scripts/start.prod.sh
```

如果要本地直接调 `Web3 Sentiment Index`，有两种方式：

1. 保持 `GATEWAY_PROVIDER_SIGNATURE_ENABLED=true`，按 API 文档生成签名头
2. 把 `GATEWAY_PROVIDER_SIGNATURE_ENABLED=false`，然后直接用普通 curl 调试

## 测试调用

```bash
curl -X POST "http://127.0.0.1:8100/api/v1/quotes/famous" \
  -H "Content-Type: application/json" \
  -d '{"text":"关于坚持"}'

curl -X POST "http://127.0.0.1:8100/api/v1/quotes/famous/top3" \
  -H "Content-Type: application/json" \
  -d '{"text":"关于坚持"}'
```

## 扩展建议

按同样分层扩展：

1. 新接口放 `app/api/v1/endpoints/*.py`。
2. 新模型放 `app/schemas/*.py`。
3. 新外部服务适配放 `app/services/*.py`。
4. 路由层只做参数校验与错误映射。

## 本地测试数据说明

1. 数据文件：`app/data/famous_quotes_100.json`
2. `/famous` 每次返回 1 条。
3. `/famous/top3` 每次连续返回 3 条。
4. 目的是在联调和压测阶段稳定复现，不依赖外部模型服务。

## 相关文档

1. [README.md](./README.md)
2. [Provider_Service_Operations_Runbook.md](./Provider_Service_Operations_Runbook.md)
3. [../../provider_service/README.md](../../provider_service/README.md)
4. [../../provider_service/api/README.md](../../provider_service/api/README.md)
