# Synapse 存储方案升级文档（从 Demo 到 Production）

## 1. 结论先行

PostgreSQL 不只是适合生产，而是 Synapse 当前阶段（直到日调用量突破 100 万次前）的绝对首选。

核心原因：
- 我们是支付基础设施，资金账本必须满足 ACID。
- 我们需要强事务语义来保证扣费、分账、流水写入要么全部成功，要么全部回滚。
- 相比 MySQL，PostgreSQL 在 JSONB、事务能力、可观测性扩展上更贴合网关场景。

一句话拍板：
- 现阶段采用 All-in PostgreSQL（账本 + 业务数据 + 网关日志）。
- 通过事务、行锁、幂等键、分区表，先把正确性和交付速度打满。

## 2. 业务拆解与存储分层

Synapse 的数据有两类，必须分开看：

1. 金融账本数据（强一致）
- 钱包余额
- 充值、提现、扣费、结算流水
- 要求：绝不出错，优先一致性，不接受脏账

2. 网关调用日志（高吞吐）
- request_id、路由、耗时、状态码、上下游标识
- 要求：写入快、可检索、可聚合；可容忍极低概率延迟落库

结论：
- 账本路径必须强事务 + 强约束。
- 日志路径先用 PostgreSQL 分区承接，后续按量级演进到专用分析存储。

## 3. 主流方案对比（针对 Synapse）

## 3.1 方案 A：All-in PostgreSQL（当前推荐）

做法：
- 账本表、用户表、服务表、日志表全部在一个托管 PostgreSQL 集群。

优点：
- 架构最简单，研发推进速度最快。
- 事务能力强，账本正确性最容易做对。
- JSONB 适合承载网关动态参数与扩展字段。

缺点：
- 当日志量暴涨时，主库 I/O 与索引膨胀会成为瓶颈。

适用区间：
- 日调用量 <= 100 万，且团队以交付速度优先。

## 3.2 方案 B：MySQL

结论：
- 非必须不切换。

原因：
- 虽然成熟，但对我们现阶段并无决定性收益。
- 在动态 JSON 数据与复杂事务可读性上，PostgreSQL 更顺手。

## 3.3 方案 C：PostgreSQL + Redis（下一阶段）

做法：
- Redis 承担两件事：
  - 防重放/防连击（request_id 锁）
  - 高频预扣减（原子 DECR / Lua）
- 最终账本异步或批量回写 PostgreSQL（仍以 PG 为最终真相源）。

收益：
- 显著降低主库写放大。
- 降低网关热路径延迟。

## 3.4 方案 D：PostgreSQL + ClickHouse（日志规模化）

触发条件：
- 日志达到亿级/天，分析查询成为核心瓶颈。

做法：
- 资金账本继续留在 PostgreSQL。
- 网关日志通过消息队列异步导入 ClickHouse。

收益：
- 高基数时序检索和聚合性能显著提升。

## 4. 当前阶段的硬规则（必须执行）

1. 资金类写操作必须在单事务内完成
- 典型路径：扣买家余额 -> 加卖家应收 -> 写账本流水。
- 任何一步失败，整笔回滚。

2. 余额修改必须使用悲观锁
- 读余额时使用 SELECT ... FOR UPDATE。
- 禁止先查后改且无锁，避免并发超扣。

3. 幂等必须是第一等公民
- 每个扣费请求必须带 request_id（或幂等键）。
- 数据库层加唯一约束，杜绝重复入账。

4. 平台费率常量化
- PLATFORM_FEE_RATE 与 GATEWAY_ROUTING_TAX 固定在后端配置常量中。
- 禁止每次实时查库，避免热路径抖动。

5. 日志表从 Day-1 做分区
- 按天或按月分区，避免单表膨胀。
- 保留周期与归档策略提前定义。

## 5. PostgreSQL 生产基线配置建议

## 5.1 事务与隔离
- 默认使用 READ COMMITTED。
- 资金冲突高的关键事务可按需提高到 REPEATABLE READ。
- 严禁在事务中执行外部网络调用。

## 5.2 索引与约束
- ledger_entries(request_id) 唯一索引。
- balances(owner_wallet) 唯一索引。
- gateway_logs(created_at) 与 (request_id) 索引。

## 5.3 分区策略
- gateway_logs 按时间分区（推荐按月，流量很大时按天）。
- 分区创建任务自动化，避免临界日写入失败。

