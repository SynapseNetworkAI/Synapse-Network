# Provider Service Local Development

`provider_service/` 是用于测试“平台接入第三方服务”场景的独立 Python 微服务。

当前提供 2 个接口：

1. 输入字符串，返回 1 条名人名言。
2. 输入字符串，返回 3 条名人名言。

## 为什么单独新建一个文件夹

这里采用仓库根目录下独立目录 `provider_service/`，而不是混到 `gateway/` 或 `sdk/python/`：

1. `gateway` 是核心结算网关。
2. `sdk/python` 是开发者客户端代码。
3. `provider_service` 是可独立部署的服务进程，职责边界更清晰。

## 目录结构

```text
provider_service/
├── app/
│   ├── main.py
│   ├── core/config.py
│   ├── api/v1/router.py
│   ├── api/v1/endpoints/quotes.py
│   ├── schemas/quote.py
│   ├── services/deepseek_client.py
│   └── data/famous_quotes_100.json
├── .env.example
├── requirements.txt
├── README.md
└── tests/
```

## 接口说明

### 1. 健康检查

`GET /health`

### 2. 名人名言

`POST /api/v1/quotes/famous`

### 3. 名人名言 Top3

`POST /api/v1/quotes/famous/top3`

## 快速启动

```bash
cd /Users/cliff/workspace/Synapse-Network/provider_service
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8100 --reload
```

本地 JSON 模式下无需配置 `DEEPSEEK_API_KEY`。

## 测试调用

```bash
curl -X POST "http://127.0.0.1:8100/api/v1/quotes/famous" \
  -H "Content-Type: application/json" \
  -d '{"text":"关于坚持"}'

curl -X POST "http://127.0.0.1:8100/api/v1/quotes/famous/top3" \
  -H "Content-Type: application/json" \
  -d '{"text":"关于坚持"}'
```

## 扩展建议

按同样分层扩展：

1. 新接口放 `app/api/v1/endpoints/*.py`。
2. 新模型放 `app/schemas/*.py`。
3. 新外部服务适配放 `app/services/*.py`。
4. 路由层只做参数校验与错误映射。

## 本地测试数据说明

1. 数据文件：`app/data/famous_quotes_100.json`
2. `/famous` 每次返回 1 条。
3. `/famous/top3` 每次连续返回 3 条。
4. 目的是在联调和压测阶段稳定复现，不依赖外部模型服务。

## 相关文档

1. [README.md](./README.md)
2. [Provider_Service_Operations_Runbook.md](./Provider_Service_Operations_Runbook.md)
3. [../../provider_service/README.md](../../provider_service/README.md)
4. [../../provider_service/api/README.md](../../provider_service/api/README.md)