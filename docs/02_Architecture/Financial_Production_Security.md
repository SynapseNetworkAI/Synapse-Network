# Build-for-Agent Financial Production Security Baseline

## 1. Scope

本基线定义 Synapse 生产环境中与资金强相关的控制面：

1. Owner 入金与余额查询
2. Agent 消费与调用结算
3. 消费侧退款
4. Provider 收益累计与提现
5. 审计查询、运行时状态、风控与人工审核

## 2. 不可突破底线

1. 默认拒绝，所有金融接口都必须绑定有效 session。
2. owner scope 必须从服务端身份上下文推导，禁止相信客户端自报。
3. 所有资金变动都必须原子化、可回滚、可审计。
4. 高频性能不能以牺牲资金一致性为代价。
5. 提现和退款属于出金动作，必须受风控与审核控制。

## 3. 已完成或必须保持的生产控制

### 3.1 Authentication and Owner Isolation

1. 金融接口默认要求有效 session。
2. 所有 owner-scoped 读写都由 token subject 绑定。
3. 跨 owner 数据读取和写入必须被服务端过滤与拒绝。

### 3.2 Idempotency and Replay Protection

1. 入金登记、退款申请、提现申请都必须要求幂等键。
2. 相同幂等键但不同请求体必须返回冲突。
3. 同一链上 `tx_hash` 只能被登记一次。
4. 幂等存储必须具备 TTL 与容量治理，防止无限膨胀。

### 3.3 Atomic Mutation Controls

1. 余额变动禁止走内存快照回写模式。
2. 关键扣减路径必须使用行级锁或等价原子条件更新。
3. 一次成功调用的记账事务至少包含：
   - 消费侧余额变动
   - Provider 收益累积
   - 平台费累积
   - ledger entry
   - audit event
4. 任一步失败都必须整体回滚。

### 3.4 Auditability

1. 所有关键资金动作必须附带 `request_id`、actor、owner、amount、result、timestamp。
2. 审计日志必须 append-only。
3. 金融审计与系统行为日志要按 domain 分流，避免污染风险口径。

### 3.5 Runtime State Isolation

1. 运行时 checkpoint 必须写入 typed state store。
2. checkpoint 只能记录扫描进度、对账状态、告警状态，不能直接充当资金真相源。
3. 余额与 intent 不能再依赖整表 delete + rewrite 风格的兼容通道。

## 4. 资金链路安全要求

### 4.1 Owner Deposit

1. 入金先记 `consumer_pending`，确认后转 `consumer_available`。
2. `tx_hash` 去重必须同时有应用层检查和数据库唯一约束。
3. 充值确认、修复、回放都必须保持幂等。

### 4.2 Agent Charge and Settlement

1. 调用前必须完成 credential、budget、quote、rate limit、consumer balance 校验。
2. 调用成功后，一次事务内完成 capture 和多桶入账。
3. 调用失败只允许释放预占，不允许留下悬空扣费。
4. 若消费侧或 Provider 侧账户处于冻结或限制状态，必须阻断高风险路径。

### 4.3 Consumer Refund

1. 退款必须关联原始调用或原始入金事实。
2. 退款金额不能超过可退余额上限。
3. 默认只能退回 owner 原地址或等价受控回款地址。
4. 大额或异常拆分退款必须进入人工审核。

### 4.4 Owner-as-Provider Withdrawal

1. 同一个 Owner 作为 Provider 发起提现时，只能动用供给侧收益桶。
2. 提现前必须检查：
   - `provider_receivable` 是否足够
   - 近 24h 累计提现额度
   - 账户年龄和净收入沉淀
   - 地址风险、设备风险、行为突变
   - 金库流动性等级
3. 风控决策必须输出 `green / yellow / red`：
   - `green`：自动签发出金票据
   - `yellow`：转入 `provider_locked`，进入人工审核
   - `red`：拒绝、审计、告警、限制观察
4. 人工审核必须记录 reviewer、decision、reason、evidence。

## 5. 分布式控制

1. 金融写操作必须具备跨实例互斥机制。
2. Redis 可用于分布式锁、幂等与速率计数，但 PostgreSQL 事务仍是最终一致性锚点。
3. Redis 短时故障时，可切到进程内降级锁，但不得取消安全检查。

## 6. 运行配置要求

关键配置必须覆盖：

1. 幂等 TTL 与容量上限
2. replay window
3. 金融写速率限制
4. 提现自动放行阈值
5. 提现 24h 窗口阈值
6. 风险地址名单与人工审核阈值
7. JWT / AUTH secret 强度

## 7. 文档契约

1. 任何涉及资金接口、状态机、字段语义、风控口径的变化，都必须同步修改本文件。
2. 代码、数据库 bootstrap、测试、文档必须同批更新。
3. 如果实现仍残留历史命名，也不得再让该命名主导架构叙事。

## 8. 结论

Synapse 的金融生产安全，不是单点 API 校验集合，而是 `Owner funding -> Agent charge -> Provider accrual -> Withdrawal review -> Onchain release` 的整条事实链安全。任何一个环节允许“快但不准”，整条链都会失真。
