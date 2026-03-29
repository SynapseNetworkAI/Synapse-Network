# Gateway Admin Operations Runbook

适用目录：`/Users/cliff/workspace/Synapse-Network/admin/gateway-admin`

目标：快速完成环境准备、启动、联调、常见故障排查与生产托管切换。

## 1. 目录规划

```text
admin/gateway-admin/
├── logs/
│   └── gateway-admin.log
├── run/
│   └── gateway-admin.pid
├── scripts/ops/
│   ├── common.sh
│   ├── start-local.sh
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
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2.2 环境变量

推荐在 `admin/gateway-admin/.env.local` 中维护本地或单机部署配置。

最小建议配置：

```bash
ADMIN_GATEWAY_HOST=0.0.0.0
ADMIN_GATEWAY_PORT=8300
ADMIN_GATEWAY_DEBUG=false
ADMIN_GATEWAY_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:4000
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
ADMIN_GATEWAY_USE_INMEMORY_STORE=false
```

详细变量含义见 [Gateway_Admin_Environment_Variables.md](./Gateway_Admin_Environment_Variables.md)。

### 2.3 Missing admin CSRF token 的真实含义

如果页面出现 `Missing admin CSRF token`，优先检查两类问题：

1. 前端是否在调用必须依赖会话的写接口。
2. `ADMIN_CSRF_SECRET`、`ADMIN_SESSION_COOKIE_*`、`ADMIN_GATEWAY_ALLOWED_ORIGINS` 是否导致 cookie / CSRF 无法建立。

`/api/admin/v1/auth/mfa/enroll/begin` 和 `/api/admin/v1/auth/mfa/enroll/verify` 这两个预登录首绑接口不应该要求已有会话 CSRF。

### 2.4 本地 `.env.local` 对齐清单

本地提现审核、execution retry、以及其他 `gateway-admin -> gateway` 内部命令依赖一组内部 service token 配置。

`admin/gateway-admin/.env.local` 必须确认：

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

1. 先对齐 `admin/gateway-admin/.env.local` 的 `GATEWAY_INTERNAL_*`。
2. 再对齐 `gateway/.env.local` 的钱包白名单和 JWT 验证配置。
3. 重启 `gateway`。
4. 重启 `gateway-admin`。
5. 分别检查 `http://127.0.0.1:8000/health` 和 `http://127.0.0.1:8300/health`。

常见报错含义：

1. `Admin session expired`: 浏览器 session 失效。
2. `Missing admin CSRF token`: 会话期 CSRF 未建立或未恢复。
3. `Invalid Google Authenticator code`: OTP 过期或错误。
4. `Invalid internal service token`: 两侧内部 JWT 配置未对齐。
5. `Internal admin wallet is not allow-listed`: admin wallet 不在 gateway 白名单中。

### 2.5 初始化 bootstrap 管理员密码

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
.venv/bin/python scripts/set_bootstrap_password.py \
  --dsn 'postgresql://synapse_admin_app:12345678@localhost:5432/synapse_gateway_admin' \
  --email 'super@synapse.network' \
  --password 'ReplaceWithStrongInitPassword'
```

这个脚本只负责给已存在的 bootstrap 管理员写入初始密码，不会创建账号或修改角色。

### 2.6 重置未绑定 MFA 的联调测试管理员

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
.venv/bin/python scripts/reset_mfa_enrollment_test_admin.py \
  --dsn 'postgresql://synapse_admin_app:12345678@localhost:5432/synapse_gateway_admin'
```

默认测试账号：

1. email: `mfa-enroll-test@synapse.network`
2. password: `EnrollUser#2026!`
3. expected result: `428 MFA_ENROLLMENT_REQUIRED`

如果只想删除测试管理员，不重新创建：

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
.venv/bin/python scripts/reset_mfa_enrollment_test_admin.py \
  --dsn 'postgresql://synapse_admin_app:12345678@localhost:5432/synapse_gateway_admin' \
  --cleanup-only
```

重新绑定 MFA 的低层 SQL 只建议在专用联调测试账号上使用，不要直接拿 bootstrap 超管账号做清理。

## 3. 运维脚本

### 3.1 启动服务

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
sh scripts/ops/start-local.sh
```

脚本会自动读取 `.env.local`，后台启动 `uvicorn src.app:app`，并写入 `run/gateway-admin.pid`。

### 3.2 生产启动服务

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
ADMIN_GATEWAY_ENV_FILE=/etc/synapse/gateway-admin.env sh scripts/ops/start-prod.sh
```

模板文件见 [Gateway_Admin_Systemd_Deployment_Example.md](./Gateway_Admin_Systemd_Deployment_Example.md)。

### 3.3 停止与重启

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
sh scripts/ops/stop.sh
sh scripts/ops/restart.sh local
sh scripts/ops/status.sh
```

## 4. 日志与 PID

默认路径：

1. 日志文件：`admin/gateway-admin/logs/gateway-admin.log`
2. PID 文件：`admin/gateway-admin/run/gateway-admin.pid`

常用排查命令：

```bash
tail -f /Users/cliff/workspace/Synapse-Network/admin/gateway-admin/logs/gateway-admin.log
cat /Users/cliff/workspace/Synapse-Network/admin/gateway-admin/run/gateway-admin.pid
```

## 5. 健康检查

```bash
curl http://127.0.0.1:8300/health
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
2. 正式生产优先使用 `start-prod.sh + systemd`，不要长期手工 `nohup`。
3. `EXECUTION_WORKER_ENABLED=true` 时，至少保持一个稳定实例常驻。
4. `.env.local` 不要提交到仓库，敏感配置必须由部署机注入。

## 8. 推荐操作流程

### 8.1 首次启动

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
cp .env.example .env.local
sh scripts/ops/start-local.sh
sh scripts/ops/status.sh
```

如果旧的 PostgreSQL volume 缺表，尤其是 `admin_execution_jobs`、`admin_execution_attempts` 这类 execution worker 依赖表，请手动执行：

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
ADMIN_DATABASE_MIGRATION_DSN='postgresql://<schema-owner>@<host>:5432/synapse_gateway_admin' \
./.venv/bin/python scripts/apply_migrations.py
sh scripts/ops/restart.sh local
```

### 8.2 日常重启

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
sh scripts/ops/restart.sh local
tail -n 50 logs/gateway-admin.log
```

### 8.3 停服维护

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
sh scripts/ops/stop.sh
```