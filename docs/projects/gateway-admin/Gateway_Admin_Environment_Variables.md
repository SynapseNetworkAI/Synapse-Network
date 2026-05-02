# Gateway Admin Environment Variables

本文说明 `admin/gateway-admin` 在 `local / staging / prod` 三类环境下的推荐启动方式、环境变量含义与配置边界。

## 1. 环境文件分工

1. `.env.local`: 本地开发、单机调试、联调验证，默认被 `scripts/ops/start-local.sh` 自动优先加载。
2. `.env.staging`: 共享测试网 / demo / 联调环境，默认被 `scripts/ops/start-staging.sh` 自动优先加载。
3. `.env.example`: 总模板，不应直接拿示例值上线。
4. 生产私有配置建议通过 `ADMIN_GATEWAY_ENV_FILE=/path/to/prod.env` 指定。

加载优先级：

1. `ADMIN_GATEWAY_ENV_FILE`
2. `admin/gateway-admin/.env.staging`
3. `admin/gateway-admin/.env.local`
4. `admin/gateway-admin/.env`

## 2. Local 启动方式

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
sh scripts/ops/start-local.sh
```

特点：

1. `environment=local`
2. `ADMIN_GATEWAY_DEBUG=true`
3. CORS 默认允许 `localhost` / `127.0.0.1`
4. worker 默认开启，方便本地联调 execution jobs

## 3. Staging 启动方式

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
sh scripts/ops/start-staging.sh
```

共享测试网要求：

1. `environment=staging`
2. `ADMIN_GATEWAY_DEBUG=false`
3. `ADMIN_GATEWAY_ALLOWED_ORIGINS` 只保留真实 staging 后台域名
4. `ADMIN_DATABASE_DSN` 使用 staging 控制面数据库
5. `GATEWAY_READONLY_DSN` 指向 staging 只读账号

