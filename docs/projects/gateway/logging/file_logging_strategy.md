---
id: gateway-file-logging
title: Gateway Structured File Logging Strategy
role: platform_engineering
status: canonical
created_at: 2026-04-14
updated_at: 2026-04-14
author: software_engineer
owner: gateway
---

# Gateway Structured File Logging Strategy

> 目标：以 Agent 调用关键链路为中心，将 Gateway 运行日志落地为 JSON Lines 文件，并保证“每日一目录、UTC 归档 + 14 天保留”。

## 1. 输出路径与命名约定

- **目录**：`<repo>/services/gateway/logs/gateway/<UTC_DATE>/`
- **文件名**：默认 `gateway-runtime.log`（JSON Lines，每行一条结构化记录）
- **组合规则**：`settings.log_file_path = logs/gateway/{YYYY-MM-DD}/gateway-runtime.log`
- **可配置项**：
  - `GATEWAY_LOG_DIR`：覆盖根目录（默认 `services/gateway/logs/gateway`）。
  - `GATEWAY_LOG_FILE_NAME`：覆盖文件名（默认 `gateway-runtime.log`）。

> 例：`2026-04-14` 当日的日志文件为 `services/gateway/logs/gateway/2026-04-14/gateway-runtime.log`。

## 2. 拆分与保留策略

| 维度 | 默认 | 配置 | 机制 |
|------|------|------|------|
| 拆分节奏 | 每日 UTC 午夜 | `GATEWAY_LOG_ROTATION` (`00:00`) | stdlib `DailyFileHandler` 按 UTC 日期切换目录 |
| 保留周期 | 14 天 | `GATEWAY_LOG_RETENTION_DAYS` (>=14) | Handler 启动时自动删除超期目录 |
| 并发写入 | 线程安全 | — | Handler 内部 `Lock` 串行化写入并即时 flush |

- 日切规则遵循 UTC，避免跨时区时出现重复 / 丢失窗口。
- 14 天之后的日志由 handler 自动清理，可配合 ops cron 将文件 ship 到对象存储再保留长期副本。

## 3. 记录格式与字段

所有日志都以 JSON Lines 形式写入磁盘，核心字段如下：

| 字段 | 说明 |
|------|------|
| `time` | ISO8601，UTC。由 stdlib `datetime` 格式化。 |
| `level` | `INFO` / `WARNING` / `ERROR` 等级。 |
| `message` | 事件名（如 `invocation.start`）。 |
| `extra.request_id` | 绑定的请求/工作流 ID。缺失时由 `workflow_logger` 自动生成。 |
| `extra.workflow` | 工作流名称，如 `discovery`、`invocation`、`settlement`。 |
| `extra.*` | 关键业务上下文字段，如 `service_id`、`quote_id`、`owner_wallet`。 |

> 规范：**只允许结构化字段**，严禁使用多行字符串或一次性 dump 大对象。

## 4. 关键链路日志面板

| 链路 | 事件 | 触发点 | 字段 |
|------|------|--------|------|
| Discovery | `discovery.start` / `discovery.complete` | `/api/v1/services/discover` handler | `intent`, `sortBy`, `result_count` |
| Invocation | `invocation.start` / `invocation.complete` / `invocation.failed` | `forwarding_service.generate_response_v2` | `service_id`, `quote_id`, `latency_ms`, `error_code` |
| Settlement | `settlement.start` / `settlement.complete` / `settlement.failed` | `BalanceService.create_provider_withdraw_intent` | `owner_wallet`, `amount_usdc`, `withdrawal_id` |
| Platform Tasks | `task.start` / `task.degraded` / `task.stopped` | Background monitors (indexer, reaper, processor) | `task`, `reason` |

这些事件全部通过 `src/utils/logging_utils.workflow_logger()` 绑定 request_id，确保磁盘日志与 analytics、audit 同步。

## 5. 运维操作指南

1. **权限**：运行用户必须对 `services/gateway/logs/gateway` 拥有读写权限；容器部署时通过 volume 映射保证持久化。
2. **日志 shipping**：
   - 本地 / dev：直接阅读 JSON 文件或 `jq` 过滤。
   - Staging / Prod：Sidecar/Agent（Fluent Bit、Vector）读取日期目录并 push 到集中式 log lake（CloudWatch / Loki）。
3. **健康检查**：`tests/unit/test_logging_plan_unit.py::test_setup_logger_writes_json_file` 保证 JSON 结构和文件路径；CI 中运行 `pytest` 自动验证。
4. **故障处理**：
   - 文件无法写入 → 检查磁盘空间 & 路径权限；
   - 日志缺失 → 确认 `ENVIRONMENT` 注入了 `setup_logger()`（`src/app.py` 在 import 时即完成配置）。
5. **扩展点**：可以新增第二个 sink（如 stdout）或将 `serialize=False` 用于本地调试，但不得移除 JSON 文件 sink。

## 6. 快速验证

```bash
cd services/gateway
python - <<'PY'
from src.core.log_config import setup_logger
from src.utils.logging_utils import workflow_logger
logger = setup_logger()
workflow_logger("doc", request_id="req-doc").info("doc-test", foo="bar")
PY
cat logs/gateway/$(date -u +%F)/gateway-runtime.log | tail -n 1 | jq
```

期望输出包含 `workflow: "doc"`，并位于当天 UTC 目录内。
