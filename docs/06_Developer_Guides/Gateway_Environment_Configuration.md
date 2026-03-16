# Gateway 环境变量配置说明

本文说明 `gateway/.env.example`、`gateway/.env.local`、`gateway/.env.local.example`、`gateway/.env.prod`、`gateway/.env.prod.example` 中的配置项分别做什么、哪些必须自己配置、哪些可以直接使用默认值。

## 1. 加载规则

网关配置加载逻辑在 `gateway/src/core/config.py`。

加载顺序如下：

1. 先读取根目录 `.env`。
2. 如果设置了 `ENV_FILE`，只加载该文件。
3. 如果没有设置 `ENV_FILE`，则根据 `ENVIRONMENT` 自动加载：
   - `local` -> `.env.local`
   - `prod` / `production` -> `.env.prod`
   - 其他值按别名规则加载对应文件

结论：

- 日常开发建议维护 `gateway/.env.local`
- 生产部署建议维护 `gateway/.env.prod`
- `gateway/.env.example` 作为完整参数字典，主要用于查阅

## 2. 必须自己配置的项

下面这些配置，建议不要依赖默认值，应该在 `.env.local` 或 `.env.prod` 里显式写出。

| 配置项 | 作用 | 本地 | 生产 |
| --- | --- | --- | --- |
| `ENVIRONMENT` | 选择运行环境和自动加载的 env 文件 | 建议显式写 `local` | 必须写 `prod` |
| `RPC_URL` | 链上 RPC，充值索引、补账、对账都依赖它 | 必须 | 必须 |
| `ROUTER_ADDRESS` | SynapseCore / vault / router 地址 | 建议显式写 | 必须 |
| `USDC_TOKEN_ADDRESS` | USDC 合约地址，用于读取链上金库余额 | 建议显式写 | 必须 |
| `POSTGRES_DSN` | PostgreSQL 连接串 | 必须，除非改为完整配置 `POSTGRES_HOST/PORT/USER/PASSWORD/DB` | 必须，除非改为完整配置 `POSTGRES_HOST/PORT/USER/PASSWORD/DB` |
| `JWT_SECRET` | JWT 签名密钥 | 必须 | 必须 |
| `AUTH_SECRET` | Wallet challenge / auth 密钥 | 建议显式写 | 建议显式写 |

补充说明：

- `AUTH_SECRET` 不写时会回退到 `JWT_SECRET`，所以它不是“代码层面硬性必填”，但从安全上仍建议独立配置。
- `ROUTER_ADDRESS` 和 `USDC_TOKEN_ADDRESS` 在本地如果 `apps/frontend/src/contract-config.json` 已正确写入，代码可以回退读取；但这不适合作为生产策略。
- `POSTGRES_PASSWORD` 如果填写，会覆盖 `POSTGRES_DSN` 中自带的密码段，适合容器注入密码时使用。

## 3. 建议按场景显式配置的项

这些配置有默认值，但只要你涉及相关功能，最好显式写到环境文件中。

| 配置项 | 默认值 | 何时建议显式配置 |
| --- | --- | --- |
| `POSTGRES_AUTO_INIT` | `1` | 生产建议设为 `0`，避免应用启动时隐式建表 |
| `SELLER_API_HOST` | `127.0.0.1` | 容器部署一般改成 `0.0.0.0` |
| `SELLER_API_PORT` | `8000` | 如果端口映射不同，必须改 |
| `PLATFORM_FEE_RATE` | `0.10` | 平台费率不是 10% 时 |
| `GATEWAY_ROUTING_TAX` | `0.0001` | 路由税策略需要调整时 |
| `PLATFORM_FEE_ADMIN_WALLETS` | 空 | 需要调用平台费率管理接口时 |
| `INDEXER_ADMIN_WALLETS` | 回退到 `PLATFORM_FEE_ADMIN_WALLETS` | 要单独控制索引器状态接口访问时 |
| `REDIS_URL` | 空 | 需要分布式限流、共享计数器时 |
| `V2_DEPOSIT_CONFIRMATIONS` | `1` | 生产链确认数要求高于 1 时 |
| `V2_RECONCILIATION_ALERT_DELTA_USDC` | `1.0` | 想提高或降低对账告警灵敏度时 |

## 4. 可以直接使用默认值的项

以下大部分配置都已经在 `gateway/src/core/config.py` 中提供了合理默认值。除非你明确要调优，否则通常不需要写入 `.env.local` 或 `.env.prod`。

### 4.1 索引与对账

- `V2_INDEXER_POLL_INTERVAL_SEC=2`
- `V2_INDEXER_BLOCK_BATCH=100`
- `V2_BACKFILL_ENABLED=1`
- `V2_BACKFILL_BLOCK_BATCH=200`
- `V2_BACKFILL_START_BLOCK=0`
- `V2_RECONCILIATION_ENABLED=1`
- `V2_RECONCILIATION_INTERVAL_SEC=30`

### 4.2 鉴权与资金接口保护

- `AUTH_TOKEN_TTL_SEC=86400`
- `AUTH_CHALLENGE_TTL_SEC=600`
- `FINANCE_IDEMPOTENCY_TTL_SEC=86400`
- `FINANCE_IDEMPOTENCY_MAX_ROWS=10000`
- `FINANCE_REPLAY_WINDOW_SEC=900`
- `FINANCE_WRITE_RATE_LIMIT_PER_MIN=60`
- `ALLOW_LEGACY_AUTH=1`

### 4.3 凭据与限流

