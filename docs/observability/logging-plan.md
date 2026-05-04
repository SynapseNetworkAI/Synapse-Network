---
title: Gateway Logging Plan
created_at: 2026-04-14
updated_at: 2026-04-14
doc_status: active
---

# Observability Logging Plan

## Overview

- All runtime services emit structured logs to both stdout and JSONL files.
- Daily rotation at midnight keeps files bounded; minimum on-disk retention is 14 days.
- Correlation IDs (`request_id`) are bound to every entry so workflows can be replayed end-to-end.

## Architecture

| Plane                       | Sink   | Format              | Default Path                                                     |
| --------------------------- | ------ | ------------------- | ---------------------------------------------------------------- |
| Gateway (FastAPI)           | stdout | color single-line   | process stdout                                                   |
| Gateway (FastAPI)           | file   | JSON line per entry | `services/gateway/logs/gateway/<YYYY-MM-DD>/gateway-runtime.log` |
| Gateway Admin (FastAPI)     | stdout | color single-line   | process stdout                                                   |
| Gateway Admin (FastAPI)     | file   | JSON line per entry | `services/gateway-admin/logs/gateway-admin.log`                  |
| User Front (Next.js logger) | file   | JSON line per entry | `services/user-front/logs/user-ops-YYYY-MM-DD.jsonl`             |

- Python services share the same stdlib JSON logging configuration (stdout + JSON sink) and can be tailed locally (`jq` friendly).
- Node adapters use date-suffixed JSONL files to keep browser/server interactions auditable even without centralized shipping.

## Configuration

### Gateway (`src/core/config.py`)

| Env                          | Default                                | Description                                          |
| ---------------------------- | -------------------------------------- | ---------------------------------------------------- |
| `GATEWAY_LOG_DIR`            | `<repo>/services/gateway/logs/gateway` | Root directory for dated log directories.            |
| `GATEWAY_LOG_FILE_NAME`      | `gateway-runtime.log`                  | Base filename for JSON logs.                         |
| `GATEWAY_LOG_ROTATION`       | `00:00`                                | UTC 时间边界（当前固定为每日 00:00，用于命名目录）。 |
| `GATEWAY_LOG_RETENTION_DAYS` | `14`                                   | Minimum number of days kept on disk.                 |
| `GATEWAY_LOG_LEVEL`          | `INFO`                                 | Shared level for stdout + file sinks.                |

### Gateway Admin (`services/gateway-admin/src/core/config.py`)

Same knobs prefixed with `ADMIN_` (`ADMIN_LOG_DIR`, `ADMIN_LOG_FILE_NAME`, `ADMIN_LOG_ROTATION`, `ADMIN_LOG_RETENTION_DAYS`, `ADMIN_LOG_LEVEL`).

### User Front Logger Adapter

| Env                  | Default                 | Description                                                |
| -------------------- | ----------------------- | ---------------------------------------------------------- |
| `LOG_FILE_PATH`      | `./logs/user-ops.jsonl` | Base file used to derive `*-YYYY-MM-DD.jsonl` daily files. |
| `LOG_RETENTION_DAYS` | `7`                     | Files older than the window are deleted.                   |

## Workflow Instrumentation

- **Discovery** (`GET /api/v1/services/discover`, `POST /api/v1/agent/discovery/search`): logs `start`, `complete`, and `failure` with filters, paging, and correlation IDs.
- **Invocation** (`forwarding_service.invoke_v1`): logs request admission, completion (duration, USDC charged), and failure (error code, stage, provider).
- **Settlement** (`BalanceService` provider withdraw create/complete/review): logs start/completion/failure with owner wallet, withdrawal id, amount, and admin actors when present.

Every entry includes `workflow`, `stage`, and `request_id`/`correlation_id` fields so they can be queried quickly (ex: `jq 'select(.workflow=="invocation" and .stage=="failure")' logs/gateway/2026-04-14/gateway-runtime.log`).

## Operational Steps

1. **Local verification**
   ```bash
   cd services/gateway
   python -m uvicorn src.app:app
   tail -f logs/gateway/$(date -u +%F)/gateway-runtime.log | jq .
   ```
2. **Rotation audit** – confirm nightly rollover by checking file suffix timestamps and ensuring at least 7 retained files:
   ```bash
   ls -lt services/gateway/logs/gateway/*/gateway-runtime.log
   ```
3. **Shipping** – ship JSON files via FluentBit/Filebeat; no custom formatters are needed (already JSON).
4. **On-call triage** – filter by `workflow` + `request_id` to follow a request through discovery → invocation → settlement.

## Validation Hooks

- Python: `cd services/gateway && pytest tests/unit/test_logging_plan_unit.py` (new tests assert file sink + workflow logging).
- TypeScript: `cd services/user-front && npm test` (Vitest coverage for JsonlAdapter rotation/retention).
- CI already runs `npm run ci:gateway` and `npm run ci:frontend` which call the same suites.

Keeping docs, code, and tests in sync ensures any regression in logging (missing files, missing workflow stages) is caught automatically.
