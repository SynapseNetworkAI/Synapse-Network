# Provider Service (Standalone Python API)

用于测试“平台接入第三方服务”场景的独立 Python 微服务。
当前提供 2 个接口（本地测试模式）：
- 输入字符串，返回 1 条名人名言
- 输入字符串，返回 3 条名人名言

## 为什么单独新建一个文件夹

这里采用仓库根目录下独立目录 `provider_service/`，而不是混到 `gateway/` 或 `sdk/python/`：
- `gateway` 是核心结算网关，`sdk/python` 是开发者客户端代码。
- `provider_service` 是“可独立部署的服务进程”，职责边界更清晰。
- 未来新增更多测试接口时，可直接按模块扩展，不影响 SDK。

## 目录结构

```text
provider_service/
  app/
    main.py                       # FastAPI 入口
    core/
      config.py                   # 配置加载（.env）
    api/
      v1/
        router.py                 # v1 聚合路由
        endpoints/
          quotes.py               # 名言接口
    schemas/
      quote.py                    # 请求/响应模型
    services/
      deepseek_client.py          # 本地名言数据源封装（JSON 轮询）
    data/
      famous_quotes_100.json      # 100 条名言测试数据
  .env.example
  requirements.txt
  README.md
```

## 接口说明

### 1) 健康检查

- `GET /health`

### 2) 名人名言

- `POST /api/v1/quotes/famous`
- 请求体：

```json
{
  "text": "关于勇气"
}
```

- 响应示例：

```json
{
  "input_text": "关于勇气",
  "quote": "勇气是压力下的优雅。—— 海明威",
  "model": "local-json-100",
  "source": "local_json"
}
```

### 3) 名人名言 Top3

- `POST /api/v1/quotes/famous/top3`
- 请求体：

```json
{
  "text": "关于坚持"
}
```

- 响应示例：

```json
{
  "input_text": "关于坚持",
  "quotes": [
    "天才是百分之一的灵感加百分之九十九的汗水。—— 爱迪生",
    "滴水穿石，不是力量大，而是功夫深。—— 佚名",
    "千里之行，始于足下。—— 老子"
  ],
  "model": "local-json-100",
  "source": "local_json"
}
```

## 快速启动

1. 进入目录

```bash
cd provider_service
```

2. 创建虚拟环境并安装依赖

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

3. 配置环境变量

```bash
cp .env.example .env
# 本地 JSON 模式下无需配置 DEEPSEEK_API_KEY
```

4. 启动服务

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8100 --reload
```

5. 测试调用

```bash
curl -X POST "http://127.0.0.1:8100/api/v1/quotes/famous" \
  -H "Content-Type: application/json" \
  -d '{"text":"关于坚持"}'

curl -X POST "http://127.0.0.1:8100/api/v1/quotes/famous/top3" \
  -H "Content-Type: application/json" \
  -d '{"text":"关于坚持"}'
```

## 后续扩展建议

按同样分层扩展：
- 新接口：`app/api/v1/endpoints/*.py`
- 新模型：`app/schemas/*.py`
- 新外部服务适配：`app/services/*.py`
- 新版本路由：`app/api/v1/`

建议每个新接口保持：
- 独立 schema
- 独立 service 封装
- 路由层只做参数校验与错误映射

## 本地测试数据说明

- 数据文件：`app/data/famous_quotes_100.json`
- 数据量：100 条
- 行为：
  - `/famous` 每次返回 1 条（轮询）
  - `/famous/top3` 每次连续返回 3 条（轮询）
- 目的：联调与压测阶段稳定复现，不依赖外部模型服务可用性
