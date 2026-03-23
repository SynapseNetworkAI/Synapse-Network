# provider_service

`provider_service/` 是用于测试“平台接入第三方服务”场景的独立 Python 微服务。

## 文档入口

1. 项目导航页：`docs/03_Projects/provider-service/README.md`
2. 本地开发说明：`docs/03_Projects/provider-service/Provider_Service_Local_Development.md`
3. 项目运维手册：`docs/03_Projects/provider-service/Provider_Service_Operations_Runbook.md`
4. 子项目规则：`provider_service/agents.md`

## 常用命令

```bash
cd /Users/cliff/workspace/Synapse-Network/provider_service
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8100 --reload
```

## 说明

本文件现在只保留项目入口信息。
完整接口说明、启动方式与扩展建议统一维护在根 `docs/03_Projects/provider-service/`。
