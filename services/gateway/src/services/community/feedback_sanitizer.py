from __future__ import annotations

import re
from typing import Any

SENSITIVE_KEY_PARTS = (
    "authorization",
    "bearer",
    "jwt",
    "token",
    "private",
    "secret",
    "password",
    "signature",
)
MAX_REDACT_DEPTH = 6
JWT_RE = re.compile(r"\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b")
PRIVATE_KEY_RE = re.compile(r"\b0x[a-fA-F0-9]{64}\b")
BEARER_RE = re.compile(r"bearer\s+[a-zA-Z0-9._~+/=-]{12,}", re.IGNORECASE)
SENSITIVE_ASSIGNMENT_RE = re.compile(
    r"\b(?:private[_-]?key|signature|secret|token|password)\s*[:=]\s*[^\s,;]+",
    re.IGNORECASE,
)
CONTROL_RE = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F]")


def redact_feedback_text(value: str, *, max_len: int) -> str:
    text = CONTROL_RE.sub("", str(value or "")).strip()
    text = BEARER_RE.sub("[REDACTED_BEARER]", text)
    text = SENSITIVE_ASSIGNMENT_RE.sub("[REDACTED_SENSITIVE_FIELD]", text)
    text = JWT_RE.sub("[REDACTED_JWT]", text)
    text = PRIVATE_KEY_RE.sub("[REDACTED_PRIVATE_KEY]", text)
    if len(text) > max_len:
        return text[:max_len].rstrip()
    return text


def redact_feedback_payload(value: Any, *, depth: int = 0) -> Any:
    if depth > MAX_REDACT_DEPTH:
        return "[REDACTED_DEPTH]"
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, nested in value.items():
            safe_key = str(key)[:80]
            if any(part in safe_key.lower() for part in SENSITIVE_KEY_PARTS):
                redacted[safe_key] = "[REDACTED]"
            else:
                redacted[safe_key] = redact_feedback_payload(nested, depth=depth + 1)
        return redacted
    if isinstance(value, list):
        return [redact_feedback_payload(item, depth=depth + 1) for item in value[:60]]
    if isinstance(value, str):
        return redact_feedback_text(value, max_len=2000)
    if isinstance(value, (bool, int)) or value is None:
        return value
    return str(value)[:500]
