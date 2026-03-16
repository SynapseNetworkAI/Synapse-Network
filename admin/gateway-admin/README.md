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
3. `dashboard` 路由
4. `approval` 路由
5. 基础 schema / service / adapter 分层
6. 第一版 API contract 文档
8. 第一版 PostgreSQL migration：`migrations/001_admin_control_plane_schema.sql`
9. 第一版 domain / storage skeleton：`src/domain/`、`src/storage/`

启动方式：

```bash
docker-compose -f docker-compose/docker-compose.yml up -d postgres
cd admin/gateway-admin
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
sh scripts/ops/start.sh
```

常用运维命令：

```bash
sh scripts/ops/start.sh
sh scripts/ops/stop.sh
sh scripts/ops/restart.sh
sh scripts/ops/status.sh
```

运维说明见 `docs/运维手册.md`。

本地 PostgreSQL 缺省连接：

```bash
ADMIN_DATABASE_DSN=postgresql://synapse_admin_app:12345678@localhost:5432/synapse_gateway_admin
GATEWAY_READONLY_DSN=postgresql://synapse_gateway_ro:12345678@localhost:5432/synapse_gateway
GATEWAY_INTERNAL_BASE_URL=http://localhost:8000
GATEWAY_INTERNAL_ADMIN_WALLET=0xYourGatewayAdminWallet
GATEWAY_INTERNAL_JWT_SECRET=replace-this-with-a-32-byte-minimum-jwt-secret
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
- gateway-admin 现在会在服务启动后自动拉起 execution worker，周期性扫描 `PENDING` execution jobs 并执行，不再依赖手动 retry 才能推进。

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
