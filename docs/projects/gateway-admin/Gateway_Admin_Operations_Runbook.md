# Gateway Admin Operations Runbook

适用目录：`/Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin`

目标：快速完成环境准备、启动、联调、常见故障排查与生产托管切换。

`gateway-admin` 是 Python FastAPI 后端控制面 API，不是前端项目；不要用
`yarn dev` 启动。后台 UI 位于 `services/admin-front`，才使用 `yarn dev`。

## 1. 目录规划

```text
services/gateway-admin/
├── logs/
│   └── gateway-admin.log
├── run/
│   └── gateway-admin.pid
├── scripts/ops/
│   ├── common.sh
│   ├── start-local.sh
│   ├── start-staging.sh
│   ├── start-prod.sh
│   ├── stop.sh
│   ├── restart.sh
│   └── status.sh
├── .env.example
├── .env.local
├── README.md
└── src/
```

说明：

1. `scripts/ops/` 只放运维动作脚本。
2. `logs/` 放服务标准输出和错误输出。
3. `run/` 放 PID 文件。

## 2. 启动前准备

### 2.1 Python 环境

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2.2 环境变量

推荐在 `services/gateway-admin/.env.local` 中维护本地或单机部署配置。

共享测试网 / 演示环境建议使用 `services/gateway-admin/.env.staging`。

最小建议配置：

```bash
ADMIN_GATEWAY_HOST=0.0.0.0
ADMIN_GATEWAY_PORT=8300
ADMIN_GATEWAY_DEBUG=false
ADMIN_GATEWAY_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3200
ADMIN_SESSION_TTL_SEC=3600
ADMIN_SESSION_COOKIE_NAME=synapse_admin_session
ADMIN_SESSION_COOKIE_SECURE=false
ADMIN_SESSION_COOKIE_SAMESITE=lax
ADMIN_CSRF_SECRET=replace-this-with-a-dedicated-admin-csrf-secret
ADMIN_GOOGLE_AUTHENTICATOR_LOGIN_ENABLED=true
ADMIN_GOOGLE_AUTHENTICATOR_HIGH_RISK_ENABLED=true
ADMIN_DATABASE_DSN=postgresql://synapse_admin_app:12345678@localhost:5432/synapse_gateway_admin
ADMIN_DATABASE_MIGRATION_DSN=postgresql://synapse:12345678@localhost:5432/synapse_gateway_admin
GATEWAY_READONLY_DSN=postgresql://synapse_gateway_ro:12345678@localhost:5432/synapse_gateway
GATEWAY_INTERNAL_BASE_URL=http://localhost:8000
GATEWAY_INTERNAL_ADMIN_WALLET=0xYourGatewayAdminWallet
GATEWAY_INTERNAL_JWT_SECRET=replace-this-with-a-32-byte-minimum-jwt-secret
GATEWAY_INTERNAL_TOKEN_ISSUER=gateway-admin
GATEWAY_INTERNAL_TOKEN_AUDIENCE=gateway-internal
GATEWAY_INTERNAL_SERVICE_SUBJECT=service:gateway-admin
EXECUTION_WORKER_ENABLED=true
EXECUTION_WORKER_POLL_INTERVAL_SEC=5
EXECUTION_WORKER_BATCH_SIZE=10
```

详细变量含义见 [Gateway_Admin_Environment_Variables.md](./Gateway_Admin_Environment_Variables.md)。

### 2.3 Missing admin CSRF token 的真实含义

如果页面出现 `Missing admin CSRF token`，优先检查两类问题：

1. 前端是否在调用必须依赖会话的写接口。
2. `ADMIN_CSRF_SECRET`、`ADMIN_SESSION_COOKIE_*`、`ADMIN_GATEWAY_ALLOWED_ORIGINS` 是否导致 cookie / CSRF 无法建立。

`/api/admin/v1/auth/mfa/enroll/begin` 和 `/api/admin/v1/auth/mfa/enroll/verify` 这两个预登录首绑接口不应该要求已有会话 CSRF。

### 2.4 管理员登录失败锁定

默认策略：

