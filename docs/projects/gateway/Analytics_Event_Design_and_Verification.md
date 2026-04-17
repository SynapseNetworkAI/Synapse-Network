---
id: gateway-analytics-event-design
title: Analytics Event Design & Verification — Gateway Backend
role: dev_rel
status: ready
created_at: 2026-04-11
updated_at: 2026-04-11
author: launch_strategist
target_repo: services/gateway/src/services/analytics/
---

# Analytics Event Design & Verification — Gateway Backend

> 本文档描述 Synapse Gateway 侧埋点（埋点）设计方案及完整链路验证流程。
> 埋点即"关键业务动作的可观测性锚点"，用于驱动增长 dashboard、告警与漏斗分析。

---

## 1. 架构概览

```
Gateway 业务逻辑
    │
    ├─ src/services/analytics/gateway_events.py   ← 业务事件快捷方法
    ├─ src/services/analytics/emitter.py          ← AnalyticsEmitter + Backend
    ├─ src/services/analytics/privacy.py          ← sha256_hash(wallet)
    │
    ▼
AnalyticsBackend (运行时注入)
    ├─ FileBackend  (ENVIRONMENT=local)  → logs/analytics_events.jsonl
    ├─ KafkaBackend (ENVIRONMENT=staging/prod) → Kafka topic
    └─ DualBackend  (staging/prod) → Kafka + File fallback
    │
    ▼ (Kafka → ClickHouse Kafka Engine MV)
synapse_analytics.events  (ClickHouse)
```

---

## 2. 埋点清单（Gateway 职责域）

Gateway 作为收入与调用的 **source of truth**，必须覆盖以下埋点。
所有埋点均通过 `gateway_events.py` 中的快捷方法发出，不得绕过。

### 2.1 调用链路埋点

| 事件名 | 触发时机 | 必须属性 |
|--------|----------|----------|
| `quote_generated` | 报价成功返回 | `service_id`, `quote_id`, `price_usdc` |
| `invoke_started` | Gateway 接受调用请求 | `service_id`, `provider_id`, `quote_id`, `surface` |
| `invoke_completed` | 调用成功 + 计费完成 | `service_id`, `provider_id`, `price_usdc`, `latency_ms`, `is_first_invoke` |
| `invoke_failed` | 调用失败（任何阶段）| `service_id`, `provider_id`, `error_code`, `failure_stage` |
| `budget_blocked` | 余额或预算不足被拦截 | `service_id`, `required_usdc`, `available_usdc`, `error_code` |

### 2.2 充提款埋点

| 事件名 | 触发时机 | 必须属性 |
|--------|----------|----------|
| `deposit_completed` | 链上确认 + 入账 | `amount_usdc`, `token_symbol`, `tx_hash`, `time_to_confirm_ms` |
| `deposit_failed` | 充值失败/回滚 | `amount_usdc`, `error_code` |
| `withdrawal_completed` | 提现到账 | `amount_usdc`, `tx_hash`, `time_to_confirm_ms`, `role` |
| `withdrawal_failed` | 提现失败 | `amount_usdc`, `error_code`, `role` |

### 2.3 Provider 收入与结算埋点

| 事件名 | 触发时机 | 必须属性 |
|--------|----------|----------|
| `provider_revenue_received` | 每次付费调用结算 | `provider_id`, `service_id`, `gross_usdc`, `platform_fee_usdc`, `provider_net_usdc` |
| `provider_first_revenue_received` | 首次付费调用 | `provider_id`, `service_id`, `gross_usdc`, `time_since_listing_ms` |
| `settlement_claim_requested` | Provider 发起提现 | `provider_id`, `claim_usdc` |
| `settlement_claim_completed` | 提现到链上 | `provider_id`, `claim_usdc`, `tx_hash`, `time_to_confirm_ms` |
| `settlement_claim_failed` | 提现失败 | `provider_id`, `claim_usdc`, `error_code` |

### 2.4 风控与安全埋点

| 事件名 | 触发时机 | 必须属性 |
|--------|----------|----------|
| `refund_completed` | 退款完成 | `amount_usdc`, `reason_code`, `service_id` |
| `risk_rule_triggered` | 命中风控规则 | `rule_code`, `surface`, `severity` |
| `provider_health_degraded` | Provider 健康检查失败 | `provider_id`, `service_id`, `failure_count`, `reason` |

---

## 3. 实现路径

### 3.1 快捷方法入口

所有 gateway 业务代码通过 `src/services/analytics/gateway_events.py` 发出埋点，示例：

```python
from src.services.analytics.gateway_events import (
    emit_invoke_completed,
    emit_invoke_failed,
    emit_deposit_completed,
    emit_budget_blocked,
)

# 调用成功后
await emit_invoke_completed(
    wallet_address=consumer_wallet,
    service_id=service.id,
    provider_id=service.provider_id,
    quote_id=quote.id,
    price_usdc=quote.price,
    latency_ms=elapsed_ms,
    is_first_invoke=is_first,
)
```

### 3.2 隐私保障

钱包地址在进入 analytics 系统前必须经 `sha256_hash()` 处理：

