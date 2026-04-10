---
created_at: 2026-04-10
updated_at: 2026-04-10
doc_status: active
---

# 08 Analytics Pipeline — Operations Guide

> 本文档描述 Synapse Analytics Pipeline 的本地开发启动、配置、验证、常见问题排查流程。
> 覆盖组件：Kafka · ClickHouse · Kafka UI · Gateway Events API。

---

## 1. 架构一览

```
Frontend (Next.js)
  └─ POST /api/v1/events ──────────────┐
                                        ▼
Gateway (FastAPI)          ──── Kafka (synapse.analytics.events)
  ├─ invoke / deposit / withdraw          │
  └─ analytics emitter.py ───────────────┤
                                        ▼
                               ClickHouse (Kafka Engine MV)
                                        │
                                        ▼
                               synapse_analytics.events
                                        │
                                  PostHog / BI query
```

- **Kafka** 是事件总线，所有事件生产者（Frontend、Gateway、Provider Service）写入同一 topic。
- **ClickHouse** 通过 Kafka Engine 自动消费事件，写入 `synapse_analytics.events` 表。
- **Kafka UI** 提供本地消息浏览（端口 8080）。
- **FileBackend** 是 Kafka 不可用时的降级方案，事件写入 `logs/analytics_events.jsonl`。

---

## 2. 本地启动

### 2.1 启动所有服务

```bash
cd infra/docker/local
docker compose up -d kafka clickhouse kafka-ui
```

等待健康检查通过（约 30 秒）：

```bash
docker compose ps
# kafka        running (healthy)
# clickhouse   running (healthy)
# kafka-ui     running
```

### 2.2 验证 Kafka 就绪

```bash
docker exec synapse-kafka kafka-topics.sh \
  --bootstrap-server localhost:9092 --list
```

### 2.3 验证 ClickHouse 就绪

```bash
curl -s http://localhost:8123/ping
# Ok.
```

查看初始化表：

```bash
curl -s "http://localhost:8123/?query=SHOW+TABLES+FROM+synapse_analytics" \
  | tr '\t' '\n'
# events
# events_kafka
# events_kafka_mv
```

---

## 3. Gateway 配置

### 3.1 环境变量

在 `services/gateway/.env.local` 中（或对应的 env 文件）配置以下变量：

```env
# 启用 Kafka 写入（staging / prod 必填；local 默认 file-only）
ANALYTICS_KAFKA_BOOTSTRAP_SERVERS=localhost:9092

# Kafka topic（默认值即可，通常不需要改）
ANALYTICS_KAFKA_TOPIC=synapse.analytics.events

# FileBackend 降级路径
ANALYTICS_FALLBACK_FILE=logs/analytics_events.jsonl

# 环境标识：local | staging | prod
# local → FileBackend only
# staging / prod → DualBackend (Kafka + file fallback)
ENVIRONMENT=local
```

> **注意**：`ENVIRONMENT=local` 时，即使配置了 Kafka 地址，Gateway 也只使用 FileBackend。
> 本地联调 Kafka 端到端时，需设置 `ENVIRONMENT=staging`。

### 3.2 依赖安装

```bash
cd services/gateway
pip install -r requirements.txt
# 确保 aiokafka>=0.11.0 已安装
```

---

## 4. 端到端验证

### 4.1 发送测试事件到 Gateway

```bash
curl -X POST http://localhost:8000/api/v1/events \
  -H "Content-Type: application/json" \
  -d '{
    "events": [{
      "event_id": "00000000-0000-0000-0000-000000000001",
      "event_name": "page_viewed",
      "timestamp": "2026-04-10T12:00:00.000Z",
      "distinct_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "source": "frontend",
      "properties": {
        "page_path": "/",
        "role": "anonymous",
        "env": "local",
        "surface": "landing"
      }
    }]
  }'
# {"accepted":1,"rejected":0,"errors":[]}
```

### 4.2 验证事件到达 Kafka

```bash
docker exec synapse-kafka kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic synapse.analytics.events \
  --from-beginning \
  --max-messages 1
```

### 4.3 验证事件写入 ClickHouse

```bash
curl -s "http://localhost:8123/" \
  --data "SELECT event_name, distinct_id, source FROM synapse_analytics.events LIMIT 5 FORMAT JSONEachRow"
```

### 4.4 用 Kafka UI 浏览消息

打开浏览器：http://localhost:8080

选择 `local` cluster → Topics → `synapse.analytics.events` → Messages。

