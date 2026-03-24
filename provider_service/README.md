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
./start.sh local
```

## 环境模式

当前脚本支持两套运行环境：

1. `local`
	- 本地开发调试默认使用该环境
	- 读取 `provider_service/.env.local`
	- 默认走独立 provider PostgreSQL：`synapse_gateway_providers`
2. `prod`
	- 读取 `provider_service/.env.prod`

常用脚本：

```bash
cd /Users/cliff/workspace/Synapse-Network/provider_service

./start.sh local
./stop.sh local
./restart.sh local

./start.sh prod
./stop.sh prod
./restart.sh prod
```

## 说明

本文件现在只保留项目入口信息。
当前运行时已包含 `Web3 Sentiment Index` provider endpoint：`POST /provider-services/web3-sentiment-index/invoke`。
本地默认运行配置已切到独立 provider PostgreSQL：`synapse_gateway_providers`。
完整接口说明、启动方式与扩展建议统一维护在根 `docs/03_Projects/provider-service/`。
