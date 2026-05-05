# Gateway Admin Local Development

`admin/gateway-admin/` 是平台管理员后端控制面 API。

## 目录说明

核心目录：

1. `src/api/routers/`: 后台 API 路由。
2. `src/core/`: 配置、日志、鉴权、依赖注入。
3. `src/domain/`: 管理后台领域模型。
4. `src/services/approval/`: 审批流编排。
5. `src/services/adapters/`: 对 gateway 或其他内部服务的适配层。
6. `src/storage/*`: 身份、审计、审批和分析读模型存储。
7. `scripts/ops/`: 启动、停止、重启、状态检查脚本。

## 启动方式

```bash
cd /Users/cliff/workspace/Synapse-Network
docker-compose -f docker-compose/docker-compose.yml up -d postgres

cd admin/gateway-admin
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
sh scripts/ops/start-local.sh
```

## 常用运维命令

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
sh scripts/ops/start-local.sh
sh scripts/ops/stop.sh
sh scripts/ops/restart.sh local
sh scripts/ops/start-staging.sh
sh scripts/ops/status.sh
```

## 数据库与迁移说明

1. Docker Postgres entrypoint 只会在空 volume 首次初始化时执行 `infra/postgres/init/**`；已有 volume 不会自动重跑 gateway-admin bootstrap SQL。
2. 根目录 `npm run dev:all` / `npm run dev:restart` 会在启动 gateway-admin 前探测 admin schema。若本地 `synapse_gateway_admin` 缺表或 stale，会自动用 local-only `ADMIN_DATABASE_MIGRATION_DSN` 执行 `scripts/apply_migrations.py`，再重新探测。
3. 如果旧 volume 里的 `synapse_admin_migrator` 还没有 DDL 权限，本地自愈会在同一 local-only 护栏内 fallback 到 Docker Postgres owner。可用 `ADMIN_DATABASE_LOCAL_SUPERUSER_DSN` 覆盖该本地 owner DSN。
4. `services/gateway-admin/scripts/ops/start-local.sh` 仍不直接补跑 SQL；如果单独启动该服务，缺表时手动执行 `./.venv/bin/python scripts/apply_migrations.py`。
5. 如果 `ADMIN_DATABASE_DSN` 没有 schema 变更权限，额外配置 `ADMIN_DATABASE_MIGRATION_DSN`。
6. 自动自愈只允许 Docker local `localhost/127.0.0.1:15432` 的 `synapse_gateway_admin`，防止本地启动脚本误打 staging/prod 或宿主机 5432 上的旧库。

如果已经遇到缺表报错，例如 `admin_execution_jobs` 不存在，先补跑 migration 再重启服务。

## Bootstrap 管理员初始化

Docker bootstrap 会创建管理员账号、角色和占位 MFA 记录，但不会写入 `password_hash`。第一次本地登录前必须设置密码。

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin
.venv/bin/python scripts/set_bootstrap_password.py \
  --dsn 'postgresql://synapse_admin_app:local-dev-admin-app-password@127.0.0.1:15432/synapse_gateway_admin' \
  --email 'cliff@synapse-network.ai' \
  --password 'ReplaceWithStrongInitPassword'
```

本地快速恢复也可以使用：

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin
.venv/bin/python scripts/reset_admin_password.py \
  --email 'cliff@synapse-network.ai' \
  --password 'qwer@1234'
```

如果登录 MFA 开启且 bootstrap TOTP 还是占位值，需要完成 MFA enrollment 或由 owner 重置该管理员的 MFA。资金审核、高危执行等操作仍会要求 Google Authenticator step-up。

## 本地默认连接基线

重点环境变量包括：

1. `ADMIN_DATABASE_DSN`
2. `GATEWAY_READONLY_DSN`
3. `GATEWAY_INTERNAL_BASE_URL`
4. `GATEWAY_INTERNAL_ADMIN_WALLET`
5. `GATEWAY_INTERNAL_JWT_SECRET`
6. `ADMIN_SESSION_COOKIE_NAME`
7. `ADMIN_CSRF_SECRET`
8. `ADMIN_GOOGLE_AUTHENTICATOR_LOGIN_ENABLED`
9. `ADMIN_GOOGLE_AUTHENTICATOR_HIGH_RISK_ENABLED`
10. `EXECUTION_WORKER_ENABLED`

详细配置说明和运维细节分别见：

1. [Gateway_Admin_Environment_Variables.md](./Gateway_Admin_Environment_Variables.md)
2. [Gateway_Admin_Operations_Runbook.md](./Gateway_Admin_Operations_Runbook.md)
3. [Gateway_Admin_Systemd_Deployment_Example.md](./Gateway_Admin_Systemd_Deployment_Example.md)

## 相关文档

1. [README.md](./README.md)
2. [../../admin/README.md](../../admin/README.md)
3. [../../admin/Admin_API_Contract_Phase1.md](../../admin/Admin_API_Contract_Phase1.md)
4. [../../admin/Admin_Database_Design.md](../../admin/Admin_Database_Design.md)
5. [../../admin/Admin_PostgreSQL_Deployment_Design.md](../../admin/Admin_PostgreSQL_Deployment_Design.md)
