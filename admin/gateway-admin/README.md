# gateway-admin

平台管理员后端控制面 API 骨架目录。

推荐技术栈：

- FastAPI
- Python 3.11+
- 独立部署、独立鉴权、独立审计

职责边界：

- 管理员认证与授权
- RBAC / ABAC
- 审批流
- 平台配置控制面
- 财务后台受控操作
- 审计与合规查询
- 对 `gateway/` 的受控内部调用

目录说明：

- `src/api/routers/`: 后台 API 路由
- `src/core/`: 配置、日志、鉴权、依赖注入
- `src/domain/`: 管理后台自己的领域模型
- `src/services/approval/`: 审批流编排
- `src/services/adapters/`: 对 gateway 或其他内部服务的适配层
- `src/services/finance_admin/`: 财务后台服务
- `src/services/risk_admin/`: 风控后台服务
- `src/services/dashboard/`: 聚合查询与统计服务
- `src/storage/admin_identity/`: 管理员身份存储
- `src/storage/admin_audit/`: 管理员审计存储
- `src/storage/admin_approval/`: 审批单存储
- `src/storage/analytics/`: 统计查询与分析读库
- `scripts/ops/`: 启动、停止、重启、状态检查脚本
- `docs/`: `gateway-admin` 自己的运维与使用文档

第一期已初始化：

1. 可运行 FastAPI 入口 `src/app.py`
2. `admin_auth` 路由
3. `admin_users` 路由
4. `admin_config` 路由
5. `dashboard` 路由
4. `approval` 路由
5. `audit` 路由
6. `execution` 路由
7. `provider withdrawal review` 路由
5. 基础 schema / service / adapter 分层
6. 第一版 API contract 文档
8. 第一版 PostgreSQL migration：`migrations/001_admin_control_plane_schema.sql`
9. 第一版 domain / storage skeleton：`src/domain/`、`src/storage/`

当前已落地的后台用户能力：

- `GET /api/admin/v1/users`: 读取后台用户目录
- `GET /api/admin/v1/users/roles`: 读取角色模板与权限矩阵
- `POST /api/admin/v1/users`: 创建后台用户并绑定角色

当前已落地的配置中心能力：

- `GET /api/admin/v1/config/menu-items?stage=draft|published`: 读取菜单配置的 draft / published 视图
- `POST /api/admin/v1/config/menu-items`: 新增菜单项到 draft
- `PATCH /api/admin/v1/config/menu-items/{itemId}`: 编辑 draft 菜单项
- `DELETE /api/admin/v1/config/menu-items/{itemId}`: 从 draft 删除菜单项
- `POST /api/admin/v1/config/menu-items/publish`: 将当前 draft 发布为全局生效菜单版本

当前已落地的提现审核能力：

- `GET /api/admin/v1/withdrawal-reviews`: 读取仍处于 `PENDING_MANUAL_REVIEW` 的 provider 提现单
- `POST /api/admin/v1/withdrawal-reviews/{withdrawalId}/decision`: 由 reviewer 执行 approve / reject，再由 gateway-admin 使用内部管理员钱包代理到 gateway review API
- `GET /api/admin/v1/approvals`: 现在会把 provider manual review 投影成标准 approval summary，一起出现在统一审批队列里
- `POST /api/admin/v1/approvals/{approvalId}/decision`: 当 `approvalId` 形如 `PWR-{withdrawalId}` 时，会路由到 provider manual review 决策流

当前已落地的管理员认证增强：

- `GET /api/admin/v1/auth/policy`: 返回当前环境的登录 TOTP / 高风险 TOTP 开关与 Google Authenticator issuer
- `POST /api/admin/v1/auth/login`: 当 `ADMIN_GOOGLE_AUTHENTICATOR_LOGIN_ENABLED=true` 时，要求 `otpCode`
- 高风险写请求在 `X-CSRF-Token` 之外，还要求 `X-Admin-OTP-Code`
- 当前高风险 step-up 覆盖 approval decision、withdrawal review decision、execution retry、menu publish