1. `ADMIN_LOGIN_LOCK_THRESHOLD=5`
2. `ADMIN_LOGIN_LOCK_HOURS=24`
3. 密码错误和 Google Authenticator OTP 错误共用同一个失败计数。
4. 第 5 次失败仍返回通用 `401 UNAUTHORIZED`，同时触发账号锁定。
5. 锁定期间即使密码和 OTP 正确，也返回 `423 ADMIN_ACCOUNT_LOCKED`。
6. 成功登录或成功完成 MFA 首绑校验后，清零 `failed_login_attempts`、`last_failed_login_at`、`locked_until`。

错误码边界：

1. 普通密码错误：`401 UNAUTHORIZED`，不暴露剩余次数。
2. 普通 OTP 错误：`401 UNAUTHORIZED`，不暴露剩余次数。
3. 锁定账号：`423 ADMIN_ACCOUNT_LOCKED`，固定文案 `Admin account is temporarily locked. Try later or contact an owner.`。
4. 未知 email：仍返回通用 `401 UNAUTHORIZED`，不创建账号，不透露账号是否存在。

审计动作：

1. `admin.login.failure`: 单次密码或 OTP 失败。
2. `admin.login.locked`: 达到阈值并写入锁定时间。
3. `admin.login.blocked_locked`: 锁定期间拦截登录。
4. `admin.login.success`: 成功登录并清理失败计数。

审计 `detail` 只允许包含 `emailHash`、`failureStage`、`failedLoginAttempts`、`lockThreshold`、`lockHours` 等安全摘要。不要记录 password、otpCode、TOTP secret、raw signature、JWT、admin token。

人工解锁 runbook：

```sql
UPDATE admin_users
SET failed_login_attempts = 0,
    last_failed_login_at = NULL,
    locked_until = NULL,
    updated_at = NOW()
WHERE lower(email) = lower('<admin-email>');
```

执行后必须写一条人工运维记录，说明解锁原因、执行人、审批人和时间。V1 不提供自动解锁 API，避免攻击者把“解锁接口”变成新的爆破面。

Cloud Monitoring / Lark P1：

1. `ADMIN_ACCOUNT_LOCKED` 任意发生即触发 P1。
2. `ADMIN_LOGIN_FAILURE` 5 分钟内超过阈值触发 P1。
3. Lark 卡片 `business_scenario`: `Admin login brute-force or MFA guessing detected`。
4. Lark 卡片 `action`: `Check admin_action_audit by emailHash, verify source IP/user agent, then decide whether to unlock or rotate credentials.`。

本地浏览器 dogfood 验证：

1. 使用独立 disposable 测试账号，不复用真实管理员。
2. 通过 Admin-front 输入错误密码触发锁定，再用正确密码确认 `423 ADMIN_ACCOUNT_LOCKED`。
3. 自动截图、录屏、写 `report.json` / `report.md` / `bugfix-log.md`。
4. 测试结束后删除 disposable 账号。

详细步骤见 [Gateway_Admin_Login_Lockout_Dogfood_E2E.md](./Gateway_Admin_Login_Lockout_Dogfood_E2E.md)。

### 2.5 本地 `.env.local` 对齐清单

本地提现审核、execution retry、以及其他 `gateway-admin -> gateway` 内部命令依赖一组内部 service token 配置。

`services/gateway-admin/.env.local` 必须确认：

```bash
GATEWAY_INTERNAL_BASE_URL=http://localhost:8000
GATEWAY_INTERNAL_ADMIN_WALLET=0xA0f67a47D9eF18183Cd113eD85A654E2772c5901
GATEWAY_INTERNAL_JWT_SECRET=pfazKmMdEZ8RCTB-8A_hH9AAknSXoP6y
GATEWAY_INTERNAL_TOKEN_ISSUER=gateway-admin
GATEWAY_INTERNAL_TOKEN_AUDIENCE=gateway-internal
GATEWAY_INTERNAL_SERVICE_SUBJECT=service:gateway-admin
```

`gateway/.env.local` 必须确认：

```bash
PLATFORM_FEE_ADMIN_WALLETS=0xA0f67a47D9eF18183Cd113eD85A654E2772c5901
GATEWAY_INTERNAL_JWT_SECRET=pfazKmMdEZ8RCTB-8A_hH9AAknSXoP6y
GATEWAY_INTERNAL_TOKEN_ISSUER=gateway-admin
GATEWAY_INTERNAL_TOKEN_AUDIENCE=gateway-internal
GATEWAY_INTERNAL_SERVICE_SUBJECTS=service:gateway-admin
```

