# Buyer SDK 快速接入指南

本文档面向买家侧 Agent/应用开发者，说明如何快速接入 `agentpay-buyer-sdk`，完成服务发现与付费调用。

## 1. 安装

在 `python_sdk` 目录执行（推荐开发模式）：

```bash
cd python_sdk
pip install -e .
```

> 若使用独立项目，可将 SDK 抽出后执行 `pip install <path-to-sdk>`。

## 2. 关键前置条件

调用前需要准备：

- `X-Agent-Credential`：在控制台或 API 中签发的买家凭证 token
- 买家余额已充值并完成链上确认入账（`deposit intent + indexer`）
- 可访问网关地址（默认 `http://127.0.0.1:8000`）

## 3. 最小可用示例

```python
from buyer_sdk import AgentPayBuyer

client = AgentPayBuyer(
    credential_token="<X-Agent-Credential>",
    gateway_url="http://127.0.0.1:8000",
)

# 1) 服务发现
res = client.discover_services(intent="名人名言")
service_id = res["services"][0]["serviceId"]

# 2) 付费调用（V2）
result = client.invoke_service(
    service_id=service_id,
    payload={"prompt": "请给我一句关于坚持的名人名言"},
)

print(result)
```

## 4. 与 LLM Function Calling 对接

SDK 提供：

- `build_tools_from_discovery(discovery)`

可把 discover 返回结果转换为工具定义（tool schema），便于模型自动组参调用。

## 5. 文件位置

- SDK 代码：`python_sdk/buyer_sdk/`
- 示例脚本：`python_sdk/examples/buyer_sdk_discover_invoke.py`

## 6. 当前接口对齐说明

当前 Buyer SDK 的 invoke 默认对接：

- `POST /api/v2/generate`

并自动附带：

- `X-Agent-Credential`
- `X-Service-Id`

若后续新增标准网关转发接口（如 `/api/v2/gateway/forward/{service_id}`），可在 `buyer_sdk/client.py` 内平滑切换。 
