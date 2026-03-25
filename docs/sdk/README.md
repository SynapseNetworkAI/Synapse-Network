# Synapse Python SDK Testing and Operations

- Status: supplementary
- Canonical counterpart: `docs/03_Projects/sdk-python/README.md`, `docs/06_Reference/04_Development_Testing_and_Integration_Reference.md`
- Why retained: 保留 SDK 测试与运行细节，避免把长篇操作说明塞进项目导航页或公共 reference 总索引

本目录只回答两个问题：

1. 如何正确测试 `sdk/python/synapse_client`
2. 如何在本地和发布前运维这个 SDK

## 1. 先说清楚一个常见误用

不要这样执行：

```bash
sh sdk/python/synapse_client/client.py
```

原因：

1. `client.py` 是 Python 包模块，不是 shell 脚本。
2. `sh` 会把文件当 shell 语法解析。
3. 文件第一行里的 `import` 会被 shell 误当成系统里的 `import` 命令，在 macOS 上通常会落到 ImageMagick 的 `import`，所以你会看到 `Version: ImageMagick ...`。
4. 后面的 `from .exceptions import ...` 对 shell 来说也是非法语法，所以又会报 `syntax error near unexpected token`。

也不要直接这样跑：

```bash
python sdk/python/synapse_client/client.py
```

原因：

1. 这个文件内部使用相对导入，例如 `from .exceptions import ...`。
2. 直接把包内模块当脚本跑，Python 不会把它当成 `synapse_client` 包的一部分，通常会触发相对导入失败。

正确思路是：

1. 从包入口导入 `SynapseClient`
2. 运行 SDK 的单测文件
3. 运行 SDK 的集成 demo 文件，而不是执行 `client.py`

## 2. 目录事实

当前 Python SDK 目录：

- `sdk/python/pyproject.toml`
- `sdk/python/README.md`
- `sdk/python/examples/smoke_test.py`
- `sdk/python/synapse_client/__init__.py`
- `sdk/python/synapse_client/client.py`
- `sdk/python/synapse_client/models.py`
- `sdk/python/synapse_client/exceptions.py`
- `sdk/python/synapse_client/test/test_client_unit.py`

职责划分：

1. `client.py` 只负责 SDK 客户端实现。
2. `test_client_unit.py` 负责离线单测，不依赖真实 gateway。
3. `examples/smoke_test.py` 是可直接执行的联调 smoke test，用真实 gateway 和真实 API key 才执行。

## 3. 本地测试

### 3.1 环境准备

SDK 不应默认借用 `admin/gateway-admin/.venv`。

推荐做法是在 `sdk/python` 目录内维护自己的虚拟环境：

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
```

如果你不想激活环境，也可以直接使用：

```bash
$PWD/.venv/bin/python
```

### 3.2 运行 SDK 单测

这是当前仓库已验证通过的命令：

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
PYTHONPATH="$PWD" .venv/bin/python -m pytest synapse_client/test/test_client_unit.py -q
```

当前结果：`10 passed`

这组测试覆盖的核心行为：

1. API key 缺失校验
2. discovery 请求构造
3. quote 请求构造
4. invocation 请求构造
5. 401/402/500 到 SDK 异常类型的映射
6. `call_service` 的 quote -> invoke -> poll 主路径
7. pending 超时处理

### 3.3 运行 live smoke test

推荐直接执行 example，而不是把 live demo 塞进 pytest：

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
export SYNAPSE_API_KEY='agt_xxx_your_real_key'
PYTHONPATH="$PWD" .venv/bin/python examples/smoke_test.py --query '名人名言'
```

这个命令打的不是 mock，也不是本地假数据，而是真实 SDK 调用链路：

1. SDK 调 `POST /api/v1/agent/discovery/search`
2. SDK 调 `POST /api/v1/agent/quotes`
3. SDK 调 `POST /api/v1/agent/invocations`
4. 如果调用进入非终态，SDK 再轮询 `GET /api/v1/agent/invocations/{invocationId}`

所以它验证的是整条链：`sdk/python/examples/smoke_test.py -> synapse_client -> gateway -> provider/runtime -> invocation receipt`。

当前脚本默认会为每次执行自动生成新的 `request_id` 和 `idempotency_key`。这点非常关键，因为如果你总是复用固定幂等键，你看到的很可能是旧调用结果，不是一次新的真实请求。

如果联调失败，不要只看一行异常。现在可以直接加上 `--print-curl`，脚本会把 discovery / quote / invoke 三段请求分别打印成可复打的 curl 命令，并保留 `request_id` / `idempotency_key` 方便去 gateway 日志里串联同一条调用。

即使 discovery 返回 0 条结果，脚本现在也会走同一套失败诊断输出，告诉你当前卡在 discovery 阶段，并把 discovery curl 原样打印出来方便复打。

这个 smoke test 的前提：

1. 本地 gateway 已启动
2. `gateway_url` 指向可用地址，当前 example 默认是 `http://127.0.0.1:8000`
3. 网络里至少有一个可 discover 且健康的服务
4. API key 有权限且余额足够