`/menu-config` 切到真实 draft / publish 流程，指的是：

- 菜单配置不再保存在前端浏览器本地，而是存入 `gateway-admin` 的 `admin_config_documents` 持久化表
- 后端同时维护 `draft` 与 `published` 两个 stage 的菜单快照，二者都带版本号与更新时间
- `/menu-config` 页面上的 CRUD 操作只修改 `draft`，不会直接影响线上后台导航
- `publish` 动作会把当前 `draft` 原子性写成新的 `published` 快照，作为全局生效版本
- `AdminShell` 与普通后台页面只读取 `published`，因此线上导航只会在显式发布后切换
- 该流程天然支持“先改草稿、再统一发布”的控制面治理方式，也为后续接入审批、回滚、变更审计预留边界

当前菜单配置中心的权限约束：

- `super_admin` 可以创建、编辑、删除 draft，并执行 publish
- `platform_ops_admin` 可以读取 draft，用于运营侧复核当前待发布配置
- 普通后台管理员只能读取 published 版本，不允许访问 draft
- create / update / delete / publish 都会写入管理员审计日志

当前权限模型说明：

- 后台用户管理接口目前只允许 `super_admin` 创建用户
- `super_admin` 与 `platform_ops_admin` 可以读取用户目录和角色模板
- 前端菜单树会根据管理员的 `role + permissions` 自动裁剪可见模块
- 菜单配置以服务端 draft / published 双态持久化，`AdminShell` 读取 published 版本，`/menu-config` 管理 draft 版本
启动方式：

```bash
docker-compose -f docker-compose/docker-compose.yml up -d postgres
cd admin/gateway-admin
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
sh scripts/ops/start-local.sh
```

常用运维命令：

```bash
sh scripts/ops/start-local.sh
sh scripts/ops/stop.sh
sh scripts/ops/restart.sh local
sh scripts/ops/status.sh
```

运维说明见 `docs/运维手册.md`。

Bootstrap 管理员首次初始化密码：

```bash
cd admin/gateway-admin
.venv/bin/python scripts/set_bootstrap_password.py \
	--dsn 'postgresql://synapse_admin_app:12345678@localhost:5432/synapse_gateway_admin' \
	--email 'super@synapse.network' \
	--password 'ReplaceWithStrongInitPassword'
```

本地 PostgreSQL 缺省连接：

```bash
ADMIN_DATABASE_DSN=postgresql://synapse_admin_app:12345678@localhost:5432/synapse_gateway_admin
GATEWAY_READONLY_DSN=postgresql://synapse_gateway_ro:12345678@localhost:5432/synapse_gateway
GATEWAY_INTERNAL_BASE_URL=http://localhost:8000
GATEWAY_INTERNAL_ADMIN_WALLET=0xYourGatewayAdminWallet
GATEWAY_INTERNAL_JWT_SECRET=replace-this-with-a-32-byte-minimum-jwt-secret
GATEWAY_INTERNAL_TOKEN_ISSUER=gateway-admin
GATEWAY_INTERNAL_TOKEN_AUDIENCE=gateway-internal
GATEWAY_INTERNAL_SERVICE_SUBJECT=service:gateway-admin
ADMIN_SESSION_TTL_SEC=3600
ADMIN_SESSION_COOKIE_NAME=synapse_admin_session
ADMIN_SESSION_COOKIE_SECURE=false
ADMIN_SESSION_COOKIE_SAMESITE=lax
ADMIN_CSRF_SECRET=replace-this-with-a-dedicated-admin-csrf-secret
ADMIN_GOOGLE_AUTHENTICATOR_LOGIN_ENABLED=true
ADMIN_GOOGLE_AUTHENTICATOR_HIGH_RISK_ENABLED=true
ADMIN_GOOGLE_AUTHENTICATOR_ISSUER=Synapse Gateway Admin
ADMIN_GOOGLE_AUTHENTICATOR_WINDOW=1
EXECUTION_WORKER_ENABLED=true
EXECUTION_WORKER_POLL_INTERVAL_SEC=5
EXECUTION_WORKER_BATCH_SIZE=10
```

