from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any

from loguru import logger

from src.core.config import settings


class InterceptHandler(logging.Handler):
    """Redirect stdlib logging records so FastAPI/uvicorn share the loguru sinks."""

    def emit(self, record: logging.LogRecord) -> None:  # pragma: no cover - exercised indirectly
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        frame, depth = logging.currentframe(), 2
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(
            level, record.getMessage()
        )


def _ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def _retention_value(custom: str | int | None) -> str | int:
    if custom is not None:
        return custom
    return f"{settings.log_retention_days} days"


def _level_value(level: str | None) -> str:
    candidate = (level or settings.log_level or "INFO").upper()
    return candidate


def setup_logger(
    *,
    log_file_path: str | None = None,
    log_rotation: str | None = None,
    log_retention: str | int | None = None,
    log_level: str | None = None,
    serialize: bool | None = None,
    enqueue: bool | None = None,
) -> Any:
    """Configure structured logging for both stdout and JSONL file sinks."""
    logger.remove()
    logger.configure(extra={"request_id": "SYS"})

    resolved_level = _level_value(log_level)
    resolved_enqueue = True if enqueue is None else bool(enqueue)

    logger.add(
        sys.stdout,
        colorize=True,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{extra[request_id]}</cyan> | <level>{message}</level>",
        enqueue=resolved_enqueue,
        level=resolved_level,
    )

    json_path = Path(log_file_path or settings.log_file_path)
    _ensure_parent(json_path)
    logger.add(
        json_path,
        rotation=log_rotation or settings.log_rotation,
        retention=_retention_value(log_retention),
        serialize=True if serialize is None else bool(serialize),
        enqueue=resolved_enqueue,
        backtrace=False,
        diagnose=False,
        level=resolved_level,
    )

    handler = InterceptHandler()
    logging.basicConfig(handlers=[handler], level=getattr(logging, resolved_level, logging.INFO), force=True)
    logging.getLogger("uvicorn").propagate = True
    logging.getLogger("uvicorn.access").propagate = True

    return logger


setup_logger()