如果你已经知道 `service_id`，可以跳过 discovery：

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
export SYNAPSE_API_KEY='agt_xxx_your_real_key'
PYTHONPATH="$PWD" .venv/bin/python examples/smoke_test.py --service-id svc_quotes_famous_top3
```

如果你要验证结构化 payload，而不是默认的 `{"text": "..."}` 文本体：

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
export SYNAPSE_API_KEY='agt_xxx_your_real_key'
PYTHONPATH="$PWD" .venv/bin/python examples/smoke_test.py \
    --service-id svc_quotes_famous_top3 \
    --payload-json '{"topic":"perseverance","style":"short"}'
```

如果你只想先验证 discovery 是否通，不实际 invoke：

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
export SYNAPSE_API_KEY='agt_xxx_your_real_key'
PYTHONPATH="$PWD" .venv/bin/python examples/smoke_test.py --query '名人名言' --skip-invoke
```

如果你要在失败时拿到更强的复现信息：

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
export SYNAPSE_API_KEY='agt_xxx_your_real_key'
PYTHONPATH="$PWD" .venv/bin/python examples/smoke_test.py \
    --query '名人名言' \
    --print-curl
```

脚本现在会额外输出：

1. 当前卡在 `discovery` / `quote` / `invoke` / `poll receipt` 哪一层
2. 当前运行使用的 `request_id`
3. 当前运行使用的 `idempotency_key`
4. 当前选中的 `service_id`
5. 对应阶段的 curl 复打命令
6. 一段简短的人话诊断建议

### 3.4 一条能打通真实链路的最短操作路径

如果你的目标是验证“SDK + 网关 + 服务”整条调用链，不要东拼西凑命令，直接按这个顺序：

```bash
sh /Users/cliff/workspace/Synapse-Network/scripts/local/restart_gateway.sh

cd /Users/cliff/workspace/Synapse-Network/sdk/python
export SYNAPSE_API_KEY='agt_xxx_your_real_key'
export SYNAPSE_GATEWAY='http://127.0.0.1:8000'
PYTHONPATH="$PWD" .venv/bin/python examples/smoke_test.py \
    --query '名人名言' \
    --text '想要放弃的时候，请给我一句关于坚持的名人名言'
```

成功判定标准不是只有退出码，还要看输出里是否同时出现：

1. `Discovery count: N` 且 `N > 0`
2. `Selected service: ...`
3. `Invocation succeeded`
4. 最终 JSON 里有非空 `invocationId`

如果你要把这次调用和 gateway 日志对齐，直接拿脚本输出里的 `Request id` 和 `Idempotency key` 去查日志即可。

## 4. 正确的调用和 smoke test 方法

### 4.1 Python REPL / one-off 脚本

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
PYTHONPATH="$PWD" .venv/bin/python - <<'PY'
from synapse_client import SynapseClient

client = SynapseClient(
    api_key="agt_xxx_your_real_key",
    gateway_url="http://127.0.0.1:8000",
)

result = client.discover_services(intent="名人名言", tags=["quotes"])
print(result.count)
print([svc.service_id for svc in result.results])
PY
```

### 4.2 package import smoke test

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
PYTHONPATH="$PWD" .venv/bin/python - <<'PY'
from synapse_client import SynapseClient
print(SynapseClient)
PY
```

如果这一步都失败，优先检查：

