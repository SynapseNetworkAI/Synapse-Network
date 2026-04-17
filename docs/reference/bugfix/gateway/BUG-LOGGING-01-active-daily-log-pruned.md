# BUG-LOGGING-01 Active Daily Log Directory Pruned

## Status

Fixed on 2026-04-17.

## Symptom

`services/gateway/tests/unit/test_logging_plan_unit.py::test_setup_logger_uses_daily_directory`
failed during the pre-push quality gate. The logger printed to stdout, but the expected
dated file path was missing:

```text
.../2026-04-14/gateway.log
```

## Root Cause

`DailyFileHandler` opened the active dated log file and then immediately ran retention
cleanup using `record.created`. When a deterministic or clock-skewed log date was older
than the retention cutoff, the cleanup removed the just-opened active directory. The file
stream stayed open to an unlinked file, so `Path.exists()` returned false and operators
would not see the active log file on disk.

## Fix

Retention cleanup now skips `self._current_date`, ensuring the currently active daily log
directory is never pruned in the same emit cycle.

## Verification

```bash
cd services/gateway
.venv/bin/python -m pytest tests/unit/test_logging_plan_unit.py::test_setup_logger_uses_daily_directory -q
```