```python
from src.services.analytics.privacy import sha256_hash

distinct_id = sha256_hash(wallet_address)  # 返回 64 位 hex 字符串
```

**禁止**：将 `0x` 开头的原始地址写入任何 analytics 字段。

### 3.3 Backend 注入

`ENVIRONMENT` 决定 backend 类型（`app.py` lifespan 中注入）：

| ENVIRONMENT | Backend | 目标 |
|-------------|---------|------|
| `local` | `FileBackend` | `logs/analytics_events.jsonl` |
| `staging` | `DualBackend` | Kafka + file fallback |
| `prod` | `DualBackend` | Kafka + file fallback |

---

## 4. 验证协议

### 4.1 单元测试验证（无基础设施依赖）

```bash
cd services/gateway
source .venv/bin/activate
PYTHONPATH=. pytest tests/unit/test_analytics_emitter_unit.py \
           tests/unit/test_events_router_unit.py \
           tests/unit/test_analytics_fullstack_unit.py \
           tests/unit/test_gateway_events_unit.py \
           -v
# 期望：全部通过
```

### 4.2 HTTP 集成测试验证（无基础设施依赖）

```bash
PYTHONPATH=. pytest tests/integration/test_analytics_http_integration.py -v
# 期望：17 passed
```

### 4.3 FileBackend 全链路验证

```bash
# 设置 FileBackend 模式并启动 Gateway
ENVIRONMENT=local uvicorn gateway_fastapi:app --port 8000

# 发送测试埋点事件
curl -X POST http://localhost:8000/api/v1/events \
  -H "Content-Type: application/json" \
  -d '{
    "events": [{
      "event_id": "test-001",
      "event_name": "page_viewed",
      "timestamp": "2026-04-11T02:00:00.000Z",
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
# 期望响应：{"accepted":1,"rejected":0,"errors":[]}

# 验证事件写入 FileBackend
tail -1 services/gateway/logs/analytics_events.jsonl | python3 -m json.tool
```

### 4.4 Kafka → ClickHouse E2E 测试（需要 docker infra）

```bash
# 启动基础设施
cd infra/docker/local
docker-compose up -d kafka clickhouse kafka-ui

# 运行 E2E 测试
cd services/gateway
source .venv/bin/activate
ANALYTICS_TEST_E2E=true \
ANALYTICS_CLICKHOUSE_URL=http://localhost:8123 \
PYTHONPATH=. pytest tests/e2e/test_analytics_e2e_pipeline.py -v --timeout=60
```

### 4.5 业务全链路 → Admin Analytics 页面验证

该检查验证真实业务动作和 Admin Analytics 页面读数连续一致：

1. Provider 注册可调用服务，产生 `service_registered`。
2. Consumer 链上充值并由 Gateway 确认，产生 `deposit_completed`。
3. Agent 调用 Provider 服务，产生 `quote_generated`、`invoke_started`、`invoke_completed` 和 `provider_revenue_received`。
4. 测试写入前端漏斗事件 `page_viewed`、`wallet_connected`、`consumer_signup_completed`、`provider_signup_completed`。
5. ClickHouse 查询校验必需事件齐全，并输出 `output/analytics-fullchain/report.json`。
6. Admin 页面脚本读取同一份报告，调用 `gateway-admin` Analytics API，与 ClickHouse 原始窗口汇总比对，然后截图 7 个 Analytics 页面。

```bash
cd services/gateway
ANALYTICS_FULLCHAIN_E2E=true \
ANALYTICS_CLICKHOUSE_URL=http://localhost:8123 \
PYTHONPATH=. pytest tests/e2e/test_01_infrastructure.py \
  tests/e2e/test_02_wallet_auth.py \
  tests/e2e/test_03_fund_wallet.py \
  tests/e2e/test_04_deposit.py \
  tests/e2e/test_05_provider_register.py \
  tests/e2e/test_06_agent_credential.py \
  tests/e2e/test_07_invoke.py \
  tests/e2e/test_08_analytics_fullchain.py -q

cd ../..
ADMIN_FRONT_URL=http://127.0.0.1:4000 \
ADMIN_GATEWAY_URL=http://127.0.0.1:8300 \
ADMIN_SESSION_TOKEN='<synapse_admin_session cookie value>' \
node scripts/admin_analytics_fullchain_e2e.js
```

截图输出：

```text
output/analytics-fullchain/screens/
├── 01-analytics-overview.png
├── 02-consumer-funnel.png
├── 03-invocation-revenue.png
├── 04-provider-revenue.png
├── 05-money-flow.png
├── 06-risk-health.png
└── 07-data-quality.png
```

### 4.6 ClickHouse 埋点查询验证