## 4. Prod 启动方式

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
export ADMIN_GATEWAY_ENV_FILE=/etc/synapse/gateway-admin.env
sh scripts/ops/start-prod.sh
```

生产要求：

1. `environment=prod`
2. `ADMIN_GATEWAY_DEBUG=false`
3. `ADMIN_GATEWAY_ALLOWED_ORIGINS` 只保留真实后台域名
4. `ADMIN_DATABASE_DSN` 使用后台控制面专用账号
5. `GATEWAY_READONLY_DSN` 只能使用 gateway 只读账号

## 5. 变量说明

### 4.1 服务基础配置

1. `environment`: 运行环境名称。
2. `ADMIN_GATEWAY_HOST`: `uvicorn` 监听地址。
3. `ADMIN_GATEWAY_PORT`: `gateway-admin` HTTP 端口，默认 `8300`。
4. `ADMIN_GATEWAY_DEBUG`: 调试模式，local 建议 `true`，staging/prod 建议 `false`。
5. `ADMIN_GATEWAY_ALLOWED_ORIGINS`: 后台前端跨域白名单。
6. `ADMIN_GATEWAY_TOKEN_PREFIX`: 管理员 token 前缀，便于审计识别。
7. `ADMIN_LOGIN_LOCK_THRESHOLD`: 管理员账号连续登录失败锁定阈值，默认 `5`，允许范围 `3..10`，越界拒绝启动。
8. `ADMIN_LOGIN_LOCK_HOURS`: 管理员账号临时锁定时长，默认 `24` 小时，允许范围 `1..168`，越界拒绝启动。

### 4.2 数据库与只读投影配置

1. `ADMIN_DATABASE_DSN`: gateway-admin 自身控制面数据库连接串。
2. `ADMIN_DATABASE_MIGRATION_DSN`: 用于 schema owner 执行 migration。
3. `GATEWAY_READONLY_DSN`: 读取 gateway 主系统 projection / dashboard 数据，只能是只读账号。

### 4.3 gateway 内部管理调用配置

1. `GATEWAY_INTERNAL_BASE_URL`: gateway-admin 回调 gateway 内部管理接口的基础地址。
2. `GATEWAY_INTERNAL_ADMIN_WALLET`: 签发内部管理 JWT 时使用的管理员钱包主体。
3. `GATEWAY_INTERNAL_JWT_SECRET`: 签发 gateway-admin -> gateway 的内部管理 JWT。
4. `GATEWAY_INTERNAL_TOKEN_ISSUER`: 内部 token `iss`。
5. `GATEWAY_INTERNAL_TOKEN_AUDIENCE`: 内部 token `aud`。
6. `GATEWAY_INTERNAL_SERVICE_SUBJECT`: 内部 token `sub`。
7. `GATEWAY_INTERNAL_TIMEOUT_SEC`: 调用 gateway 内部接口的超时时间。

### 4.4 execution worker 配置

1. `EXECUTION_WORKER_ENABLED`: 是否启动 execution worker。
2. `EXECUTION_WORKER_POLL_INTERVAL_SEC`: worker 轮询间隔。
3. `EXECUTION_WORKER_BATCH_SIZE`: 每轮最多拉取多少 execution jobs。

### 4.5 平台费 Safe Treasury 配置

这些变量只用于生成平台费提现 Safe Transaction draft。`gateway-admin` 不广播链上交易；最终执行必须在 Safe UI 中由 Ledger 硬件钱包确认。

1. `RPC_URL`: 读取 `SynapseCore.owner()` 与 `platformFeePool()` 的链 RPC。
2. `SYNAPSE_CORE_ADDRESS`: 当前环境的 `SynapseCore` 合约地址。
3. `PLATFORM_TREASURY_SAFE_ADDRESS`: 平台 treasury Safe 地址。`SynapseCore.owner()` 必须等于这个地址。
4. `PLATFORM_TREASURY_LEDGER_SIGNER_ADDRESS`: V1 `1-of-1` Safe 的唯一 Ledger signer 地址，用于审计展示。
5. `PLATFORM_FEE_TOKEN_DECIMALS`: 平台费 token 原子精度。本地 MockUSDC 默认 `18`，正式 USDC 应按部署资产配置。

硬约束：

1. 后台只接受 `amountUsdc + reason + requestId`，不接受前端传入 `to/data/functionName/recipient`。
2. 后端固定 Safe draft：`to=SYNAPSE_CORE_ADDRESS`、`value=0`、`operation=0`、selector=`withdrawPlatformFees(uint256)`。
3. `SynapseCore.owner()` 不等于 Safe 或 `amount > platformFeePool()` 时，禁止生成 draft。

### 4.6 数据源约束

`gateway-admin` 运行时只连接真实数据源：控制面数据来自 `ADMIN_DATABASE_DSN`，gateway 投影和审核数据来自 `GATEWAY_READONLY_DSN`，Analytics 看板来自 `ANALYTICS_CLICKHOUSE_URL` 指向的 ClickHouse `synapse_analytics.events`。ClickHouse 不可用时应显示 degraded/空数据，不能回退到 demo/mock 指标。

## 6. 推荐配置基线

### 5.1 Local

```dotenv
environment=local
ADMIN_GATEWAY_DEBUG=true
EXECUTION_WORKER_ENABLED=true
RPC_URL=http://127.0.0.1:8545
SYNAPSE_CORE_ADDRESS=<local SynapseCore address>
PLATFORM_TREASURY_SAFE_ADDRESS=<local Safe address>
PLATFORM_TREASURY_LEDGER_SIGNER_ADDRESS=<local Ledger signer address>
PLATFORM_FEE_TOKEN_DECIMALS=18
```

### 5.2 Staging

```dotenv
environment=staging
ADMIN_GATEWAY_DEBUG=false
EXECUTION_WORKER_ENABLED=true
RPC_URL=<Arbitrum Sepolia RPC URL>
SYNAPSE_CORE_ADDRESS=<staging SynapseCore address>
PLATFORM_TREASURY_SAFE_ADDRESS=<staging Safe address>
PLATFORM_TREASURY_LEDGER_SIGNER_ADDRESS=<staging Ledger signer address>
PLATFORM_FEE_TOKEN_DECIMALS=18
```

### 5.3 Prod

```dotenv
environment=prod
ADMIN_GATEWAY_DEBUG=false
EXECUTION_WORKER_ENABLED=true
RPC_URL=<production RPC URL>
SYNAPSE_CORE_ADDRESS=<production SynapseCore address>
PLATFORM_TREASURY_SAFE_ADDRESS=<production Safe address>
PLATFORM_TREASURY_LEDGER_SIGNER_ADDRESS=<production Ledger signer address>
PLATFORM_FEE_TOKEN_DECIMALS=6
```

## 7. 安全注意事项

1. `.env.local` 只适合本机开发，不要把本机密钥沿用到共享环境。
2. `.env.staging` 也不应提交真实密钥；共享环境必须和本机环境隔离。
3. 生产环境不要直接使用 `.env.example` 里的示例密码和示例密钥。
4. `GATEWAY_READONLY_DSN` 必须是只读账号。
5. `GATEWAY_INTERNAL_JWT_SECRET` 必须单独保管，禁止写入日志或聊天记录。
6. `PLATFORM_TREASURY_SAFE_ADDRESS` 必须是 Safe 地址，不能是个人 EOA、Cloud Run 服务钱包或脚本热钱包。
7. Ledger seed phrase 只能离线保存，禁止进入云盘、截图、密码管理器、代码仓库或聊天记录。

## 8. 推荐操作流程

本地：

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
sh scripts/ops/start-local.sh
```

共享测试网：

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
cp .env.staging.example .env.staging
sh scripts/ops/start-staging.sh
```

生产：

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
cp .env.example /etc/synapse/gateway-admin.env
ADMIN_GATEWAY_ENV_FILE=/etc/synapse/gateway-admin.env sh scripts/ops/start-prod.sh
```

如果后续新增变量，必须同步更新：

1. `admin/gateway-admin/.env.local`
2. `admin/gateway-admin/.env.staging.example`
3. `admin/gateway-admin/.env.example`
4. 本文档
