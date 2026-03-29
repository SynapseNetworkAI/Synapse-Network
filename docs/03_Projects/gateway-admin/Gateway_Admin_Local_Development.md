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
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
sh scripts/ops/start-local.sh
```

## 常用运维命令

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
sh scripts/ops/start-local.sh
sh scripts/ops/stop.sh
sh scripts/ops/restart.sh
sh scripts/ops/status.sh
```

## 数据库与迁移说明

1. `start-local.sh` / `start-prod.sh` 不再自动补跑 admin bootstrap SQL。
2. 如果旧 PostgreSQL volume 缺表，手动执行 `./.venv/bin/python scripts/apply_migrations.py`。
3. 如果 `ADMIN_DATABASE_DSN` 没有 schema 变更权限，额外配置 `ADMIN_DATABASE_MIGRATION_DSN`。

如果已经遇到缺表报错，例如 `admin_execution_jobs` 不存在，先补跑 migration 再重启服务。

## Bootstrap 管理员初始化

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
.venv/bin/python scripts/set_bootstrap_password.py \
  --dsn 'postgresql://synapse_admin_app:12345678@localhost:5432/synapse_gateway_admin' \
  --email 'super@synapse.network' \
  --password 'ReplaceWithStrongInitPassword'
```

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