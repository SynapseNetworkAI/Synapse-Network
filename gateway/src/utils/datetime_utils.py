from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
import re

DATETIME_FORMAT = "%Y-%m-%d %H:%M:%S"
_NUMERIC_TEXT_PATTERN = re.compile(r"^-?\d+(?:\.\d+)?$")


def _parse_numeric_datetime_text(text: str, default: Optional[str]) -> Optional[str]:
    if not _NUMERIC_TEXT_PATTERN.fullmatch(text):
        return None
    try:
        return to_dt_str(float(text), default)
    except Exception:
        return default


def now_dt_str() -> str:
    return datetime.now(timezone.utc).strftime(DATETIME_FORMAT)


def to_dt_str(value: Any, default: Optional[str] = None) -> Optional[str]:
    if value is None:
        return default
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).strftime(DATETIME_FORMAT)
    if isinstance(value, (int, float)):
        # Backward compatibility: legacy epoch second/millisecond values.
        epoch = float(value)
        if epoch > 1_000_000_000_000:
            epoch = epoch / 1000.0
        return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime(DATETIME_FORMAT)
    text = str(value).strip()
    if not text:
        return default
    numeric_text = _parse_numeric_datetime_text(text, default)
    if numeric_text is not None:
        return numeric_text
    for pattern in (DATETIME_FORMAT, "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            parsed = datetime.strptime(text, pattern)
            return parsed.strftime(DATETIME_FORMAT)
        except ValueError:
            continue
    try:
        normalized = text.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).strftime(DATETIME_FORMAT)
    except Exception:
        return text