```bash
# 激活漏斗（Consumer）
curl -s "http://localhost:8123/" \
  --data "SELECT event_name, uniqExact(distinct_id) AS users
          FROM synapse_analytics.events
          WHERE event_name IN (
            'page_viewed','wallet_connected','consumer_signup_completed',
            'quote_generated','deposit_completed','invoke_started','invoke_completed'
          )
          AND timestamp >= now() - INTERVAL 1 DAY
          GROUP BY event_name ORDER BY users DESC FORMAT PrettyCompact"

# 今日 GMV
curl -s "http://localhost:8123/" \
  --data "SELECT toDate(timestamp) AS day,
                 sum(JSONExtractFloat(properties,'price_usdc')) AS gmv_usdc,
                 count() AS invoke_count
          FROM synapse_analytics.events
          WHERE event_name = 'invoke_completed'
          AND timestamp >= today()
          GROUP BY day FORMAT PrettyCompact"

# 埋点覆盖率检查
curl -s "http://localhost:8123/" \
  --data "SELECT event_name, source, count() AS cnt
          FROM synapse_analytics.events
          WHERE timestamp >= now() - INTERVAL 24 HOUR
          GROUP BY event_name, source
          ORDER BY cnt DESC FORMAT PrettyCompact"
```

---

## 5. 数据质量保障

### 5.1 运行数据质量健康检查

```bash
cd services/gateway
source .venv/bin/activate
python scripts/analytics_health_check.py --clickhouse-url http://localhost:8123
```

输出示例：
```
============================================================
Synapse Analytics Health Check
Time: 2026-04-11T02:00:00+00:00
ClickHouse: http://localhost:8123
============================================================

[1] Event Flow
  ✅ PASS: Events in last hour — count=247

[2] Deduplication
  ✅ PASS: Duplicate rate < 1% — total=1823, unique=1823, dup_rate=0.0000

[3] Privacy
  ✅ PASS: No raw wallet addresses in distinct_id — found=0

[4] Source Coverage
  ✅ PASS: Frontend events present
  ✅ PASS: Gateway events present

[5] Critical Events
  ✅ PASS: 'page_viewed' present
  ✅ PASS: 'wallet_connected' present
  ✅ PASS: 'invoke_completed' present
  ✅ PASS: 'deposit_completed' present

[6] Invoke Health
  ✅ PASS: Invoke success rate > 90% — rate=97.23% (214/220)

============================================================
Results: 11 passed, 0 failed
============================================================
```

### 5.2 隐私约束验证规则

| 规则 | 验证方式 |
|------|----------|
| 不存储原始钱包地址 | `distinct_id` 不以 `0x` 开头且长度 ≠ 42 |
| 不存储邮箱/手机号 | properties JSON 不包含 `@` 或电话格式 |
| 金额字段限于业务必需 | 只有 `amount_usdc`, `price_usdc`, `gross_usdc` 等业务字段 |

---

## 6. 验收标准

上线前必须通过所有检查项：

- [ ] Analytics 单元测试全部通过 (`pytest tests/unit/test_gateway_events_unit.py tests/unit/test_analytics_fullstack_unit.py`)
- [ ] Analytics 集成测试全部通过 (`pytest tests/integration/test_analytics_http_integration.py`)
- [ ] E2E 管道测试通过 (`ANALYTICS_TEST_E2E=true pytest tests/e2e/`)
- [ ] 业务全链路 Analytics 验证通过 (`ANALYTICS_FULLCHAIN_E2E=true pytest tests/e2e/test_08_analytics_fullchain.py`)
- [ ] Admin Analytics 7 个页面截图验证通过 (`node scripts/admin_analytics_fullchain_e2e.js`)
- [ ] 数据质量健康检查 0 失败 (`analytics_health_check.py`)
- [ ] ClickHouse Consumer 激活漏斗可查询
- [ ] 无原始钱包地址泄漏（隐私检查通过）
- [ ] 同一调用只有一条最终态事件（`invoke_completed` XOR `invoke_failed`）

---

## 7. 相关文件索引

| 文件 | 描述 |
|------|------|
| `services/gateway/src/services/analytics/emitter.py` | 事件序列化与 Backend 实现 |
| `services/gateway/src/services/analytics/gateway_events.py` | 业务快捷方法（所有 Gateway 埋点入口）|
| `services/gateway/src/services/analytics/privacy.py` | 钱包地址哈希 |
| `services/gateway/src/api/routers/events.py` | 前端事件摄入 HTTP 端点 |
| `services/gateway/scripts/analytics_health_check.py` | ClickHouse 数据质量健康检查 |
| `services/gateway/tests/unit/` | Analytics 和 Gateway 业务埋点单元测试 |
| `services/gateway/tests/integration/` | Analytics HTTP 和跨服务集成测试 |
| `services/gateway/tests/e2e/test_analytics_e2e_pipeline.py` | Kafka→ClickHouse E2E 测试 |
| `services/gateway/tests/e2e/test_08_analytics_fullchain.py` | 服务注册、充值、调用到 ClickHouse 事件连续性测试 |
| `scripts/admin_analytics_fullchain_e2e.js` | Admin Analytics API 一致性和 7 页面截图验证 |
| `docs/projects/frontend/Synapse_Analytics_Tracking_Plan.md` | 全栈埋点规划（含前端/SDK/链上）|
| `docs/ops/08_Analytics_Pipeline_Operations.md` | 运维操作手册 |
| `infra/docker/local/docker-compose.yml` | Kafka + ClickHouse 本地基础设施 |