---

## 5. FileBackend 验证（无 Kafka 场景）

当 `ENVIRONMENT=local` 时，所有事件写入：

```
services/gateway/logs/analytics_events.jsonl
```

验证命令：

```bash
tail -f services/gateway/logs/analytics_events.jsonl | python3 -m json.tool
```

---

## 6. 运行单元测试

```bash
cd services/gateway
source .venv/bin/activate
pytest tests/unit/test_analytics_emitter_unit.py \
       tests/unit/test_events_router_unit.py \
       tests/unit/test_analytics_fullstack_unit.py \
       tests/unit/test_gateway_events_unit.py \
       -v
# 48 passed
```

### 6.1 Kafka 集成测试（需要 Kafka 运行）

```bash
ANALYTICS_TEST_KAFKA=true \
pytest tests/integration/test_analytics_kafka_integration.py -v
```

### 6.2 E2E Pipeline 测试（需要 Kafka + ClickHouse 运行）

```bash
ANALYTICS_TEST_KAFKA=true \
ANALYTICS_CLICKHOUSE_URL=http://localhost:8123 \
pytest tests/e2e/test_analytics_e2e_pipeline.py -v
```

---

## 7. ClickHouse 常用查询

### Consumer 激活漏斗（最近 7 天）

```sql
SELECT
    event_name,
    uniqExact(distinct_id) AS users
FROM synapse_analytics.events
WHERE event_name IN (
    'page_viewed', 'wallet_connected', 'consumer_signup_completed',
    'deposit_completed', 'credential_created', 'invoke_completed'
)
AND timestamp >= now() - INTERVAL 7 DAY
AND env = 'prod'
GROUP BY event_name
ORDER BY users DESC;
```

### 每日 GMV

```sql
SELECT
    toDate(timestamp) AS day,
    sum(JSONExtractFloat(properties, 'price_usdc')) AS gmv_usdc,
    count() AS invoke_count
FROM synapse_analytics.events
WHERE event_name = 'invoke_completed'
AND env = 'prod'
AND timestamp >= now() - INTERVAL 30 DAY
GROUP BY day
ORDER BY day;
```

### Provider 首次收款时间分布

```sql
SELECT
    floor(JSONExtractFloat(properties, 'time_since_listing_ms') / 3600000) AS hours_to_first_revenue,
    count() AS providers
FROM synapse_analytics.events
WHERE event_name = 'provider_first_revenue_received'
AND env = 'prod'
GROUP BY hours_to_first_revenue
ORDER BY hours_to_first_revenue;
```

### 调用失败 Top 错误码

```sql
SELECT
    JSONExtractString(properties, 'error_code') AS error_code,
    count() AS failures
FROM synapse_analytics.events
WHERE event_name = 'invoke_failed'
AND timestamp >= now() - INTERVAL 24 HOUR
AND env = 'prod'
GROUP BY error_code
ORDER BY failures DESC
LIMIT 10;
```

---

## 8. 告警阈值

| 告警 | 查询条件 | 处理方 |
|------|----------|--------|
| 注册骤降 | signup 事件 < 7 天均值 × 0.5 | Growth |
| 充值失败率高 | `deposit_failed / deposit_started > 0.15`（1h 窗口）| Gateway |
| 调用失败率高 | `invoke_failed / invoke_started > 0.1`（30min 窗口）| Gateway |
| Provider 上架停止 | `service_registered = 0`（24h 内）| Provider Ops |
| 结算失败率高 | `settlement_claim_failed / settlement_claim_requested > 0.1`（1h）| Gateway |

---

## 9. 数据保留策略

| 存储层 | 保留期 |
|--------|--------|
| ClickHouse events 表 | 365 天（TTL 自动清理） |
| Kafka topic | 7 天（`log.retention.hours=168`） |
| FileBackend JSONL | 手动清理（不自动轮转，生产环境不使用）|

---

## 10. 生产环境升级建议

| 组件 | 本地 | 生产推荐 |
|------|------|---------|
| Kafka | bitnami/kafka 单节点 KRaft | Confluent Cloud / AWS MSK Serverless |
| ClickHouse | 单节点 | ClickHouse Cloud 或 2 shard + 2 replica |
| PostHog | — | PostHog Cloud 或 Self-hosted (Helm) |
| TLS | 无 | SASL_SSL on Kafka; ClickHouse TLS |
| 访问控制 | 无 | ClickHouse 只读账户隔离；Kafka SASL |
