from __future__ import annotations

import logging
from uuid import uuid4
from typing import Any


def resolve_request_id(candidate: str | None, prefix: str) -> str:
    """Normalize a request id or generate a deterministic fallback."""
    normalized = str(candidate or "").strip()
    if normalized:
        return normalized
    return f"{prefix}_{uuid4().hex[:12]}"


class WorkflowLogger:
    _STANDARD_KWARGS = {"exc_info", "stack_info", "stacklevel"}

    def __init__(self, logger: logging.Logger, extra: dict[str, Any]) -> None:
        self._logger = logger
        self._extra = dict(extra)

    def _log(self, level: int, message: str, *args, **kwargs) -> None:
        custom_fields = {
            key: kwargs.pop(key)
            for key in list(kwargs.keys())
            if key not in self._STANDARD_KWARGS
        }
        merged_extra = dict(self._extra)
        merged_extra.update(kwargs.pop("extra", {}))
        merged_extra.update(custom_fields)
        kwargs["extra"] = merged_extra
        self._logger.log(level, message, *args, **kwargs)

    def info(self, message: str, *args, **kwargs) -> None:
        self._log(logging.INFO, message, *args, **kwargs)

    def warning(self, message: str, *args, **kwargs) -> None:
        self._log(logging.WARNING, message, *args, **kwargs)

    def error(self, message: str, *args, **kwargs) -> None:
        self._log(logging.ERROR, message, *args, **kwargs)

    def exception(self, message: str, *args, **kwargs) -> None:
        kwargs.setdefault("exc_info", True)
        self._log(logging.ERROR, message, *args, **kwargs)

    def debug(self, message: str, *args, **kwargs) -> None:
        self._log(logging.DEBUG, message, *args, **kwargs)


def workflow_logger(workflow: str, *, request_id: str | None = None, **extra: Any) -> WorkflowLogger:
    """Bind workflow metadata (workflow + request_id) to the shared logger."""
    resolved = resolve_request_id(request_id, workflow)
    logger = logging.getLogger(f"synapse.workflow.{workflow}")
    bound_extra = {"request_id": resolved, "workflow": workflow}
    bound_extra.update(extra)
    return WorkflowLogger(logger, bound_extra)
