# BUG-ANALYTICS-01 Missing `invoke_started` Event

## Status

Fixed on 2026-04-16.

## Symptom

Admin Analytics 的“调用与收入”页面包含 `invokeStartedCount`，Consumer 激活漏斗也把 `invoke_started` 作为付费调用前的关键步骤，但 Gateway 业务代码只发出了 `quote_generated`、`invoke_completed` / `invoke_failed` 和 Provider 收入事件。

结果是：

- `invokeStartedCount` 长期为 0 或低于真实调用量。
- `quote -> invoke_started -> invoke_completed` 断点不可观测。
- 页面上 started/completed 的数据无法用于判断“已开始但未完成”的 provider 或 gateway 异常。

## Root Cause

`services/gateway/src/services/analytics/gateway_events.py` 没有 `emit_invoke_started` helper，`forwarding_service.py` 在把 invocation 状态推进到 `RUNNING` 后也没有发 started 事件。

## Fix

- 新增 `emit_invoke_started`，字段与后续完成事件保持同一 `service_id`、`provider_id`、`quote_id`、`price_usdc` 和 `correlation_id`。
- 在 `_execute_invocation_pipeline()` 持久化 `RUNNING` invocation 后、调用 upstream provider 前发出 `invoke_started`。
- 新增单测覆盖 `invoke_started` payload。
- 新增 full-chain Analytics E2E，验证服务注册、充值、调用、ClickHouse 事件、Admin Analytics API 和页面截图连续一致。

## Verification

```bash
cd services/gateway
PYTHONPATH=. pytest tests/unit/test_gateway_events_unit.py -q

ANALYTICS_FULLCHAIN_E2E=true \
ANALYTICS_CLICKHOUSE_URL=http://localhost:8123 \
PYTHONPATH=. pytest tests/e2e/test_08_analytics_fullchain.py -q

cd ../..
ADMIN_SESSION_TOKEN='<synapse_admin_session cookie value>' \
node scripts/admin_analytics_fullchain_e2e.js
```
