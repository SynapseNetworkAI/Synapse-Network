# Agent SDK Quickstart

本文档面向 Agent Runtime 集成方，说明如何完成服务发现与付费调用。

## 1. 前置条件

调用前需要准备：

1. 有效 `Agent Credential`
2. Owner 已完成入金并确认到账
3. 可访问的平台 Gateway URL

## 2. 最小示例

```python
from synapse_client import SynapseClient

client = SynapseClient(
    credential_token="<agent-credential>",
    gateway_url="http://127.0.0.1:8000",
)

discovery = client.discover_services(intent="quote")
service_id = discovery["services"][0]["serviceId"]

result = client.invoke_service(
    service_id=service_id,
    payload={"prompt": "summarize this input"},
)

print(result)
```

## 3. Runtime Flow

1. Discover available services
2. Select service or request quote
3. Invoke through platform gateway
4. Receive unified result and billing facts

## 4. Design Note

SDK 的使用对象是 Agent Runtime，不是人类手动表单。所有集成都应该优先考虑自动发现、自动组参、自动调用，而不是为人类点按钮服务。
