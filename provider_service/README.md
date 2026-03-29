# provider_service

`provider_service/` 是用于测试“平台接入第三方服务”场景的独立 Python 微服务。

## 文档入口

1. 项目导航页：`docs/03_Projects/provider-service/README.md`
2. 本地开发说明：`docs/03_Projects/provider-service/Provider_Service_Local_Development.md`
3. 项目运维手册：`docs/03_Projects/provider-service/Provider_Service_Operations_Runbook.md`
4. 子项目规则：`provider_service/AGENTS.md`

## 常用命令

```bash
cd /Users/cliff/workspace/Synapse-Network/provider_service
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
./scripts/start.local.sh
```

## 环境模式

当前脚本支持两套运行环境：

1. `local`
	- 本地开发调试默认使用该环境
	- 读取 `provider_service/.env.local`
	- 默认走独立 provider PostgreSQL：`synapse_gateway_providers`
2. `prod`
	- 读取 `provider_service/.env.prod`
	- 可选开启 sentiment scheduler 做热点 snapshot 后台预热

常用脚本：

```bash
cd /Users/cliff/workspace/Synapse-Network/provider_service

./scripts/start.local.sh
./scripts/stop.local.sh
./scripts/restart.local.sh

./scripts/start.prod.sh
./scripts/stop.prod.sh
./scripts/restart.prod.sh
```

兼容入口仍保留：

```bash
./scripts/start.sh local
./scripts/stop.sh local
./scripts/restart.sh local
```

环境变量模板说明：

1. `provider_service/.env.example` 现在为每个配置项标注了中文用途说明
2. 同时标注了哪些是条件必填项、哪些可以留空，以及代码默认值
3. `GATEWAY_PROVIDER_SIGNATURE_ENABLED` 可控制是否校验 Gateway 签名；建议 `local=false`、`prod=true`
4. 启动 `prod` 且 `GATEWAY_PROVIDER_SIGNATURE_ENABLED=false` 时，脚本默认拒绝启动
5. 只有显式设置 `ALLOW_INSECURE_PROD_START=true`，才允许带着关闭验签的 prod 继续启动，并打印红字安全警报
6. `SENTIMENT_PROXY_POOL_ENABLED` 可控制抓取 worker 是否走代理池；代理地址通过 `SENTIMENT_PROXY_POOL_URLS_JSON` 配置 JSON 数组
7. 因为启动脚本会 `source` 环境文件，`SENTIMENT_PROXY_POOL_URLS_JSON` 在 `.env.*` 里必须写成带单引号的整串 JSON，例如 `'["http://127.0.0.1:7890"]'`
8. 启动脚本会把 `proxy_pool_enabled` 打进启动摘要；如果开启代理池却没配代理地址，脚本会直接拒绝启动，避免误以为已经通过代理出站
9. `SENTIMENT_PROXY_TIMEOUT_FLOOR_S` 会在代理模式下抬高单源最小 timeout，避免单代理场景被过低的 connect/read timeout 打穿
10. 代理模式下 scheduler 会自动把刷新并发限制到代理池大小，避免一个本地代理同时扛过多快照刷新
11. 所有 postgres repository 现在共用 `PROVIDER_SERVICE_POSTGRES_DSN`；`Protocol Fundamental Brief` 已固定走 postgres，不再保留本地 file snapshot 路径；只有 `SENTIMENT_REPOSITORY_BACKEND` 还用于决定 sentiment 走 file 还是 postgres

## 说明

本文件现在只保留项目入口信息。
当前运行时已包含 `Web3 Sentiment Index` provider endpoint：`POST /provider-services/web3-sentiment-index/invoke`。
当前运行时已包含 `Protocol Fundamental Brief` provider endpoint：`POST /provider-services/protocol-fundamental-brief/invoke`。
当前运行时已包含 `Smart Contract Audit Model` provider endpoint：`POST /provider-services/smart-contract-audit/invoke`。
当前运行时已包含 `TikTok Video Download` provider endpoint：`POST /provider-services/tiktok-video-download/invoke`。
当前运行时已包含 `Reddit Media Download` provider endpoint：`POST /provider-services/reddit-media-download/invoke`。
本地默认运行配置已切到独立 provider PostgreSQL：`synapse_gateway_providers`。
当前读路径已支持 `fresh / stale-but-servable / expired` 三档 snapshot freshness policy，scheduler 在开启时已接入持久化 lease / cooldown 状态表。
`Protocol Fundamental Brief` 现在已接入 typed repository + in-memory cache：未过期快照会优先走内存或 PostgreSQL 持久化缓存，全源失败时会退回最近一次已持久化快照。
`Protocol Fundamental Brief` 当前缓存策略明确采用 `in-memory hot cache + persisted snapshot fallback`；V1 不默认引入 Redis，避免在单实例或低并发阶段把简单问题做重，只有在多实例共享热缓存成为瓶颈时再升级为 Redis。
Provider 侧 postgres 配置现在已统一收敛到单一环境变量 `PROVIDER_SERVICE_POSTGRES_DSN`，避免 sentiment / protocol brief 分别维护重复 DSN；protocol brief 本地不再依赖 file snapshot。
PostgreSQL 表结构需要通过 `docker-compose/postgres/init/gateway-providers/` 的显式 SQL 初始化，`provider_sentiment_snapshots`、`provider_sentiment_raw_feeds`、`provider_sentiment_scheduler_jobs`、`provider_protocol_briefs`、`provider_protocol_brief_raw_feeds` 都不由 runtime repository 自动建表。
`Smart Contract Audit Model` 相关表现在也走同一条显式初始化链路：`provider_api_invocations`、`provider_contract_audit_reports`。
完整接口说明、启动方式与扩展建议统一维护在根 `docs/03_Projects/provider-service/`。
