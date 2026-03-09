# Provider Service 运维手册

> 适用目录：`/Users/cliff/workspace/A2A-pay/provider_service`
> 
> 目标：快速完成依赖安装、环境配置、服务启动与基本运维排查。

---

## 1. 运行环境要求

- OS：macOS / Linux
- Python：`3.10+`（建议 `3.11`）
- 网络：可访问 DeepSeek API

建议先确认：

```bash
python3 --version
```

---

## 2. 安装依赖

### 2.1 进入项目目录

```bash
cd /Users/cliff/workspace/A2A-pay/provider_service
```

### 2.2 创建并激活虚拟环境

```bash
python3 -m venv .venv
source .venv/bin/activate
```

> Windows（PowerShell）：
>
> ```powershell
> .venv\Scripts\Activate.ps1
> ```

### 2.3 安装 Python 依赖

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

---

## 3. 配置环境变量

### 3.1 复制模板

```bash
cp .env.example .env
```

### 3.2 配置关键参数

编辑 `.env`：

```env
DEEPSEEK_API_KEY=你的真实key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_TIMEOUT_S=30
SERVICE_HOST=0.0.0.0
SERVICE_PORT=8100
```

---

## 4. 启动服务

### 4.1 开发模式（推荐本地）

```bash
./.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8100 --reload
```

> 若不在 `provider_service` 目录启动，可显式加 `--app-dir`：
>
> ```bash
> /Users/cliff/workspace/A2A-pay/provider_service/.venv/bin/python -m uvicorn --app-dir /Users/cliff/workspace/A2A-pay/provider_service app.main:app --host 0.0.0.0 --port 8100 --reload
> ```

### 4.2 生产模式（无 reload）

```bash
./.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8100
```

---

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

---

## 6. 常见问题排查

### 问题 1：`DEEPSEEK_API_KEY is not configured`

- 原因：未配置 `.env` 或 key 为空
- 处理：检查 `.env` 是否存在、变量名是否正确

### 问题 2：接口返回 502（上游失败）

- 原因：DeepSeek 网络不可达、网关超时或响应异常
- 处理：
  - 检查网络连通性
  - 调大 `DEEPSEEK_TIMEOUT_S`
  - 重试请求

### 问题 3：端口占用（`Address already in use`）

- 处理方式 1：改端口

```bash
./.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8110 --reload
```

- 处理方式 2：释放占用端口（示例 8100）

```bash
lsof -i :8100
kill -9 <PID>
```

### 问题 4：`ModuleNotFoundError: No module named 'pydantic_settings'` 或 `No module named 'app'`

- 原因：启动时使用了全局 `uvicorn/python`，或当前目录不对
- 处理：
  - 始终使用项目虚拟环境解释器启动（`./.venv/bin/python -m uvicorn ...`）
  - 若提示 `No module named 'app'`，请在 `provider_service` 目录执行，或追加 `--app-dir /Users/cliff/workspace/A2A-pay/provider_service`

---

## 7. 建议运维流程（本地/测试环境）

1. 拉取最新代码
2. 激活 `.venv`
3. `pip install -r requirements.txt`
4. 更新 `.env`
5. 启动服务
6. 先打 `health`，再打业务接口

---

## 8. 服务扩展约定

后续新增接口时遵循：

- 路由：`app/api/v1/endpoints/*.py`
- 模型：`app/schemas/*.py`
- 外部调用：`app/services/*.py`
- 配置：`app/core/config.py`

这样可保持结构稳定，便于后续接入更多平台测试 API。
