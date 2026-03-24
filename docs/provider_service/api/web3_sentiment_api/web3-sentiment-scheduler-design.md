# Web3 Sentiment 独立 Scheduler 生产级设计与实施计划

## 1. 目标

本设计文档解决的问题不是“adapter 怎么抓”，而是“如何把当前 request-time fetch 升级成 production-ready 的后台预抓取系统”。

目标：

1. 把热点 `symbol` 的情绪快照从按请求现抓，升级为后台 warm snapshot 模式
2. 让 API 请求优先读取新鲜 snapshot，而不是每次都直接打 3 个上游 source
3. 降低上游免费接口抖动对前台调用延迟的影响
4. 为后续 source quality dashboard、回放、告警、限频与 circuit breaker 打基础

## 2. 当前现状

当前运行时已经具备以下能力：

1. `Alternative.me` 与 `Binance` 两个 adapter 真实接入
2. 单源 timeout、retry、backoff 已实现
3. source telemetry 已落库到 `provider_sentiment_raw_feeds`
4. 聚合结果已落库到 `provider_sentiment_snapshots`
5. 全部 live source 失败时可回退到最近一次 persisted snapshot

但现在仍然存在一个核心瓶颈：

1. 前台请求是 request-time fetch
2. 只要缓存 miss，就会在请求链路里直接打当前运行时的 2 个上游 source
3. API latency 与上游 source latency 强耦合
4. 没有后台 refresh 机制，snapshot 不能被主动保温

## 3. 为什么必须引入独立 Scheduler

如果不引入 scheduler，会出现 4 个生产问题：

1. 前台请求尾延迟不稳定，source 一抖动就把 invoke latency 拉高
2. 热点 symbol 会反复命中同一批上游 source，浪费 source quota
3. 无法把 freshness SLA 和请求生命周期解耦
4. 无法做统一的 refresh policy、并发控制和失败恢复

所以生产级 V2 的核心不是“继续往 endpoint 里塞更多重试”，而是把抓取动作从同步请求链路里拆出来。

## 4. 设计原则

1. `provider_service` 仍然是 Provider runtime，不承担 Gateway 控制面或平台任务编排职责
2. scheduler 是 provider-side runtime 内部组件，不暴露为新的外部控制面
3. 前台 endpoint 负责读 snapshot 和触发必要的补抓，不直接管理调度生命周期
4. source fetch policy、聚合规则、持久化逻辑继续复用现有 service / repository 层，不复制第二套逻辑
5. scheduler 必须可关闭，避免本地开发和单机调试被后台循环污染

## 5. 目标架构

建议新增 4 个内部模块：

1. `scheduler_config`
   - 管理 enable 开关、周期、目标 symbol 列表、批次大小、并发度
2. `scheduler_registry`
   - 管理哪些 snapshot key 需要后台 refresh
3. `scheduler_runtime`
   - 启动异步循环、分批派发 refresh job、收集结果
4. `scheduler_state_repository`
   - 记录 refresh lease、最近运行时间、失败次数、下次调度时间

建议目录：

```text
provider_service/app/
  services/
    sentiment/
      scheduler.py
      scheduler_state.py
      scheduler_registry.py
```

如果后续复杂度继续上升，再拆成 `scheduler/` 子目录，不要一开始过度切文件。

## 6. 调度模型

### 6.1 任务粒度

调度的基本单位不是“source”，而是 `snapshot_key`：

1. `(symbol, chain, lookback_hours, include_narrative)`
2. 一个 `snapshot_key` 刷新时，内部再并发抓 3 个 source

原因：

1. 当前聚合结果天然围绕 snapshot key 组织
2. 现有 repository 也是按 snapshot key 存取
3. 这样可以复用当前 `build_sentiment_snapshot` 的编排骨架

### 6.2 触发方式

生产级形态建议同时支持两类触发：

1. `periodic refresh`
   - 固定周期刷新热点 snapshot
2. `on-demand repair`
   - 前台请求命中过旧 snapshot 或完全 miss 时，触发一次补抓

结论：

1. scheduler 负责保温
2. endpoint 负责兜底
3. 两者不是二选一关系

## 7. Snapshot 新鲜度策略

建议把 freshness policy 分成三层：

1. `fresh`
   - 直接返回，不触发同步 live fetch
2. `stale-but-servable`
   - 当前请求先返回旧 snapshot
   - 同时异步提交 refresh
3. `expired`
   - 如果没有可用 snapshot，则请求链路执行补抓

建议默认阈值：

1. `fresh_ttl_s = 60`
2. `stale_ttl_s = 300`
3. `hard_expire_s = 900`

