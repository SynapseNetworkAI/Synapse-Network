---
created_at: 2026-04-19
updated_at: 2026-04-19
doc_status: active
---

# Local Reliability Suite Report

## Run Metadata

- Environment: local
- Commit: `644f3fe1`
- Run time UTC: `2026-04-19T06:15:29Z`
- Evidence directory: `docs/evidence/performance/20260419T061528Z-local-reliability-suite`

## Scope

This suite validates safe local automation for performance and reliability evidence. It does not execute staging load, chaos, failover, rollback, restore, or signer procedures.

Local PASS means the harness, scheduler regression checks, scenario files, and destructive-operation guards are working. Production launch remains NO-GO until staging/prod-like reports are attached.

## Results

| Status | Check | Evidence | Note |
| --- | --- | --- | --- |
| PASS | Provider probe concurrency and slow-lane regression smoke | logs/ci-performance-reliability.log | completed |
| PASS | Gateway pre-launch stress static review | logs/ci-gateway-stress-review.log | completed |
| PASS | Release Go/No-Go document gate | logs/ci-release-go-no-go.log | completed |
| PASS | Docs governance gate | logs/ci-docs.log | completed |
| PASS | Performance, chaos, and drill shell syntax | logs/shell-syntax.log | completed |
| PASS | Performance scenario JSON parse | logs/scenario-json-parse.log | completed |
| PASS | HTTP load runner help | logs/http-load-runner-help.log | completed |
| PASS | Gateway load script refuses missing staging confirmation | logs/guard-gateway-load.log | refused unsafe run as expected |
| PASS | Finance load script refuses missing staging confirmation | logs/guard-finance-load.log | refused unsafe run as expected |
| PASS | Provider health load script refuses missing staging confirmation | logs/guard-provider-health-load.log | refused unsafe run as expected |
| PASS | Admin load script refuses missing staging confirmation | logs/guard-admin-load.log | refused unsafe run as expected |
| PASS | Money concurrency script refuses missing staging confirmation | logs/guard-money-concurrency.log | refused unsafe run as expected |
| PASS | Provider outage chaos refuses missing staging confirmation | logs/guard-provider-outage.log | refused unsafe run as expected |
| PASS | Gateway restart chaos refuses missing staging confirmation | logs/guard-gateway-restart.log | refused unsafe run as expected |
| PASS | Gateway-admin restart chaos refuses missing staging confirmation | logs/guard-gateway-admin-restart.log | refused unsafe run as expected |
| PASS | Analytics outage chaos refuses missing staging confirmation | logs/guard-analytics-outage.log | refused unsafe run as expected |
| PASS | RPC outage chaos refuses missing staging confirmation | logs/guard-rpc-outage.log | refused unsafe run as expected |
| PASS | Postgres failover chaos refuses missing staging confirmation | logs/guard-postgres-failover.log | refused unsafe run as expected |
| PASS | Redis unavailable chaos refuses missing staging confirmation | logs/guard-redis-unavailable.log | refused unsafe run as expected |
| PASS | Application rollback drill refuses missing staging confirmation | logs/guard-application-rollback.log | refused unsafe run as expected |
| PASS | Config rollback drill refuses missing staging confirmation | logs/guard-config-rollback.log | refused unsafe run as expected |
| PASS | Signer rollback drill refuses missing staging confirmation | logs/guard-signer-rollback.log | refused unsafe run as expected |
| SKIP | Local HTTP smoke | - | SYNAPSE_LOCAL_SUITE_SKIP_HTTP_SMOKE=1 |

## Summary

- Passed: 22
- Skipped: 1
- Failed: 0
- Decision: PASS

## Gateway Stress Review Details

`npm run ci:gateway-stress-review` completed successfully.

- Static scan errors: `0`
- Static scan warnings: `16`
- Launch impact: no hard blocker found by the static stress review. The warnings remain advisory pressure-review items that must be fixed or justified with staging evidence before production sign-off.

Warnings:

1. `services/gateway/src/services/community/feedback_forum_service.py:367` `POTENTIAL_UNBOUNDED_READ`
2. `services/gateway/src/services/owner/downstream_concurrency.py:93` `POTENTIAL_UNBOUNDED_CACHE`
3. `services/gateway/src/services/owner/forwarding_budget.py:19` `POTENTIAL_UNBOUNDED_CACHE`
4. `services/gateway/src/services/platform/internal_auth.py:18` `POTENTIAL_UNBOUNDED_CACHE`
5. `services/gateway/src/storage/postgres/repositories/balance_repository.py:157` `POTENTIAL_UNBOUNDED_READ`
6. `services/gateway/src/storage/postgres/repositories/fee_policy_repository.py:26` `POTENTIAL_UNBOUNDED_READ`
7. `services/gateway/src/storage/postgres/repositories/gateway_state_core_mixin.py:281` `POTENTIAL_UNBOUNDED_READ`
8. `services/gateway/src/storage/postgres/repositories/gateway_state_refund_mixin.py:60` `POTENTIAL_UNBOUNDED_READ`
9. `services/gateway/src/storage/postgres/repositories/gateway_state_withdrawal_mixin.py:57` `POTENTIAL_UNBOUNDED_READ`
10. `services/gateway/src/storage/postgres/repositories/gateway_state_withdrawal_mixin.py:266` `POTENTIAL_UNBOUNDED_READ`
11. `services/gateway/src/storage/postgres/repositories/gateway_state_withdrawal_mixin.py:289` `POTENTIAL_UNBOUNDED_READ`
12. `services/gateway/src/storage/postgres/repositories/service_registry_query_mixin.py:354` `POTENTIAL_UNBOUNDED_READ`
13. `services/gateway/src/storage/postgres/repositories/service_registry_query_mixin.py:471` `POTENTIAL_UNBOUNDED_READ`
14. `services/gateway/src/storage/postgres_impl.py:166` `POTENTIAL_UNBOUNDED_READ`
15. `services/gateway/src/storage/postgres_impl.py:182` `POTENTIAL_UNBOUNDED_READ`
16. `services/gateway/src/storage/postgres_impl.py:238` `POTENTIAL_UNBOUNDED_READ`

## Launch Impact

- Local reliability automation: PASS
- Production load/chaos/rollback evidence: unchanged; still requires staging reports and operator sign-off.
