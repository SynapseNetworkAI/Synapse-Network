# sdk-python

`sdk/python/` 是 Synapse 的官方 Python SDK 分发与联调目录。

## 文档入口

1. 项目导航页：`docs/03_Projects/sdk-python/README.md`
2. 本地开发说明：`docs/03_Projects/sdk-python/SDK_Python_Local_Development.md`
3. 系统级 SDK 文档：`docs/sdk/README.md`

## 常用命令

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
PYTHONPATH="$PWD" .venv/bin/python examples/smoke_test.py --query "名人名言"
```

## 说明

本文件现在只保留项目入口信息。
完整安装、smoke test、端到端联调与环境变量说明统一维护在根 `docs/03_Projects/sdk-python/`。
- `QuoteError`: Quote creation failed.
- `BudgetExceededError`: Credential budget, daily cap, or policy guard blocked the call.
- `InsufficientFundsError`: Remaining budget or credit is exhausted.
- `AuthenticationError`: When API key is disabled or revoked.
- `InvokeError`: Execution failed or receipt polling timed out.
