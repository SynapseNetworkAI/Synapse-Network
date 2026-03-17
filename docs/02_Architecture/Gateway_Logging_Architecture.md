# Gateway Request, Billing, and Audit Logging Architecture

## 1. 文档目标

本文档定义 Platform Gateway 在处理 Agent 付费调用时的事实链日志设计，目标是让每一次调用都具备可追踪、可对账、可审计的统一证据链。

## 2. 核心对象

每次调用至少要产生以下关联键：

1. `request_id`
2. `trace_id`
3. `quote_id`
4. `invocation_id`
5. `ledger_reference`
6. `audit_event_id`

这些键不是“调试信息”，而是资金事实索引。

## 3. Request ID 生命周期

1. Agent SDK 可主动传入 `X-Request-Id`。
2. 如果未传，Gateway 在入口处生成唯一 request id。
3. Gateway 向 Provider 转发请求时必须透传同一 request id。
4. 所有日志、计费、审计、告警都必须绑定该 request id。

对账链读法：

`Agent -> Gateway request log -> invocation ledger -> audit event -> Provider execution log`

## 4. 日志分层

### 4.1 Access Log

记录入口请求事实：

1. 请求时间
2. owner scope
3. agent id / credential id
4. service id
5. request id
6. status code
7. latency

### 4.2 Billing Log

记录计费与结算事实：

1. quote price
2. captured amount
3. consumer bucket delta
4. provider receivable delta
5. platform fee delta
6. settlement status

### 4.3 Audit Log

记录风控与关键动作事实：

1. actor
2. owner
3. action type
4. risk level
5. result status
6. reviewer metadata
7. evidence summary

## 5. 存储演进策略

### 5.1 Early Stage

1. 本地结构化文件或轻量 DB。
2. 目标是验证 request id 贯通与字段完整性。

### 5.2 Growth Stage

1. PostgreSQL 作为真实事实库。
2. 使用异步写入或后台任务，避免阻塞主调用链。
3. 通过 SQL 视图做 admin projection 与对账查询。

### 5.3 Production Scale

1. Gateway 主路径只做最小必要事实写入。
2. 大规模检索、归档、风控分析可下沉到消息队列和分析系统。
3. 不论检索层怎么演进，PostgreSQL 账本与审计仍是资金真相锚点。

## 6. 设计原则

1. 所有日志都必须围绕 request id 组织。
2. 计费日志与应用日志不能混成一锅。
3. 风控日志必须可追溯到具体 owner、invocation、ledger action。
4. 日志系统可以异步，资金事实写入不能丢。

## 7. 立即执行要求

1. 所有网关入口必须注入 request id。
2. 所有 Provider 转发必须透传 request id 与 trace context。
3. 所有计费与审计日志必须输出结构化 JSON。
4. 所有 Admin 投影和对账查询必须基于数据库事实，而不是运行时内存统计。