推荐对齐步骤：

1. 先对齐 `services/gateway-admin/.env.local` 的 `GATEWAY_INTERNAL_*`。
2. 再对齐 `services/gateway/.env.local` 的钱包白名单和 JWT 验证配置。
3. 重启 `gateway`。
4. 重启 `gateway-admin`。
5. 分别检查 `http://127.0.0.1:8000/health` 和 `http://127.0.0.1:8300/health`。

常见报错含义：

1. `Admin session expired`: 浏览器 session 失效。
2. `Missing admin CSRF token`: 会话期 CSRF 未建立或未恢复。
3. `Invalid Google Authenticator code`: OTP 过期或错误。后端默认接受当前、前一、后一 TOTP 时间步长；如果仍失败，请让管理员刷新 Google Authenticator 6 位码，并确认手机时间自动同步已开启。
4. `Invalid internal service token`: 两侧内部 JWT 配置未对齐。
5. `Internal admin wallet is not allow-listed`: admin wallet 不在 gateway 白名单中。

### 2.6 Provider 服务管理联调

后台 `Provider 服务` 页面依赖 `gateway-admin -> gateway` 内部 token 调用 Gateway runtime 的 provider service management API。

确认链路：

1. `GATEWAY_INTERNAL_BASE_URL` 指向正在运行的 Gateway，例如 `http://localhost:8000`
2. `GATEWAY_INTERNAL_JWT_SECRET`、issuer、audience、subject 与 Gateway `.env.local` 完全一致
3. `GATEWAY_INTERNAL_ADMIN_WALLET` 已加入 Gateway 的 `PLATFORM_FEE_ADMIN_WALLETS`
4. Gateway 已启动 `service_health_monitor`
5. admin-front 打开 `/provider-services`

管理语义：

1. `Force probe`：立即探活一次，不改变控制面生命周期。
2. `Pause`：切到 `inactive`，停止 discovery / invoke，并停止自动探活。
3. `Resume`：切回 `active`，立即 probe；健康达标后自动恢复 discovery / invoke。
4. `Suspend`：切到 `suspended`，禁止 discovery / invoke，但保留 slow lane 探活和审计。
5. `Delete`：只允许非 active 服务逻辑删除；删除后不再探活。

探活调度护栏：

1. `SERVICE_HEALTH_MAX_CONCURRENCY=32` 是默认全局 probe 并发上限，小规模环境不建议调高。
2. `SERVICE_HEALTH_JITTER_ENABLED=1` 会用 stable jitter 分散周期探活，避免大量 Provider endpoint 在同一 tick 被打中。
3. 中等规模可以评估调到 64；更大规模按服务数、probe p95 latency、timeout rate 和 Gateway CPU/FD 使用率测算。

`probeTier` 语义：

1. `normal`：正常探活频率。
2. `slow_lane`：长期 unhealthy 或 suspended 后降频探活，不等于停止探活。
3. `manual_only`：`inactive` / `draft`，只允许手动 `Force probe`。
4. `disabled`：`deleted`，不会再被探活。

排查要点：

1. `active + unhealthy` 是正常状态，表示 Gateway 自动摘流，但没有把 Provider 主动下线。
2. 长期 `active + unhealthy` 会进入 slow lane，降低探活频率以节省资源；endpoint 恢复后等下一次 slow lane probe，或直接点 `Force probe`。
3. 如果 monitor stats 里 `jitterSkipped` 高但 `checked` 持续推进，说明调度正在主动平滑负载，不是探活停止。
4. `inactive` 服务不会被定时任务自动探活；如需恢复自动探活，先 `Resume`。
5. 如果页面能登录但 Provider 服务列表报 401/403，优先检查内部 JWT 与 admin wallet 白名单。

### 2.7 初始化 bootstrap 管理员密码

Docker bootstrap 只创建管理员账号、角色绑定和占位 MFA 记录，不会初始化密码。`admin_users.password_hash` 为 `NULL` 时，登录会返回通用“邮箱或密码不正确”。

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin
.venv/bin/python scripts/set_bootstrap_password.py \
  --dsn 'postgresql://synapse_admin_app:local-dev-admin-app-password@127.0.0.1:15432/synapse_gateway_admin' \
  --email 'cliff@synapse-network.ai' \
  --password 'ReplaceWithStrongInitPassword'