## 6. Repository 契约升级（SQL Table -> Pydantic Entity）

为彻底消除 `Dict[str, Any]` 在仓储边界扩散导致的字段漂移风险，网关存储层已升级为“表实体驱动”。

强制规则：
- 每张 SQL 业务表必须对应一个 Pydantic 实体（定义于 `gateway/src/domain/storage_entities.py`）。
- `gateway/src/storage/postgres/repositories/` 的方法入参/返回值使用实体对象，不再直接吞吐裸字典。
- 仓储 SQL 必须按列读写，不依赖历史 `payload` JSONB 影子字段。

关键映射（示例）：
- `synapse_deposit_intents` -> `DepositIntentRow`
- `synapse_refund_intents` -> `RefundIntentRow`
- `synapse_withdrawal_intents` -> `WithdrawalIntentRow`
- `synapse_usage_log` -> `UsageLogRow`
- `synapse_credentials` -> `CredentialRow`
- `synapse_service_registry` -> `ServiceRegistryRow`
- `synapse_idempotency_keys` -> `IdempotencyKeyRow`

收益：
- 字段语义由实体静态约束，避免 key 拼写错误和隐式缺字段。
- 仓储层和 SQL 契约一一对应，迁移/审计路径可验证。
- 上层服务可以渐进转换，但底层账本与持久化边界已强类型化。

## 5.4 备份与恢复
- 启用自动备份（每日全量 + WAL 增量）。
- 每月至少一次恢复演练，验证 RTO/RPO。

## 5.5 可观测性
- 开启慢查询日志与 pg_stat_statements。
- 对锁等待、死锁、连接数、复制延迟设置告警。

## 6. 演进路线（避免过度工程化）

Phase 1（现在）：
- All-in PostgreSQL + 分区日志 + 严格事务行锁。

Phase 2（压力上来后）：
- 增加 Redis，仅用于防重放锁与热点预扣减。

Phase 3（日志爆发后）：
- 日志异步分流到 ClickHouse，PG 专注资金真账本。

## 7. 上线前验收标准

满足以下条件才可进入生产：
- 资金路径具备事务回滚与幂等唯一约束。
- 并发压测下无超扣、无负余额、无重复记账。
- 有备份策略且通过一次真实恢复演练。
- 日志表分区与归档策略已启用。
- 监控告警与审计字段完整（request_id, actor, amount_delta, result）。

## 8. 结语

先把一套数据库打磨到金融级可靠，再谈分布式扩张。

这不是保守，这是基础设施团队最硬核的工程纪律：
- 正确性优先
- 可审计优先
- 演进式扩容优先

## 9. 关系化落地基线（已执行）

为消除 Demo 阶段的通用 JSON collection 存储，本轮后端已切换为“按领域建表 + repository 专用接口”模式。

### 9.1 已关系化的核心表

- 资金域：
  - `synapse_balances`
  - `synapse_deposit_intents`
  - `synapse_refund_intents`
  - `synapse_withdrawal_intents`
  - `synapse_usage_log`
  - `synapse_processed_deposit_events`
  - `synapse_deposit_dedup`
  - `synapse_withdraw_tx_dedup`
- 平台配置与会话域：
  - `synapse_router_config`
  - `synapse_platform_fee_policy_default`
  - `synapse_platform_fee_policy_owner`
  - `synapse_wallet_roles`
  - `synapse_auth_sessions`
- 服务注册与健康域：
  - `synapse_service_registry`
  - `synapse_service_target_health`
  - `synapse_service_target_health_history`
- 凭据域：
  - `synapse_credentials`
- 风险控制域：
  - `synapse_idempotency_keys`
  - `synapse_finance_rate_limit`

### 9.2 执行规则

1. 业务层禁止直接读写通用 collection。
2. 路由层只调用 service；service 只调用 repository；repository 只调用 SQL/typed 表访问。
3. 资金路径优先使用原子 SQL（行锁/条件更新）与唯一约束，禁止内存账本读改写。
4. 任意新增资金字段，必须先落关系表和索引，再开放 API 字段。

### 9.3 兼容策略

兼容策略仅保留 legacy collection 迁移窗口；业务主路径不再依赖 storage facade passthrough。

### 9.4 PostgresStorage 分层重构（已执行）

为消除 `postgres_impl.py` 的 God Object 风险，本轮完成了连接管理与领域仓储拆分：