当前已有 300 秒进程内缓存，但 scheduler 引入后，TTL 判断要统一收口到 snapshot freshness policy，不能让内存缓存和持久化快照各自为政。

## 8. 调度对象集合

V1 scheduler 不应该一上来就抓所有组合，而是只抓白名单。

建议默认集合：

1. `BTC / market-wide / 24h / narrative_on`
2. `ETH / market-wide / 24h / narrative_on`
3. `SOL / market-wide / 24h / narrative_on`
4. `ETH / ethereum / 24h / narrative_on`
5. `SOL / solana / 24h / narrative_on`

后续再根据实际调用量扩展。

## 9. 并发与背压控制

### 9.1 Scheduler 级并发

建议：

1. scheduler 一次只跑有限数量的 snapshot refresh task
2. 默认 `max_concurrent_snapshots = 2`

### 9.2 Source 级并发

每个 snapshot 内部仍然复用当前逻辑：

1. 2 个 source 顶层并发
2. Binance 内部 `ticker/24hr + klines` 并发

### 9.3 背压策略

如果某轮 refresh 未执行完，下一轮不应无限叠加。

建议：

1. 同一个 `snapshot_key` 只能有一个活跃 refresh
2. 未完成 job 不重复排队
3. 达到并发上限时，新任务延后，不抢占前台请求

## 10. 调度状态表设计

当前 snapshot/raw feed 表不够承载 scheduler 自身状态，建议增加一张专用表：

`provider_sentiment_scheduler_jobs`

建议字段：

1. `snapshot_key`
2. `job_owner`
3. `job_status`
4. `lease_expires_at`
5. `last_started_at`
6. `last_finished_at`
7. `last_success_at`
8. `last_failure_at`
9. `last_error_code`
10. `last_error_message`
11. `consecutive_failures`
12. `next_run_at`
13. `last_refresh_reason`
14. `updated_at`

状态值建议：

1. `idle`
2. `running`
3. `cooldown`
4. `failed`

这张表的职责不是保存业务结果，而是保存调度控制状态。

## 11. Lease 机制

即使当前只是一实例运行，也应该从一开始按多实例安全去设计。

建议：

1. refresh job 开始前先尝试获取 lease
2. lease 有 TTL，例如 `120s`
3. 持有者完成后释放 lease
4. 如果实例崩溃，lease 过期后可由下一实例接手

这样未来横向扩容时不用重写调度器。

## 12. 前台接口与 Scheduler 的协作规则

建议前台 invoke 规则改成：

1. 命中新鲜 snapshot：直接返回
2. 命中 stale-but-servable snapshot：直接返回，同时后台异步提交 refresh
3. 没有 snapshot 或 snapshot 过期：执行同步补抓
4. 同步补抓失败：回退到 persisted snapshot；如果没有 persisted snapshot，再返回错误

这个模型的核心价值是：

1. 用户请求优先拿结果
2. scheduler 负责把大部分 refresh 成本移到后台

## 13. 失败恢复策略

建议分 3 层处理：

1. `source-level retry`
   - 已有，不重复造轮子
2. `job-level cooldown`
   - 一个 snapshot 连续失败后，延长下次调度时间
3. `circuit-breaker-ready metadata`
   - 连续失败次数和最近失败时间为未来熔断做准备

建议 cooldown：

1. 第 1 次失败：`+1 min`
2. 第 2 次失败：`+3 min`
3. 第 3 次失败及以上：`+10 min`

## 14. 运维与配置项

建议新增配置：

1. `SENTIMENT_SCHEDULER_ENABLED=false`
2. `SENTIMENT_SCHEDULER_INTERVAL_S=30`
3. `SENTIMENT_SCHEDULER_MAX_CONCURRENT_SNAPSHOTS=2`
4. `SENTIMENT_SCHEDULER_LEASE_TTL_S=120`
5. `SENTIMENT_SCHEDULER_FRESH_TTL_S=60`
6. `SENTIMENT_SCHEDULER_STALE_TTL_S=300`
7. `SENTIMENT_SCHEDULER_HARD_EXPIRE_S=900`
8. `SENTIMENT_SCHEDULER_TARGETS_JSON=...`

本地默认：

1. scheduler 关闭
2. 仍然使用 request-time fetch

生产默认：

1. scheduler 开启
2. 使用固定热点白名单

## 15. 启动生命周期

建议挂到 FastAPI lifespan：

1. 服务启动时，如果 `SENTIMENT_SCHEDULER_ENABLED=true`，启动后台 task
2. 服务关闭时，优雅取消 task
3. 不允许在 router import 阶段偷偷启动

