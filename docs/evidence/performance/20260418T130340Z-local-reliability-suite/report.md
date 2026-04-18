---
created_at: 2026-04-18
updated_at: 2026-04-18
doc_status: active
---

# Local Reliability Suite Report

## Run Metadata

- Environment: local
- Commit: `a40dcc59`
- Run time UTC: `2026-04-18T13:04:02Z`
- Evidence directory: `docs/evidence/performance/20260418T130340Z-local-reliability-suite`

## Scope

This suite validates safe local automation for performance and reliability evidence. It does not execute staging load, chaos, failover, rollback, restore, or signer procedures.

Local PASS means the harness, scheduler regression checks, scenario files, and destructive-operation guards are working. Production launch remains NO-GO until staging/prod-like reports are attached.

## Results

| Status | Check | Evidence | Note |
| --- | --- | --- | --- |
| PASS | Provider probe concurrency and slow-lane regression smoke | logs/ci-performance-reliability.log | completed |
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
| PASS | Local HTTP smoke | local-smoke/report.md | gateway and admin-front local endpoints responded |

## Summary

- Passed: 22
- Skipped: 0
- Failed: 0
- Decision: PASS

## Launch Impact

- Local reliability automation: PASS
- Production load/chaos/rollback evidence: unchanged; still requires staging reports and operator sign-off.