1. 连接与事务层：
  - `src/storage/postgres/database_manager.py`
2. 领域仓储层：
  - `src/storage/postgres/repositories/fee_policy_repository.py`
  - `src/storage/postgres/repositories/idempotency_repository.py`
  - `src/storage/postgres/repositories/audit_log_repository.py`
  - `src/storage/postgres/repositories/balance_repository.py`
  - `src/storage/postgres/repositories/service_registry_repository.py`
  - `src/storage/postgres/repositories/credential_auth_repository.py`
  - `src/storage/postgres/repositories/gateway_state_repository.py`
  - `src/storage/postgres/repositories/finance_atomic_repository.py`
  - `src/storage/postgres/repositories/legacy_collection_repository.py`
3. 门面层：
  - `src/storage/postgres_impl.py` 仅保留连接管理、原子事务入口与 legacy collection 兼容入口，不再承载 gateway/balance/audit/registry/credential/fee/idempotency 的 read/write passthrough。
  - `src/storage/repository_provider.py` 升级为 Facade + Unit of Work：
    - `SynapseDataManager`
    - `SynapseUnitOfWork`
    - `FinanceDomain` / `SystemDomain` / `AuditDomain`
  - 路由与服务层统一通过 `storage.get_data_manager()` 访问仓储聚合：
    - `storage.get_data_manager().finance.*`
    - `storage.get_data_manager().system.*`
    - `storage.get_data_manager().audit.*`
  - `src/storage/postgres/direct_repo_access.py` 简化为 facade 直达入口，不再维护 Protocol 迷宫与 helper 回退分支。
  - 历史壳层 `src/storage/finance_repository.py` / `src/storage/registry_repository.py` / `src/storage/credential_repository.py` 已移除。

### 9.5 Schema 生命周期策略（已执行）

为避免应用启动期隐式 DDL 造成环境漂移，`PostgresStorage` 已移除启动时自动建表/验表逻辑（`_ensure_schema`）。
同时，`src/storage/postgres_impl.py` 内历史 `CREATE TABLE/INDEX/ENUM` 常量定义已清理，运行时不再保留任何建表 SQL。

执行规则：
1. 表结构与索引变更统一由 migration 流程管理，不在应用进程启动时执行。
2. 应用进程仅负责连接、读写与事务，不负责 schema 创建。
3. Dev/Stage/Prod 统一依赖同一 migration 事实源，避免“本地可跑、线上缺表”分叉。

### 9.6 剩余业务语义归位（已执行）

本阶段将 `postgres_impl.py` 中最后两类高耦合逻辑完成归位：

1. `finance_atomic_repository.py`
  - 负责充值确认、扣费记账、提现风控决策、提现预留与去重写入等 ACID 原子事务路径。
2. `legacy_collection_repository.py`
  - 负责通用 collection 兼容读写（迁移窗口使用）与审计 collection 兼容写入。

最终目标：门面层只暴露 typed storage API，不承载跨领域 SQL 编排细节。

### 9.7 领域实体层 — 全局 Dict → Pydantic 强类型（已执行）

为杜绝业务层使用裸 `Dict[str, Any]` 传递账本、费率、审计等核心数据时的"拼错 key / 漏字段 / 类型不明"风险，本轮在仓储层与服务层之间新增**独立领域实体层**。

#### 新增文件

- `src/domain/__init__.py` — 模块出口（9 个实体）
- `src/domain/finance.py` — `BalanceLedger` / `PlatformFees` / `FeePolicyEntity`
- `src/domain/audit.py` — `AuditLogEntry`
- `src/domain/gateway.py` — `RouterConfigRow`（Phase 2）
- `src/domain/idempotency.py` — `IdempotencyRow` / `RateLimitRow`（Phase 2）
- `src/domain/registry.py` — `ServiceTargetHealth` / `ServiceTargetHealthHistory`（Phase 2）

#### 实体设计规范

| 规则 | 说明 |
|------|------|
| 基类 | Pydantic v2 `BaseModel`（`ConfigDict(populate_by_name=True)`） |
| 字段命名 | Python snake_case 属性 + `Field(alias="camelCase")` 双向访问 |
| DB 写入 | `entity.model_dump(by_alias=True)` 序列化为 camelCase JSONB |
| DB 读取 | `Entity.model_validate(dict)` 从 JSONB 反序列化；列映射表直接构造实体 |
| 默认值 | 所有字段带默认值，消除上层 defensive `.get()` / `.setdefault()` |

