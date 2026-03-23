# provider_service Hard Rules

本文件是 `provider_service` 目录下的本地 Agent 执行镜像。

canonical 规则文档在：

1. `docs/agents.md`
2. `docs/03_Projects/provider-service/Provider_Service_Agent_Rules.md`

## 必守规则

1. `provider_service` 是独立 Provider 微服务，不承担网关结算、预算、账本和后台控制面。
2. 路由层只做参数接收、错误映射和响应返回；业务逻辑下沉到 `app/services/`。
3. 所有请求与响应必须通过 Pydantic schema 定义，不要长期返回裸 `dict`。
4. 新增接口、改 schema、替换数据源、变更错误码时，必须同步补测试。
5. 禁止把项目说明、接口规范、规则文档写进 JSON；Markdown 才是文档载体。
6. 代码、文档、未来表结构说明必须同步更新。
7. 本地运行只使用项目虚拟环境：`./.venv/bin/python`。

## 文档入口

1. `docs/03_Projects/provider-service/README.md`
2. `docs/03_Projects/provider-service/Provider_Service_Local_Development.md`
3. `docs/03_Projects/provider-service/Provider_Service_Operations_Runbook.md`
4. `docs/provider_service/README.md`

## 最小验证

```bash
cd /Users/cliff/workspace/Synapse-Network/provider_service
./.venv/bin/python -m pytest tests -q
```