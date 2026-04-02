# gateway

`gateway/` 是 Synapse 的运行时结算与调用主链路服务。

## 文档入口

1. 项目导航页：`docs/03_Projects/gateway/README.md`
2. 本地开发说明：`docs/03_Projects/gateway/Gateway_Local_Development.md`
3. 系统级 canonical 文档：`docs/02_System_Architecture/`、`docs/03_Core_Workflows/`、`docs/04_Database_Design/`、`docs/06_Reference/`

## 常用命令

```bash
cd /Users/cliff/workspace/Synapse-Network/gateway
.venv/bin/python gateway_fastapi.py

cd /Users/cliff/workspace/Synapse-Network
sh scripts/local/restart_gateway.sh
```

## 说明

本文件现在只保留项目入口信息。
完整本地启动、环境变量、验证与测试说明统一维护在根 `docs/03_Projects/gateway/`。