说明：

- `docker-compose` 现在会在首次初始化时自动创建 `synapse_gateway` 和 `synapse_gateway_admin` 两个数据库。
- 如果本地 `postgres_data` volume 已经存在，需要先删除 volume 再重新初始化，新的建库脚本才会生效。
- Admin schema 与 seed 会在容器首次初始化时自动导入，无需再手工在图形客户端里点 `Create Database`。
- Dashboard 的 gateway 指标通过 `synapse_gateway_ro` 查询 gateway 侧 3 个稳定只读投影视图：`synapse_admin_dashboard_finance_projection`、`synapse_admin_dashboard_activity_trend_projection`、`synapse_admin_dashboard_operations_projection`。
- 兼容接口 `overview` / `system-status` 继续通过聚合视图 `synapse_admin_dashboard_projection` 暴露旧摘要字段。
- Execution retry 现在不再只是把 job 重新入队，而是会使用内部管理员钱包 JWT 调用 gateway 管理命令，例如 `deposit_repair -> /api/v1/admin/deposits/replay`、`refund_approve -> /api/v1/admin/refunds/{refundId}/complete`、`withdrawal_approve -> /api/v1/admin/providers/withdrawals/{withdrawalId}/complete`，并把成功/失败结果回写到 execution job、attempt 和 approval 状态。
- Provider 提现人工审核不走旧的 execution complete 路径，而是新增专用 review proxy：`gateway-admin -> /api/admin/v1/withdrawal-reviews/* -> gateway /api/v1/admin/providers/withdrawals/{withdrawalId}/review`。
- admin -> gateway 内部命令现在使用独立 internal service token，claim 至少包含 `iss / aud / sub / adminWallet / scope / requestId / bodySha256 / actorAdminId / actorRole / jti`，不再复用普通 owner JWT 语义。
- admin 登录态现在由 `gateway-admin` 下发 `HttpOnly` session cookie；`/api/admin/v1/auth/login` 不再把 access token 回传给浏览器。
- cookie 会话模式下，`/api/admin/v1/auth/login` 与 `/api/admin/v1/auth/me` 还会返回会话绑定的 `csrfToken`；`admin-front` 只保存在内存里，并自动给 `POST / PATCH / DELETE` 请求附带 `X-CSRF-Token`。
- 当 Google Authenticator 开关开启时，`/api/admin/v1/auth/login` 需要 6 位 TOTP；高风险动作还需要 `X-Admin-OTP-Code`。
- 默认 bootstrap / demo 管理员 TOTP secret 已写入 seed payload，值为 `JBSWY3DPEHPK3PXP`，仅供本地开发把账号先加入 Google Authenticator，生产必须改成独立发放与轮换机制。
- gateway-admin 现在会在服务启动后自动拉起 execution worker，周期性扫描 `PENDING` execution jobs 并执行，不再依赖手动 retry 才能推进。
- 新增菜单配置中心后，持久化数据库需要执行 `migrations/003_admin_config_center_schema.sql`，否则 `/api/admin/v1/config/menu-items` 无法在 PostgreSQL 模式下工作。

第一期建议优先实现：

1. `admin_auth` 路由
2. `admin_dashboard` 路由
3. `admin_finance` 路由
4. `admin_audit` 路由
5. `approval` 服务
6. `gateway_client` 适配层

注意：

- 不建议直接复用 `gateway/src/domain` 作为内部强依赖。
- 建议通过内部 DTO、契约和适配层与 `gateway/` 交互。
- `gateway 只读投影表` 的意思是：由 gateway 真相表和运行态状态派生出来、专门给后台读取的读模型。当前第一版物理实现是 SQL view，不是新的可写资金表。
- 第一版接口契约见 `../../docs/admin/Admin_API_Contract_Phase1.md`。
- 第一版数据库设计见 `../../docs/admin/Admin_Database_Design.md`。