这样能保持 runtime 行为可预测，也符合 provider_service 的边界。

## 16. 观测指标

除了现有 raw feed telemetry，scheduler 还需要额外指标：

1. `scheduler_tick_started`
2. `scheduler_tick_finished`
3. `scheduler_jobs_scanned`
4. `scheduler_jobs_started`
5. `scheduler_jobs_succeeded`
6. `scheduler_jobs_failed`
7. `scheduler_jobs_skipped_due_to_lease`
8. `scheduler_job_duration_ms`
9. `snapshot_age_sec_at_read`

V1 不一定要接 Prometheus，但至少要通过结构化日志和状态表把这些信息保住。

## 17. 与当前代码的最小改造面

实现 scheduler 时，优先复用，不要重写：

1. 复用现有 3 个 adapter
2. 复用现有 source timeout/retry/backoff
3. 复用现有 snapshot/raw feed repository
4. 把 `build_sentiment_snapshot` 拆成“前台读取策略”和“底层 refresh 执行”两个层次

建议新增一个内部入口：

1. `refresh_sentiment_snapshot(payload, reason)`

这样 scheduler 和前台补抓都走同一条刷新链路。

## 18. 分阶段实施计划

### Phase 1: 可运行 Scheduler 骨架

目标：先把后台循环跑起来，不碰复杂状态机。

实现项：

1. 新增 scheduler 配置项
2. 新增热点 snapshot 白名单配置
3. 在 FastAPI lifespan 中启动/停止 scheduler task
4. 新增 `refresh_sentiment_snapshot(payload, reason)` 共享入口
5. scheduler 定时遍历白名单并执行 refresh
6. 记录结构化日志

完成判定：

1. 服务启动后可后台按周期刷新热点 snapshot
2. 前台 invoke 不再总是承担第一次热身成本

### Phase 2: Snapshot freshness policy 收口

目标：让前台读路径与后台 refresh 策略真正联动。

实现项：

1. 明确 `fresh / stale-but-servable / expired` 三档状态
2. invoke 读路径优先返回 fresh snapshot
3. stale snapshot 返回后触发异步 repair
4. hard-expired snapshot 触发同步补抓
5. 补齐对应单测和集成测试

完成判定：

1. 请求延迟与上游抖动明显解耦
2. freshness 行为在文档和测试中完全一致

### Phase 3: 调度状态表与 Lease

目标：为多实例和失败恢复做准备。

当前实现状态：已落地 `provider_sentiment_scheduler_jobs`、per-snapshot lease、`next_run_at / consecutive_failures / last_error_*` 持久化，以及 `60s / 180s / 600s` cooldown backoff。runtime repository 仍保持无 DDL 副作用，表结构通过 `docker-compose/postgres/init/gateway-providers/003_provider_sentiment_scheduler_jobs.sql` 显式初始化。

实现项：

1. 增加 `provider_sentiment_scheduler_jobs` 表
2. 引入 per-snapshot lease
3. 记录 `next_run_at / consecutive_failures / last_error_*`
4. 引入 cooldown backoff
5. 补齐 Docker init SQL 与升级 SQL

完成判定：

1. 同一 snapshot 不会被并发重复刷新
2. 单实例崩溃后可以安全恢复

### Phase 4: 生产运维增强

目标：把 scheduler 从“能跑”升级到“能运维”。

实现项：

1. 增加 scheduler health 指标
2. 增加 source quality dashboard 基础视图
3. 增加 replay / inspect CLI
4. 为 circuit breaker 预留开关与状态位

完成判定：

1. 运维能判断 scheduler 是否健康
2. source 质量劣化可以被追踪而不是靠猜

## 19. 交付顺序建议

最稳的交付顺序：

1. 先做 Phase 1，确保后台任务能跑
2. 再做 Phase 2，把 endpoint 读策略真正改成 warm snapshot 优先
3. 然后做 Phase 3，上 lease 和状态表
4. 最后做 Phase 4，补运维面

不要一上来同时改 scheduler、endpoint、表结构、熔断和控制台，不然会把回归面炸穿。

## 20. 实施边界

这次 scheduler 实施不应该做的事：

1. 不把 provider_service 变成平台任务中心
2. 不在 Gateway 引入 provider-side 调度状态
3. 不直接引入复杂消息队列
4. 不先做多租户、多优先级、多地区调度

V1 的目标很明确：

1. 用最少复杂度把热点 snapshot 后台保温
2. 让前台请求不再总是承担 live fetch 成本
3. 保持现有 service boundary 干净