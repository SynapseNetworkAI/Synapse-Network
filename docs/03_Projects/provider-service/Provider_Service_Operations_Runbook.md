# Provider Service Operations Runbook

适用目录：`/Users/cliff/workspace/Synapse-Network/provider_service`

目标：快速完成依赖安装、环境配置、服务启动、接口验证与基本运维排查。

## 1. 运行环境要求

1. OS: macOS / Linux
2. Python: `3.10+`，建议 `3.11`
3. 当前本地 JSON 模式下无外部依赖

建议先确认：

```bash
python3 --version
```

## 2. 安装依赖

### 2.1 进入项目目录

```bash
cd /Users/cliff/workspace/Synapse-Network/provider_service
```

### 2.2 创建并激活虚拟环境

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 2.3 安装 Python 依赖

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

## 3. 配置环境变量

### 3.1 环境文件约定

```bash
cp .env.example .env
```

脚本启动约定：

1. 本地开发默认使用 `provider_service/.env.local`
2. 生产模式脚本使用 `provider_service/.env.prod`
3. `provider_service/.env` 仍可保留给手工直跑 `uvicorn` 的兼容路径

### 3.2 当前最小配置

```env
SERVICE_HOST=0.0.0.0
SERVICE_PORT=8100
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_TIMEOUT_S=30
SENTIMENT_REPOSITORY_BACKEND=postgres
SENTIMENT_POSTGRES_DSN=postgresql://synapse:12345678@localhost:5432/synapse_gateway_providers
SENTIMENT_POSTGRES_SNAPSHOT_TABLE=provider_sentiment_snapshots
SENTIMENT_POSTGRES_RAW_FEED_TABLE=provider_sentiment_raw_feeds
```

说明：

1. 当前代码路径实际使用本地 JSON 数据源，不依赖 `DEEPSEEK_API_KEY`。
2. 保留 `DEEPSEEK_*` 变量是为了后续切回真实模型时直接复用。

## 4. 启动服务

### 4.1 本地开发模式

```bash
./start.sh local
```

停止与重启：

```bash
./stop.sh local
./restart.sh local
```

### 4.2 生产模式

```bash
./start.sh prod
```

停止与重启：

```bash
./stop.sh prod
./restart.sh prod
```

如果需要绕过脚本手工直跑 `uvicorn`，可继续使用：

```bash
./.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8100
```

## 5. 验证服务可用

### 5.1 健康检查

```bash
curl http://127.0.0.1:8100/health
```

预期返回：

```json
{"status":"ok"}
```

### 5.2 测试 1 条名言接口

```bash
curl -X POST "http://127.0.0.1:8100/api/v1/quotes/famous" \
  -H "Content-Type: application/json" \
  -d '{"text":"关于勇气"}'
```

### 5.3 测试 3 条名言接口

```bash
curl -X POST "http://127.0.0.1:8100/api/v1/quotes/famous/top3" \
  -H "Content-Type: application/json" \
  -d '{"text":"关于坚持"}'
```

## 6. 常见问题排查

### 问题 1: 想接真实模型，但 `DEEPSEEK_API_KEY` 为空

1. 如果只是跑本地 JSON demo，可忽略。
2. 如果在扩展真实模型能力，再补齐 `.env`。

### 问题 2: 接口返回 500 或 503

常见原因：

1. 本地 JSON 数据文件缺失。
2. JSON 格式损坏。
3. 未来切回外部模型后，上游不可达或超时。

处理：

1. 检查 `app/data/famous_quotes_100.json` 是否存在且为合法 JSON 数组。
2. 运行测试确认本地 fixture 正常。
3. 如果接了真实模型，再检查 `DEEPSEEK_*` 配置与网络连通性。

### 问题 3: 端口占用

改端口：修改对应环境文件中的 `SERVICE_PORT`，例如 `provider_service/.env.local`。

```bash
./restart.sh local
```

释放占用端口：

```bash
lsof -i :8100
kill -9 <PID>
```

### 问题 4: `ModuleNotFoundError`

处理：

1. 始终使用项目虚拟环境解释器启动。
2. 如果提示 `No module named 'app'`，请在 `provider_service` 目录执行，或追加 `--app-dir /Users/cliff/workspace/Synapse-Network/provider_service`。

## 7. 建议运维流程

1. 拉取最新代码。
2. 激活 `.venv`。
3. `pip install -r requirements.txt`。
4. 更新 `provider_service/.env.local` 或 `provider_service/.env.prod`。
5. 用对应脚本启动服务。
6. 先打 `health`，再打业务接口。
7. 如改了 schema 或数据源，执行 `./.venv/bin/python -m pytest tests -q`。

## 8. 服务扩展约定

后续新增接口时遵循：

1. 路由：`app/api/v1/endpoints/*.py`
2. 模型：`app/schemas/*.py`
3. 外部调用：`app/services/*.py`
4. 配置：`app/core/config.py`