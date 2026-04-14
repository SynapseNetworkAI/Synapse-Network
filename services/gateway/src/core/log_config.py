from __future__ import annotations

import json
import logging
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Any, TextIO

from src.core.config import settings

_BASE_RECORD_ATTRS = set(logging.makeLogRecord({}).__dict__.keys())
_LOGGER_NAME = "synapse.gateway"
_CONSOLE_FORMAT = "%(asctime)s | %(levelname)s | %(message)s"


def _level_value(level: str | None) -> int:
    candidate = (level or settings.log_level or "INFO").upper()
    return getattr(logging, candidate, logging.INFO)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "message": record.getMessage(),
        }
        extra = {
            key: value
            for key, value in record.__dict__.items()
            if key not in _BASE_RECORD_ATTRS and key not in {"message", "asctime"}
        }
        if extra:
            payload["extra"] = extra
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


class DailyFileHandler(logging.Handler):
    def __init__(self, base_dir: Path, file_name: str, retention_days: int) -> None:
        super().__init__()
        self._base_dir = Path(base_dir)
        self._file_name = file_name
        self._retention_days = max(1, retention_days)
        self._lock = Lock()
        self._stream: TextIO | None = None
        self._current_date: str | None = None
        self._last_prune: datetime | None = None

    def emit(self, record: logging.LogRecord) -> None:  # pragma: no cover - exercised via tests
        try:
            with self._lock:
                self._ensure_stream(record)
                message = self.format(record)
                assert self._stream is not None
                self._stream.write(message + "\n")
                self._stream.flush()
        except Exception:
            self.handleError(record)

    def _ensure_stream(self, record: logging.LogRecord) -> None:
        record_dt = datetime.fromtimestamp(record.created, tz=timezone.utc)
        date_slug = record_dt.strftime("%Y-%m-%d")
        if self._current_date != date_slug or self._stream is None:
            if self._stream is not None:
                self._stream.close()
            target_dir = self._base_dir / date_slug
            target_dir.mkdir(parents=True, exist_ok=True)
            self._stream = open(target_dir / self._file_name, "a", encoding="utf-8")
            self._current_date = date_slug
        if self._last_prune is None or (record_dt - self._last_prune) >= timedelta(days=1):
            self._prune_old_directories(record_dt)

    def _prune_old_directories(self, now: datetime) -> None:
        cutoff = now.date() - timedelta(days=self._retention_days)
        if not self._base_dir.exists():
            self._last_prune = now
            return
        for child in self._base_dir.iterdir():
            if not child.is_dir():
                continue
            try:
                dir_date = datetime.strptime(child.name, "%Y-%m-%d").date()
            except ValueError:
                continue
            if dir_date <= cutoff:
                shutil.rmtree(child, ignore_errors=True)
        self._last_prune = now

    def close(self) -> None:
        with self._lock:
            if self._stream is not None:
                self._stream.close()
                self._stream = None
        super().close()


def _build_file_handler(path_override: str | None, retention: str | int | None) -> logging.Handler:
    if path_override:
        file_path = Path(path_override)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        handler: logging.Handler = logging.FileHandler(file_path, encoding="utf-8")
        return handler
    retention_days = settings.log_retention_days
    if isinstance(retention, int):
        retention_days = max(retention, 1)
    elif isinstance(retention, str):
        try:
            retention_days = max(int(retention.split()[0]), 1)
        except (ValueError, IndexError):
            retention_days = settings.log_retention_days
    return DailyFileHandler(Path(settings.log_directory), settings.log_file_name, retention_days)


def setup_logger(
    *,
    log_file_path: str | None = None,
    log_rotation: str | None = None,
    log_retention: str | int | None = None,
    log_level: str | None = None,
    serialize: bool | None = None,
    enqueue: bool | None = None,
) -> logging.Logger:
    _ = log_rotation, serialize, enqueue  # rotation handled via daily handler; other args retained for API parity
    resolved_level = _level_value(log_level)

    root_logger = logging.getLogger()
    for handler in root_logger.handlers[:]:
        handler.close()
        root_logger.removeHandler(handler)
    root_logger.setLevel(resolved_level)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(resolved_level)
    console_handler.setFormatter(logging.Formatter(_CONSOLE_FORMAT))
    root_logger.addHandler(console_handler)

    file_handler = _build_file_handler(log_file_path, log_retention)
    file_handler.setLevel(resolved_level)
    file_handler.setFormatter(JsonFormatter())
    root_logger.addHandler(file_handler)

    logging.getLogger("uvicorn").propagate = True
    logging.getLogger("uvicorn.access").propagate = True

    return logging.getLogger(_LOGGER_NAME)


setup_logger()
