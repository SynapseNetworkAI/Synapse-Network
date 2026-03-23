# Gateway Local Development

`gateway/` 是 Synapse 的运行时结算与调用主链路服务。

它负责：

1. Agent Runtime 的 discovery / quote / invoke 主协议落地。
2. Credential、Budget、扣费、收据、账本与资金一致性。
3. Owner 充值、余额、提现和审计主流程。
4. 对 Provider Runtime 的调用与结果聚合。

## 目录结构

```text
gateway/
├── src/                # 核心业务代码
├── tests/              # 自动化测试
├── examples/           # 示例与联调用脚本
├── gateway_fastapi.py  # FastAPI 启动入口
├── requirements.txt
├── pytest.ini
├── .env.example
├── .env.local.example
└── .env.prod.example
```

## 本地启动

### 1. 创建虚拟环境并安装依赖

```bash
cd /Users/cliff/workspace/Synapse-Network/gateway
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

### 2. 配置环境变量

```bash
cp .env.local.example .env.local
```

至少确认这些值已经对齐：

1. `POSTGRES_DSN`
2. `JWT_SECRET`
3. `PRIVATE_KEY`
4. `RPC_URL`
5. `ROUTER_ADDRESS`

### 3. 启动服务

```bash
cd /Users/cliff/workspace/Synapse-Network/gateway
.venv/bin/python gateway_fastapi.py
```

如果希望按仓库标准脚本重启本地 gateway：

```bash
cd /Users/cliff/workspace/Synapse-Network
sh scripts/local/restart_gateway.sh
```

## 最小验证

```bash
curl http://127.0.0.1:8000/health
```

## 测试

```bash
cd /Users/cliff/workspace/Synapse-Network/gateway
.venv/bin/python -m pytest -q
```

## 相关文档

1. [README.md](./README.md)
2. [../../agent/01_Agent_Runtime_Product_Architecture.md](../../agent/01_Agent_Runtime_Product_Architecture.md)
3. [../../agent/02_Discovery_Quote_Invoke_API_Design.md](../../agent/02_Discovery_Quote_Invoke_API_Design.md)
4. [../../04_Database_Design/README.md](../../04_Database_Design/README.md)
5. [../../Gateway_Database_Design.md](../../Gateway_Database_Design.md)