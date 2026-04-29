from __future__ import annotations

import re
from typing import Any

_SENSITIVE_KEYWORDS = (
    "authorization",
    "jwt",
    "password",
    "private_key",
    "secret",
    "signature",
    "token",
)
_LONG_HEX_RE = re.compile(r"0x[a-fA-F0-9]{64,}")
_BEARER_RE = re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]+=*", re.IGNORECASE)


def mask_email(email: str) -> str:
    local, sep, domain = str(email or "").partition("@")
    if not sep:
        return "[invalid-email]"
    visible = local[:1] if local else "*"
    return f"{visible}***@{domain}"


def redact_text(value: str, *, max_chars: int = 1200) -> str:
    redacted = _BEARER_RE.sub("[REDACTED_BEARER]", str(value or ""))
    redacted = _LONG_HEX_RE.sub("[REDACTED_HEX]", redacted)
    for keyword in _SENSITIVE_KEYWORDS:
        redacted = re.sub(
            rf"\b{keyword}\s*[:=]\s*([^\s,;]+)",
            "[REDACTED_SENSITIVE_FIELD]",
            redacted,
            flags=re.IGNORECASE,
        )
    if len(redacted) > max_chars:
        return redacted[:max_chars] + "... [Truncated]"
    return redacted


def redact_payload(value: Any) -> Any:
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if any(keyword in normalized for keyword in _SENSITIVE_KEYWORDS):
                result[str(key)] = "[REDACTED]"
            else:
                result[str(key)] = redact_payload(child)
        return result
    if isinstance(value, list):
        return [redact_payload(item) for item in value]
    if isinstance(value, str):
        return redact_text(value)
    return value
