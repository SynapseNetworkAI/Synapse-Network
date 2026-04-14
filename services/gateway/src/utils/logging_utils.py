from __future__ import annotations

from uuid import uuid4

from loguru import logger


def resolve_request_id(candidate: str | None, prefix: str) -> str:
    """Normalize a request id or generate a deterministic fallback."""
    normalized = str(candidate or '').strip()
    if normalized:
        return normalized
    return f"{prefix}_{uuid4().hex[:12]}"


def workflow_logger(workflow: str, *, request_id: str | None = None, **extra):
    """Bind workflow metadata (workflow + request_id) to the shared logger."""
    resolved = resolve_request_id(request_id, workflow)
    return logger.bind(request_id=resolved, workflow=workflow, **extra)