1. 当前目录是不是 `sdk/python`
2. `PYTHONPATH` 是否指向当前目录
3. 是否已经做过 `pip install -e .`

## 5. 发布前检查

Python SDK 每次改动前后，至少过下面这张清单：

1. 单测通过
2. README 示例仍与代码一致
3. `exceptions.py` 的错误映射仍和 gateway 错误码一致
4. `models.py` 字段别名仍和 API 响应一致
5. `examples/smoke_test.py` 的手工联调路径仍可用

建议发布前顺序：

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
PYTHONPATH="$PWD" .venv/bin/python -m pytest synapse_client/test/test_client_unit.py -q
.venv/bin/python -m pip install -e .
```

如果环境里装了 `build`，再补一轮打包校验：

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
.venv/bin/python -m build
```

如果 `python -m build` 报模块不存在，先安装：

```bash
.venv/bin/python -m pip install build
```

## 6. 运维关注点

### 6.1 入口配置

SDK 运行时主要受两个配置影响：

1. `SYNAPSE_API_KEY`
2. `gateway_url` 或 `SYNAPSE_GATEWAY` 语义上的网关地址

当前 `SynapseClient` 构造函数会自动读取：

- `SYNAPSE_API_KEY`

但 `gateway_url` 目前仍是显式参数优先，默认值为：

```text
http://127.0.0.1:8000
```

这意味着：

1. 本地联调时不传 `gateway_url` 通常没问题
2. 生产或 staging 场景必须显式传正确地址，不要默认依赖 localhost

### 6.2 幂等与重试

运维上要重点关注两个字段：

1. `request_id`
2. `idempotency_key`

建议：

1. 每次 quote / invoke 都挂稳定 `request_id`，便于串联 gateway 日志
2. 每次业务动作生成稳定 `idempotency_key`，避免重复扣费或重复执行

### 6.3 真实联调失败时先查哪里

如果 SDK 集成 demo 失败，优先按下面顺序排查：

1. Gateway 是否启动
2. API key 是否有效
3. discoverable 服务是否真的健康
4. 引用的 `service_id` 是否来自最新 discovery 结果
5. 凭据预算或余额是否足够

常见命令：

```bash
sh /Users/cliff/workspace/Synapse-Network/scripts/local/restart_gateway.sh
```

然后重新跑 SDK demo。

## 7. 常见故障对照表

### 7.1 出现 `ImageMagick import` 输出

原因：你在用 `sh` 执行 Python 文件。

处理：改成运行 SDK 单测、`examples/smoke_test.py`，或者用 Python 导入包，不要执行 `client.py`。

### 7.2 `api_key is required`

原因：没有传 `api_key`，也没有设置 `SYNAPSE_API_KEY`。

处理：

```bash
export SYNAPSE_API_KEY='agt_xxx_your_real_key'
```

### 7.3 discovery 返回 0 个结果

原因通常不是 SDK 坏了，而是后端没有 discoverable 服务。

优先检查：

1. 服务是否 `active`
2. target 是否健康
3. discovery query / tags 是否匹配

### 7.4 `402` 或预算相关异常

SDK 会把 `402` 映射成：

1. `InsufficientFundsError`
2. `BudgetExceededError`

这说明要查账户余额、credential 预算、daily cap，而不是继续重试 SDK。

## 8. 推荐维护原则

1. 不要把 `client.py` 做成 CLI 入口；它的职责是稳定 SDK 模块。
2. live 示例执行统一放在 `examples/`，不要混进单测目录。
3. 单测只 mock HTTP，不依赖真实 gateway。
4. live smoke test 必须是手工 opt-in，避免 CI 误连真实环境。
5. 文档、异常映射、模型字段、测试断言必须一起演进。

## 9. 最短操作路径

如果你只想快速确认 `synapse_client` 当前是否工作，按这个顺序：

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
PYTHONPATH="$PWD" .venv/bin/python -m pytest synapse_client/test/test_client_unit.py -q
export SYNAPSE_API_KEY='agt_xxx_your_real_key'
PYTHONPATH="$PWD" .venv/bin/python examples/smoke_test.py --query '名人名言'
```

第一步验证 SDK 代码本身。

第二步验证 SDK 与本地 Synapse gateway 的真实联调。