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
bash scripts/local/restart_gateway.sh
```

这个脚本现在会在返回成功前主动等待 `http://127.0.0.1:8000/health`，避免“父进程还活着但 gateway 实际没起来”的假启动。

## 最小验证

```bash
curl http://127.0.0.1:8000/health
```

## 测试

```bash
cd /Users/cliff/workspace/Synapse-Network/gateway
.venv/bin/python -m pytest -q
```

## Provider Shelf Seeding

如果要把 `web3 sentiment`、`smart contract audit`、`whale-flow monitor` 三个样板服务一次性注册进 gateway registry，可直接使用：

```bash
cd /Users/cliff/workspace/Synapse-Network/gateway
export SYNAPSE_GATEWAY_API_BASE="http://127.0.0.1:8000"
export SYNAPSE_OWNER_ADDRESS="0xYourOwnerWallet"
export SYNAPSE_OWNER_BEARER_TOKEN="owner-jwt-token"
export SYNAPSE_PROVIDER_BASE_URL="http://127.0.0.1:8100"
export SYNAPSE_REGISTER_DRY_RUN="true"
python examples/register_provider_shelf_services.py
```

常用变量：

1. `SYNAPSE_OWNER_BEARER_TOKEN`: 注册接口必需的 owner JWT
2. `SYNAPSE_OWNER_ADDRESS`: 与 JWT `sub` 对齐的钱包地址
3. `SYNAPSE_PROVIDER_BASE_URL`: provider runtime 地址
4. `SYNAPSE_PAYOUT_ADDRESS`: 可选，默认复用 owner 地址
5. `SYNAPSE_PAYOUT_CHAIN_ID`: 可选，默认 `421614`（Arbitrum Sepolia）
6. `SYNAPSE_REGISTER_DRY_RUN`: 设为 `true` 时只打印 payload，不实际提交

## 本地 RPC 缺失时的行为

如果本地没有起链节点，`gateway` 现在会把 deposit backfill 标记为 `INDEXER_BACKFILL_RPC_UNAVAILABLE`，但不会持续刷异常墙，也不会阻断 `discover / quote / invoke` 主链路。

想把本地链路跑满，有两个选择：

1. 给 `RPC_URL` 指向一个真实可用节点
2. 在纯本地 demo 场景把 `V2_BACKFILL_ENABLED=false`

## 相关文档

1. [README.md](./README.md)
2. [../../02_System_Architecture/02_Gateway_Runtime_Architecture.md](../../02_System_Architecture/02_Gateway_Runtime_Architecture.md)
3. [../../03_Core_Workflows/02_Discovery_and_Gateway_Call.md](../../03_Core_Workflows/02_Discovery_and_Gateway_Call.md)
4. [../../04_Database_Design/README.md](../../04_Database_Design/README.md)
5. [../../04_Database_Design/01_SQL_Schema_Overview.md](../../04_Database_Design/01_SQL_Schema_Overview.md)
