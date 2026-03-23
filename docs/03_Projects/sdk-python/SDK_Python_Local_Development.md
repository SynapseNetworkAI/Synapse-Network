# SDK Python Local Development

`sdk/python/` 是 Synapse 的官方 Python SDK 分发与联调目录。

## 安装

发布包安装：

```bash
pip install synapse-client
```

本地开发安装：

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
```

## 常用验证

### Live smoke test

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
export SYNAPSE_API_KEY="agt_xxxxx..."
PYTHONPATH="$PWD" .venv/bin/python examples/smoke_test.py --query "名人名言"
```

如需输出可复现 curl：

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
export SYNAPSE_API_KEY="agt_xxxxx..."
PYTHONPATH="$PWD" .venv/bin/python examples/smoke_test.py --query "名人名言" --print-curl
```

如已知 `service_id`：

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
export SYNAPSE_API_KEY="agt_xxxxx..."
PYTHONPATH="$PWD" .venv/bin/python examples/smoke_test.py --service-id svc_quotes_famous_top3
```

## 端到端本地联调

```bash
sh /Users/cliff/workspace/Synapse-Network/scripts/local/restart_gateway.sh

cd /Users/cliff/workspace/Synapse-Network/sdk/python
export SYNAPSE_API_KEY="agt_xxxxx..."
export SYNAPSE_GATEWAY="http://127.0.0.1:8000"
PYTHONPATH="$PWD" .venv/bin/python examples/smoke_test.py \
  --query "名人名言" \
  --text "想要放弃的时候，请给我一句关于坚持的名人名言"
```

成功时脚本会打印 `Invocation succeeded`、`request_id`、`idempotency_key` 和最终 `invocationId`。

## 环境变量

1. `SYNAPSE_API_KEY`: Agent credential。
2. `SYNAPSE_GATEWAY`: 默认 gateway 地址。

## 相关文档

1. [README.md](./README.md)
2. [../../sdk/README.md](../../sdk/README.md)
3. [../../agent/07_Agent_SDK_Integration_Guide.md](../../agent/07_Agent_SDK_Integration_Guide.md)
4. [../../06_Reference/01_API_Contract_Index.md](../../06_Reference/01_API_Contract_Index.md)