```

这个脚本只负责给已存在的 bootstrap 管理员写入初始密码，不会创建账号或修改角色。

本地快速重置可使用：

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin
.venv/bin/python scripts/reset_admin_password.py \
  --email 'cliff@synapse-network.ai' \
  --password 'qwer@1234'
```

如果登录 MFA 开启，bootstrap 管理员默认没有可用 TOTP secret，需要先完成 MFA enrollment。Manual Setup Key 由 Gateway-admin 在 enrollment begin 时随机生成，Google Authenticator 只负责读取这个标准 TOTP secret，不会返回 secret 给我们。历史库里如果还存在 `__BOOTSTRAP_TOTP_SECRET__`，它只是不可用的 legacy 哨兵值，必须按未绑定 MFA 处理，不能展示给管理员、不能扫码使用。高危审核动作始终应保留 OTP step-up。

### 2.8 重置未绑定 MFA 的联调测试管理员

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin
.venv/bin/python scripts/reset_mfa_enrollment_test_admin.py \
  --dsn 'postgresql://synapse_admin_app:12345678@localhost:5432/synapse_gateway_admin'
```

默认测试账号：

1. email: `mfa-enroll-test@synapse-network.ai`
2. password: `EnrollUser#2026!`
3. expected result: `428 MFA_ENROLLMENT_REQUIRED`

如果只想删除测试管理员，不重新创建：

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin
.venv/bin/python scripts/reset_mfa_enrollment_test_admin.py \
  --dsn 'postgresql://synapse_admin_app:12345678@localhost:5432/synapse_gateway_admin' \
  --cleanup-only
```

重新绑定 MFA 的低层 SQL 只建议在专用联调测试账号上使用，不要直接拿 bootstrap 超管账号做清理。

## 3. 运维脚本

### 3.1 本地启动 local

本地后端 API：

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin
bash scripts/ops/start-local.sh
```

脚本会自动读取 `.env.local`，后台启动 `uvicorn src.app:app`，并写入 `run/gateway-admin.pid`。

如果需要前台启动并直接看日志：

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin

set -a
source .env.local
set +a

./.venv/bin/uvicorn src.app:app --host 0.0.0.0 --port 8300
```

本地后台 UI 单独启动：

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/admin-front
yarn dev
```

完整本地后台链路通常需要同时运行：

```bash
# Admin API
cd /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin
bash scripts/ops/start-local.sh

# Admin UI
cd /Users/cliff/workspace/agent/Synapse-Network/services/admin-front
yarn dev
```

### 3.2 Staging 启动服务

第一次准备真实 staging env：

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin
cp .env.staging.example .env.staging
```

确认并替换 `.env.staging` 中的真实配置：

```text
ADMIN_DATABASE_DSN
GATEWAY_READONLY_DSN
ANALYTICS_CLICKHOUSE_URL
GATEWAY_INTERNAL_BASE_URL
GATEWAY_INTERNAL_JWT_SECRET
ADMIN_CSRF_SECRET
```

启动 staging：

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin
bash scripts/ops/start-staging.sh
```

也可以显式指定 env 文件：

```bash
ADMIN_GATEWAY_ENV_FILE=/path/to/gateway-admin.staging.env \
bash scripts/ops/start-staging.sh
```

重启 staging：

```bash
bash scripts/ops/restart.sh staging
```

### 3.3 生产启动服务

生产环境不要直接使用 `.env.prod.example`。默认脚本会寻找：

```text
/etc/synapse/gateway-admin.env
```

启动 prod：

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin
bash scripts/ops/start-prod.sh
```

或显式指定生产 env：

```bash
ADMIN_GATEWAY_ENV_FILE=/etc/synapse/gateway-admin.env \
bash scripts/ops/start-prod.sh
```

重启 prod：

```bash
bash scripts/ops/restart.sh prod
```

模板文件见 [Gateway_Admin_Systemd_Deployment_Example.md](./Gateway_Admin_Systemd_Deployment_Example.md)。

### 3.4 停止与重启

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin
bash scripts/ops/status.sh
bash scripts/ops/stop.sh
bash scripts/ops/restart.sh local
bash scripts/ops/restart.sh staging
bash scripts/ops/restart.sh prod
```

## 4. 日志与 PID

默认路径：

