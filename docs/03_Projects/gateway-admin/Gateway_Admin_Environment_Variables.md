# Gateway Admin Environment Variables

本文说明 `admin/gateway-admin` 在 `local` 与 `prod` 两类环境下的推荐启动方式、环境变量含义与配置边界。

## 1. 环境文件分工

1. `.env.local`: 本地开发、单机调试、联调验证，默认被 `scripts/ops/start-local.sh` 自动优先加载。
2. `.env.example`: 生产 / 预发模板，不应直接拿示例值上线。
3. 生产私有配置建议通过 `ADMIN_GATEWAY_ENV_FILE=/path/to/prod.env` 指定。

加载优先级：

1. `ADMIN_GATEWAY_ENV_FILE`
2. `admin/gateway-admin/.env.local`
3. `admin/gateway-admin/.env`

## 2. Local 启动方式

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
sh scripts/ops/start-local.sh
```

特点：

1. `environment=development`
2. `ADMIN_GATEWAY_DEBUG=true`
3. CORS 默认允许 `localhost` / `127.0.0.1`
4. worker 默认开启，方便本地联调 execution jobs

## 3. Prod 启动方式

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
export ADMIN_GATEWAY_ENV_FILE=/etc/synapse/gateway-admin.env
sh scripts/ops/start-prod.sh
```

生产要求：

1. `environment=production`
2. `ADMIN_GATEWAY_DEBUG=false`
3. `ADMIN_GATEWAY_ALLOWED_ORIGINS` 只保留真实后台域名
4. `ADMIN_DATABASE_DSN` 使用后台控制面专用账号
5. `GATEWAY_READONLY_DSN` 只能使用 gateway 只读账号
6. `ADMIN_GATEWAY_USE_INMEMORY_STORE=false`

## 4. 变量说明

### 4.1 服务基础配置

1. `environment`: 运行环境名称。
2. `ADMIN_GATEWAY_HOST`: `uvicorn` 监听地址。
3. `ADMIN_GATEWAY_PORT`: `gateway-admin` HTTP 端口，默认 `8300`。
4. `ADMIN_GATEWAY_DEBUG`: 调试模式，local 建议 `true`，prod 建议 `false`。
5. `ADMIN_GATEWAY_ALLOWED_ORIGINS`: 后台前端跨域白名单。
6. `ADMIN_GATEWAY_TOKEN_PREFIX`: 管理员 token 前缀，便于审计识别。

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

### 4.5 存储模式配置

1. `ADMIN_GATEWAY_USE_INMEMORY_STORE`: 是否启用内存存储模式，生产必须为 `false`。

## 5. 推荐配置基线

### 5.1 Local

```dotenv
environment=development
ADMIN_GATEWAY_DEBUG=true
EXECUTION_WORKER_ENABLED=true
ADMIN_GATEWAY_USE_INMEMORY_STORE=false
```

### 5.2 Prod

```dotenv
environment=production
ADMIN_GATEWAY_DEBUG=false
EXECUTION_WORKER_ENABLED=true
ADMIN_GATEWAY_USE_INMEMORY_STORE=false
```

## 6. 安全注意事项

1. `.env.local` 只适合本机开发，不要把本机密钥沿用到共享环境。
2. 生产环境不要直接使用 `.env.example` 里的示例密码和示例密钥。
3. `GATEWAY_READONLY_DSN` 必须是只读账号。
4. `GATEWAY_INTERNAL_JWT_SECRET` 必须单独保管，禁止写入日志或聊天记录。
5. `ADMIN_GATEWAY_USE_INMEMORY_STORE` 在生产必须保持 `false`。

## 7. 推荐操作流程

本地：

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
sh scripts/ops/start-local.sh
```

生产：

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
cp .env.example /etc/synapse/gateway-admin.env
ADMIN_GATEWAY_ENV_FILE=/etc/synapse/gateway-admin.env sh scripts/ops/start-prod.sh
```

如果后续新增变量，必须同步更新：

1. `admin/gateway-admin/.env.local`
2. `admin/gateway-admin/.env.example`
3. 本文档