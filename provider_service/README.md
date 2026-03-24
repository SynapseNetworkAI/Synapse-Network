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

## 说明

本文件现在只保留项目入口信息。
当前运行时已包含 `Web3 Sentiment Index` provider endpoint：`POST /provider-services/web3-sentiment-index/invoke`。
本地默认运行配置已切到独立 provider PostgreSQL：`synapse_gateway_providers`。
当前读路径已支持 `fresh / stale-but-servable / expired` 三档 snapshot freshness policy，scheduler 在开启时已接入持久化 lease / cooldown 状态表。
PostgreSQL 表结构需要通过 `docker-compose/postgres/init/gateway-providers/` 的显式 SQL 初始化，`provider_sentiment_snapshots`、`provider_sentiment_raw_feeds`、`provider_sentiment_scheduler_jobs` 都不由 runtime repository 自动建表。
完整接口说明、启动方式与扩展建议统一维护在根 `docs/03_Projects/provider-service/`。
