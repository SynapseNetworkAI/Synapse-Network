# 管理后台 PostgreSQL 部署与账号权限设计

本文给出一版可直接落地的生产推荐方案，同时兼容当前本地 Docker 初始化方式。

## 1. 总体结论

生产推荐采用：

- `synapse_gateway`：交易网关主库，只承载资金账本、充值/扣费/退款/提现、运行态状态等资金真相数据。
- `synapse_gateway_admin`：管理后台控制面数据库，只承载管理员身份、RBAC、审批流、执行任务、审计与合规数据。

这不是“一个库两个 schema”的最终形态，而是“两套独立数据库，同实例可接受、同集群更好、独立实例最佳”的控制平面隔离方案。

## 2. 推荐部署分层

推荐从低到高分三档：

### A. 本地开发 / Demo

- 一个 PostgreSQL 实例
- 两个数据库：`synapse_gateway`、`synapse_gateway_admin`
- gateway 与 admin 各自使用独立应用账号
- 只允许 bootstrap 超级用户在初始化阶段建库、建表、发放权限

### B. 早期生产

- 一个 PostgreSQL 集群
- 两个独立数据库
- 两套备份策略可先复用同一套物理备份，但要分开恢复演练
- 网关与后台通过独立账号、独立连接池、独立告警指标运行

### C. 严格生产

- gateway 与 admin 分离到两个独立 PostgreSQL 实例或独立托管集群
- admin 库开启更严格的访问白名单、审计、慢查询与只读副本策略
- 网关主库优先保障交易链路延迟与可用性，admin 库优先保障审计完整性与隔离性

## 3. 账号模型

每个数据库至少拆成 3 类账号：

- bootstrap / DBA：只用于初始化建库、建角色、扩展安装、灾备恢复
- migrator：只用于 schema migration、DDL 变更
- app：只用于线上服务读写 DML
- readonly：只用于报表、BI、审计查询、人工排障只读访问

建议命名：

- `synapse_gateway_migrator`
- `synapse_gateway_app`
- `synapse_gateway_ro`
- `synapse_admin_migrator`
- `synapse_admin_app`
- `synapse_admin_ro`

## 4. 权限边界

### gateway 库

- `synapse_gateway_app`：只拥有 `CONNECT`、schema `USAGE`、表级 DML、序列使用权限
- `synapse_gateway_ro`：只拥有 `CONNECT`、schema `USAGE`、表级 `SELECT`
- 不给应用账号 `CREATE DATABASE`、`CREATE ROLE`、`SUPERUSER`
- 不建议长期让网关服务使用 bootstrap 超级账号直连

### admin 库

- `synapse_admin_app`：只允许访问 admin 控制面表
- `synapse_admin_ro`：只读访问审批、审计、合规查询表
- admin 服务不得写入 `synapse_gateway` 真相资金表
- 管理后台如需查看交易数据，优先通过受控内部 API 或专门的只读投影实现

## 5. 网络与连接建议

- gateway 服务只持有 `synapse_gateway_app` 的连接串
- admin 服务持有 `synapse_admin_app` 的连接串，以及一条专门用于 gateway 只读投影查询的 `synapse_gateway_ro` 连接串
- BI / 审计工具只持有 `*_ro` 账号
- migration job 单独注入 `*_migrator` 账号，不与业务 Pod/容器复用
- 对生产环境启用 IP allowlist、TLS、连接数上限、statement timeout、idle timeout

补充约束：

- admin 直连 gateway 时，只允许读取 gateway 暴露的只读投影对象，例如 `synapse_admin_dashboard_finance_projection`、`synapse_admin_dashboard_activity_trend_projection`、`synapse_admin_dashboard_operations_projection` 以及兼容视图 `synapse_admin_dashboard_projection`
- 不应让 admin 业务逻辑直接依赖 gateway 真相表字段来拼装 dashboard 语义
- `synapse_admin_dashboard_finance_projection` 与 `synapse_admin_dashboard_activity_trend_projection` 采用“双命名层”策略：
  - canonical 列：使用 target-state 语义，例如 `today_consumer_refund_usdc`、`today_provider_withdrawal_usdc`、`consumer_liability_usdc`
  - backward-compatible alias：继续暴露 `today_refund_usdc`、`today_withdrawal_usdc`、`owner_liability_usdc`、`refund_usdc`、`withdrawal_usdc`、`pending_withdrawal_count`
- 这样做的目的不是鼓励新代码继续依赖旧别名，而是避免旧的 `gateway-admin` 版本在数据库视图升级时直接失联；新代码优先读取 canonical 列，旧代码靠 alias 平滑过渡

## 6. 备份与恢复建议

- `synapse_gateway`：更高频 PITR、事务日志保留更长、恢复演练优先级最高
- `synapse_gateway_admin`：保留审批与审计数据的长期归档；恢复目标以审计完整性和取证为主
- 两个数据库分别做恢复演练，不要只验证“整机恢复”

## 7. 本仓库当前落地方式

当前仓库已经支持本地首次启动 PostgreSQL 时自动完成以下动作：

- 创建 `synapse_gateway_admin` 数据库
- 保留 `synapse_gateway` 作为交易网关默认数据库
- 创建以下本地开发账号：
  - `synapse_gateway_app`
  - `synapse_gateway_ro`
  - `synapse_admin_app`
  - `synapse_admin_ro`
- 自动把 `docker-compose/postgres/init/gateway-admin/003_gateway_admin_projection_views.sql` 里的 admin bootstrap 段导入到 `synapse_gateway_admin`
- 自动给 app / readonly 角色发放最小可用权限

## 8. 关于 “Cannot create a database when multi-database mode is disabled”

这个报错本质上是数据库客户端连接配置问题，不是 PostgreSQL 本身不支持多库：

- 你的客户端当前很可能以“单数据库模式”连接到了 `synapse_gateway`
- 该模式下 UI 会屏蔽 `Create Database`
- 要么在连接设置中打开 `Show all databases`
- 要么改连 `postgres` / server 级连接后再建库

但在本仓库里，推荐做法是不再手工在 GUI 里建库，而是直接使用现在这套 Docker bootstrap。这样容器首次初始化时就会自动把两个数据库建好。

## 9. 本地重建步骤

如果你之前已经启动过旧版单库容器，需要重新初始化数据卷：

```bash
docker-compose -f docker-compose/docker-compose.yml down -v
docker-compose -f docker-compose/docker-compose.yml up -d postgres
```

完成后可使用以下连接：

```bash
# gateway
postgresql://synapse_gateway_app:12345678@localhost:5432/synapse_gateway

# admin
postgresql://synapse_admin_app:12345678@localhost:5432/synapse_gateway_admin
```

## 10. Projection View 设计文档

- `docker-compose/postgres/init/gateway-admin/003_gateway_admin_projection_views.sql` 的逐段设计说明、CTE 角色和字段含义见 `Gateway_Admin_Projection_Views_SQL_Design.md`