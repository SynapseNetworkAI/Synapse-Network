from __future__ import annotations

import logging
import sys
from pathlib import Path

from loguru import logger

from src.core.config import get_settings


class InterceptHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:  # pragma: no cover - exec via logging
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


def setup_logger(
    *,
    log_file_path: str | None = None,
    log_rotation: str | None = None,
    log_retention: str | int | None = None,
    log_level: str | None = None,
    serialize: bool = True,
) -> None:
    settings = get_settings()
    logger.remove()
    logger.configure(extra={"request_id": "SYS"})

    resolved_level = (log_level or settings.log_level or "INFO").upper()

    logger.add(
        sys.stdout,
        colorize=True,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{extra[request_id]}</cyan> | <level>{message}</level>",
        enqueue=True,
        level=resolved_level,
    )

    file_path = Path(log_file_path or settings.log_file_path)
    _ensure_parent(file_path)
    logger.add(
        file_path,
        rotation=log_rotation or settings.log_rotation,
        retention=log_retention or f"{settings.log_retention_days} days",
        serialize=serialize,
        enqueue=True,
        backtrace=False,
        diagnose=False,
        level=resolved_level,
    )

    handler = InterceptHandler()
    logging.basicConfig(
        handlers=[handler],
        level=getattr(logging, resolved_level, logging.INFO),
        force=True,
    )


setup_logger()