- `AGENT_CREDENTIAL_DEFAULT_TTL_SEC=3600`
- `AGENT_CREDENTIAL_MAX_TTL_SEC=259200`
- `AGENT_CREDENTIAL_MAX_CALLS_DEFAULT=1000`
- `OWNER_RATE_LIMIT_PER_MIN=240`
- `AGENT_RATE_LIMIT_PER_MIN=600`
- `SERVICE_RATE_LIMIT_PER_MIN=1200`
- `RATE_LIMIT_WINDOW_SEC=60`
- `REQUIRE_AGENT_CREDENTIAL_FOR_GENERATE=0`

### 4.4 服务约束上限

- `GATEWAY_MIN_TIMEOUT_MS=300`
- `GATEWAY_MAX_TIMEOUT_MS=15000`
- `GATEWAY_MIN_REQUEST_BYTES=256`
- `GATEWAY_MAX_REQUEST_BYTES=262144`
- `GATEWAY_MIN_RESPONSE_BYTES=256`
- `GATEWAY_MAX_RESPONSE_BYTES=1048576`
- `GATEWAY_MIN_SERVICE_QPS=1`
- `GATEWAY_MAX_SERVICE_QPS=200`
- `GATEWAY_DEFAULT_TIMEOUT_MS=3000`
- `GATEWAY_DEFAULT_REQUEST_BYTES=4096`
- `GATEWAY_DEFAULT_RESPONSE_BYTES=2048`
- `GATEWAY_DEFAULT_SERVICE_QPS=50`

### 4.5 提现风控与健康检查

- `PROVIDER_WITHDRAW_DEADLINE_SEC=900`
- `WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC=100`
- `WITHDRAWAL_AUTO_24H_LIMIT_USDC=500`
- `WITHDRAWAL_WINDOW_HOURS=24`
- `WITHDRAWAL_HIGH_RISK_SELLER_ADDRESSES=`
- `SERVICE_HEALTH_MONITOR_ENABLED=1`
- `SERVICE_HEALTH_PROBE_INTERVAL_SEC=15`
- `SERVICE_HEALTH_PROBE_TIMEOUT_MS=1500`
- `SERVICE_HEALTH_STALE_AFTER_SEC=120`
- `FORWARDING_REQUIRE_HEALTHY_TARGETS=1`
- `SERVICE_HEALTH_HISTORY_ENABLED=1`
- `SERVICE_HEALTH_HISTORY_RETENTION_HOURS=168`
- `SERVICE_HEALTH_HISTORY_PRUNE_INTERVAL_SEC=300`
- `SERVICE_HEALTH_HISTORY_DEFAULT_LIMIT_PER_TARGET=50`

### 4.6 旧支付兼容与运行时路径

只有在兼容旧支付流、或者做特殊脚本接入时，才需要改这些值：

- `SELLER_ADDRESS`
- `EXPECTED_PRICE`
- `MIN_CONFIRMATIONS`
- `PAYMENT_TTL_SEC`
- `ALLOWED_TOKEN_ADDRESSES`
- `SERVICE_PRICES_JSON`
- `SERVICE_REGISTRY_PATH`
- `AGENT_REGISTRY_PATH`
- `AGENT_CREDENTIALS_PATH`
- `AUDIT_LOG_PATH`
- `BALANCE_LEDGER_PATH`
- `USAGE_LOG_PATH`
- `DEPOSIT_INTENTS_PATH`
- `DEPOSIT_EVENT_CURSOR_PATH`
- `DEPOSIT_EVENT_PROCESSED_PATH`
- `REFUND_INTENTS_PATH`
- `ROUTER_CONFIG_PATH`
- `WALLET_ROLES_PATH`
- `PROVIDER_SECRETS_PATH`

## 5. 本地推荐最小配置

建议本地至少保留这些项：

```env
ENVIRONMENT=local
RPC_URL=http://127.0.0.1:8545
ROUTER_ADDRESS=0x...
USDC_TOKEN_ADDRESS=0x...
STORAGE_BACKEND=postgres
POSTGRES_DSN=postgresql://synapse:password@127.0.0.1:5432/synapse_gateway
POSTGRES_AUTO_INIT=1
SELLER_API_HOST=0.0.0.0
SELLER_API_PORT=8000
JWT_SECRET=...
AUTH_SECRET=...
```

## 6. 生产推荐最小配置

建议生产至少保留这些项：

```env
ENVIRONMENT=prod
RPC_URL=https://your-rpc-provider.example
ROUTER_ADDRESS=0x...
USDC_TOKEN_ADDRESS=0x...
STORAGE_BACKEND=postgres
POSTGRES_DSN=postgresql://user:password@postgres:5432/synapse_gateway
POSTGRES_AUTO_INIT=0
SELLER_API_HOST=0.0.0.0
SELLER_API_PORT=8000
JWT_SECRET=...
AUTH_SECRET=...
```

## 7. 当前文件分工

| 文件 | 作用 |
| --- | --- |
| `gateway/.env.example` | 完整配置字典，适合查阅所有支持的变量 |
| `gateway/.env.local.example` | 本地部署模板 |
| `gateway/.env.prod.example` | 生产部署模板 |
| `gateway/.env.local` | 当前仓库中的本地实际配置 |
| `gateway/.env.prod` | 当前仓库中的生产配置样板 |

## 8. 额外注意事项

1. `RUNTIME_STORAGE_DIR` 目前在代码里并不是一个真正自由可配置的路径，更多是兼容保留项；不要指望修改它就能完全切换运行目录。
2. 生产环境不要依赖 `apps/frontend/src/contract-config.json` 来给网关补合约地址，应该显式配置 `ROUTER_ADDRESS` 和 `USDC_TOKEN_ADDRESS`。
3. 如果你看到对账里 `chainVaultUsdc=0`，首先检查的就是 `RPC_URL`、`ROUTER_ADDRESS`、`USDC_TOKEN_ADDRESS` 三项是否正确。