#### 仓储签名变更

| 仓储 | 旧签名 | 新签名 |
|------|--------|--------|
| `BalanceRepository.read_balance_ledger()` | `→ Dict[str, Any]` | `→ BalanceLedger` |
| `BalanceRepository.write_balance_ledger()` | `(dict)` | `(BalanceLedger)` |
| `FeePolicyRepository.get_platform_fee_policy()` | `→ Dict[str, Any]` | `→ FeePolicyEntity` |
| `AuditLogRepository.append_audit_row()` | `(dict)` | `(AuditLogEntry)` |
| `AuditLogRepository.read_audit_rows()` | `→ List[Dict]` | `→ List[AuditLogEntry]` |
| `GatewayStateRepository.read_router_config_rows()` | `→ List[Dict]` | `→ List[RouterConfigRow]` |
| `GatewayStateRepository.write_router_config_rows()` | `(List[Dict])` | `(List[Union[RouterConfigRow, Dict]])` |
| `IdempotencyRepository.read_idempotency_rows()` | `→ List[Dict]` | `→ List[IdempotencyRow]` |
| `IdempotencyRepository.write_idempotency_rows()` | `(List[Dict])` | `(List[Union[IdempotencyRow, Dict]])` |
| `IdempotencyRepository.read_rate_limit_rows()` | `→ List[Dict]` | `→ List[RateLimitRow]` |
| `IdempotencyRepository.write_rate_limit_rows()` | `(List[Dict])` | `(List[Union[RateLimitRow, Dict]])` |
| `ServiceRegistryRepository.read_service_target_health_rows()` | `→ List[Dict]` | `→ List[ServiceTargetHealth]` |
| `ServiceRegistryRepository.write_service_target_health_rows()` | `(List[Dict])` | `(List[Union[ServiceTargetHealth, Dict]])` |
| `ServiceRegistryRepository.read_service_target_health_history_rows()` | `→ List[Dict]` | `→ List[ServiceTargetHealthHistory]` |
| `ServiceRegistryRepository.write_service_target_health_history_rows()` | `(List[Dict])` | `(List[Union[ServiceTargetHealthHistory, Dict]])` |

#### Phase 2 设计说明

Phase 2 覆盖列映射表（column-mapped tables）：`synapse_router_config`、`synapse_idempotency_keys`、`synapse_finance_rate_limit`、`synapse_service_target_health`、`synapse_service_target_health_history`。

JSONB payload 模式表（`synapse_deposit_intents`、`synapse_refund_intents`、`synapse_withdrawal_intents`、`synapse_usage_log`、`synapse_service_registry`、`synapse_credentials`）因存储整 dict 为 JSONB 且上游 mutation 点众多（20+ 处），列入后续 Phase 3 范围。

Phase 2 write 方法保留 `Union[Entity, Dict]` 双模式兼容，确保过渡期零回归。

#### 上层迁移模式

```python
# Before (Dict)
ledger = repo.read_balance_ledger() or {}
buyers = ledger.get("buyers") if isinstance(ledger.get("buyers"), dict) else {}
buyers[owner] = round(float(buyers.get(owner, 0.0)) + amount, 6)
ledger["buyers"] = buyers

# After (Entity)
ledger = repo.read_balance_ledger()
ledger.buyers[owner] = round(float(ledger.buyers.get(owner, 0.0)) + amount, 6)

# Phase 2 — router config
row = next((r for r in rows if r.owner_address == owner), None)
row.daily_limit_usdc = round(float(new_limit), 6)

# Phase 2 — rate limit
matched.count = matched.count + 1
matched.updated_at = now
```

#### 执行规则

1. Finance / Audit / Gateway / Idempotency / Registry 列映射领域的 repository 入参和返回值必须为领域实体，禁止再用 `Dict[str, Any]`。
2. 新增领域时先定义实体再实现仓储，确保类型约束前置。
3. InMemoryStorage 测试替身同步遵守实体签名（`model_validate` / `model_dump`）。

执行收益：
1. SQL 逻辑按领域聚合，后续功能迭代与单测更可控。
2. 连接事务逻辑集中，减少重复 commit/rollback 样板。
3. 在不改变上层 service API 的前提下完成渐进重构，降低回归风险。
