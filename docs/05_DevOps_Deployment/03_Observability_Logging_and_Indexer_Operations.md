# Observability, Logging, and Indexer Operations

## 1. 目标

本文件定义 Synapse 如何在运行中观察请求、扣费、风控和链上入金同步状态。

关键结论是：

**没有观测，就没有金融基础设施。**

## 2. 观测对象

生产环境最重要的观测对象包括：

1. Gateway 请求链路
2. Quote / Invoke 成功率
3. Deposit Indexer 运行状态
4. Reconciliation 偏差
5. Withdrawal 风险队列
6. Admin 审批积压

## 3. 应用日志标准

### 3.1 最低能力要求

日志系统至少要支持：

1. JSON 结构化输出
2. request-scoped context 绑定
3. 异步写入
4. 轮转和保留策略
5. 敏感字段脱敏

### 3.2 每条日志最少字段

1. `timestamp`
2. `level`
3. `request_id`
4. `action`
5. `owner_id` 或等价 scope
6. `service_id` 或 `provider_id`
7. `latency_ms`

### 3.3 建议动作分类

1. `request_enter`
2. `auth_decision`
3. `quote_validation`
4. `forwarding_start`
5. `forwarding_error`
6. `billing_capture`
7. `billing_release`
8. `risk_decision`
9. `request_exit`

## 4. 日志与安全边界

生产日志必须遵守：

1. 不打印 token、secret、signature、私钥材料
2. 不暴露内部 SQL、堆栈或 schema 细节给外部表面
3. 对外错误表面与内部日志表面分层

## 5. Deposit Indexer 运行原则

### 5.1 模块职责

充值链路至少包含：

1. `chain`
2. `processing`
3. `backfill`
4. `reconciliation`
5. `runner`

### 5.2 一致性目标

索引器要保证：

1. 入金先进入 `consumer_pending`
2. 确认后原子迁移到 `consumer_available`
3. backfill 能找回漏扫
4. reconciliation 能发现链上义务与平台账本偏差

### 5.3 `lastScannedBlock` 的语义

`lastScannedBlock` 只是补扫游标，不是余额真相源。

修改它的意义是允许重新扫描，不代表系统可以绕过正式修复路径直接补账。

## 6. 生产修复原则

当充值同步异常时，优先级应该是：

1. replay
2. backfill
3. reconciliation
4. 审计复核

禁止把“手工改余额”当作标准修复方式。

## 7. 最小巡检面板

生产环境至少要有以下面板或聚合视图：

1. Gateway p50 / p95 / error rate
2. deposit confirmation lag
3. reconciliation delta
4. invocation success rate by service
5. withdrawal risk queue size
6. nightly ops check status

## 8. 文档结论

观测体系的目标，不是“多打一堆日志”，而是让平台能快速回答：

1. 谁在调用
2. 钱有没有被正确记账
3. 链上和账本有没有偏差
4. 哪个服务、哪个 Owner、哪个阶段出了问题