1. 日志文件：`services/gateway-admin/logs/gateway-admin.log`
2. PID 文件：`services/gateway-admin/run/gateway-admin.pid`

常用排查命令：

```bash
tail -f /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin/logs/gateway-admin.log
cat /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin/run/gateway-admin.pid
```

## 5. 健康检查

```bash
curl http://127.0.0.1:8300/health
open http://localhost:3200/login
```

## 6. 菜单配置中心发布说明

`/menu-config` 使用真实 `draft / published` 双态流程：

1. `draft`: 后台配置人员正在编辑的草稿版本。
2. `published`: 所有后台管理员实际看到的全局菜单版本。

运行时行为：

1. `GET /api/admin/v1/config/menu-items?stage=draft` 读取草稿。
2. `GET /api/admin/v1/config/menu-items?stage=published` 读取已发布配置。
3. `GET /api/admin/v1/config/menu-items/visible` 读取当前会话可见菜单。
4. `POST/PATCH/DELETE /api/admin/v1/config/menu-items` 只修改 `draft`。
5. `POST /api/admin/v1/config/menu-items/publish` 才会发布新的 `published`。

发布前准备：

1. 确认数据库已执行 `docker-compose/postgres/init/gateway-admin/003_gateway_admin_projection_views.sql` 中的 admin config bootstrap 段。
2. 确认执行 publish 的账号具备 `super_admin` 角色。
3. 如果前后端分开部署，确认 `admin-front` 已指向新 `gateway-admin` 实例。

## 7. 生产建议

1. 单机或开发机优先使用 `start-local.sh`。
2. 共享测试网优先使用 `start-staging.sh`，不要拿 `prod` 代替。
3. 正式生产优先使用 `start-prod.sh + systemd`，不要长期手工 `nohup`。
4. `EXECUTION_WORKER_ENABLED=true` 时，至少保持一个稳定实例常驻。
5. `.env.local` / `.env.staging` 不要提交到仓库，敏感配置必须由部署机注入。

## 8. 推荐操作流程

### 8.1 首次启动

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin
cp .env.example .env.local
bash scripts/ops/start-local.sh
bash scripts/ops/status.sh
```

根目录 `npm run dev:all` / `npm run dev:restart` 会在 local 模式下自动探测并修复 `synapse_gateway_admin` schema。Docker 只会在空 Postgres volume 首次初始化时执行 bootstrap；已有 volume 缺表或 stale 时，依赖这个 local-only migration 自愈，而不是指望 Docker entrypoint 重跑。

如果你单独运行 `services/gateway-admin/scripts/ops/start-local.sh`，或者需要手动修复旧的 PostgreSQL volume 缺表，尤其是 `admin_execution_jobs`、`admin_execution_attempts` 这类 execution worker 依赖表，请执行：

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin
ADMIN_DATABASE_MIGRATION_DSN='postgresql://<schema-owner>@<host>:5432/synapse_gateway_admin' \
./.venv/bin/python scripts/apply_migrations.py
bash scripts/ops/restart.sh local
```

本地自动 migration 只允许 Docker local `localhost/127.0.0.1:15432` 的 `synapse_gateway_admin`。如果旧 volume 里的 migrator 权限不足，本地脚本会 fallback 到 Docker Postgres owner；可用 `ADMIN_DATABASE_LOCAL_SUPERUSER_DSN` 覆盖。共享环境仍然必须走受控 migration job。

### 8.2 Staging / Prod 发布顺序

共享环境不能让 `gateway-admin` 在启动时偷偷建表。发布
`synapse-staging-gateway-admin` 或 `synapse-prod-gateway-admin` 前，必须先
运行对应的 admin DB migration job：

```bash
gcloud run jobs execute synapse-staging-gateway-admin-db-migrate \
  --project <project-id> \
  --region us-central1 \
  --wait
```

生产使用 `synapse-prod-gateway-admin-db-migrate`，并且必须先通过 staging
同版本 evidence。Migration 失败时发布立即中止，不允许继续部署
Gateway-admin revision。这个顺序保护登录、MFA、审计、提现审核队列和
consumer manual withdrawal reject audit 不出现缺表 500。

### 8.3 日常重启

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin
bash scripts/ops/restart.sh local
tail -n 50 logs/gateway-admin.log
```

### 8.4 停服维护

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin
bash scripts/ops/stop.sh
```
