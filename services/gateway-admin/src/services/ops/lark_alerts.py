from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

MAX_CARD_BYTES = 24 * 1024
HTTP_OK_MIN = 200
HTTP_OK_MAX_EXCLUSIVE = 300
SENSITIVE_PATTERN = re.compile(
    r"(?i)(authorization|bearer|token|secret|password|private[_-]?key|signature|cookie)"
)


@dataclass(frozen=True)
class LarkRoute:
    name: str
    webhook: str
    secret: str = ""


class LarkAlertError(RuntimeError):
    pass


def redact_sensitive(value: Any) -> str:
    text = str(value if value is not None else "")
    text = re.sub(
        r"(?i)authorization\s*:\s*bearer\s+[^\r\n,]+",
        "authorization=[REDACTED]",
        text,
    )
    text = re.sub(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}", "bearer [REDACTED]", text)
    text = re.sub(
        r"(?i)(authorization|bearer|token|secret|password|private[_-]?key|signature|cookie)\s*[:=]\s*[^,\s\\]+",
        r"\1=[REDACTED]",
        text,
    )
    text = re.sub(r"\b0x[a-fA-F0-9]{64,}\b", "[REDACTED_HEX]", text)
    text = re.sub(r"\b0x([a-fA-F0-9]{4})[a-fA-F0-9]{32}([a-fA-F0-9]{4})\b", r"0x\1...\2", text)
    return text


def sanitize_payload(value: Any) -> Any:
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            if SENSITIVE_PATTERN.search(str(key)):
                sanitized[str(key)] = "[REDACTED]"
            else:
                sanitized[str(key)] = sanitize_payload(item)
        return sanitized
    if isinstance(value, list):
        return [sanitize_payload(item) for item in value[:20]]
    if isinstance(value, str):
        return redact_sensitive(value)
    return value


def _safe_text(value: Any, max_chars: int = 800) -> str:
    text = redact_sensitive(value)
    if len(text) <= max_chars:
        return text
    return f"{text[: max(0, max_chars - 15)]}... [Truncated]"


def _label(labels: dict[str, Any], key: str, fallback: str = "unknown") -> str:
    return _safe_text(labels.get(key) or fallback, 140) or fallback


def _sign_lark_request(secret: str, timestamp: int) -> str:
    string_to_sign = f"{timestamp}\n{secret}".encode("utf-8")
    digest = hmac.new(string_to_sign, b"", hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def build_lark_card(alert: dict[str, Any]) -> dict[str, Any]:
    labels = dict(alert.get("labels") or {})
    annotations = dict(alert.get("annotations") or {})
    status = _safe_text(alert.get("status") or "firing", 40)
    severity = _label(labels, "severity", "p1")
    system = _label(labels, "system", "ops")
    env = _label(labels, "env", "staging")
    alertname = _label(labels, "alertname", "GcpMonitoringAlert")
    status_prefix = "RESOLVED" if status == "resolved" else "FIRING"
    template = "green" if status == "resolved" else ("red" if severity == "p0" else "orange")

    lines = [
        f"**Alert**: {alertname}",
        f"**Status**: {status}",
        f"**Severity/System/Env**: {severity} / {system} / {env}",
        f"**Summary**: {_safe_text(annotations.get('summary') or 'No summary provided.', 700)}",
    ]
    for key, label in [
        ("business_scenario", "Business scenario"),
        ("impact", "Impact"),
        ("trigger", "Trigger"),
        ("action", "Action"),
    ]:
        value = _safe_text(annotations.get(key) or "", 520)
        if value:
            lines.append(f"**{label}**: {value}")
    if annotations.get("message"):
        lines.append(f"**Message**:\n{_safe_text(annotations.get('message'), 1000)}")
    lines.extend(
        [
            f"**Runbook**: {_safe_text(annotations.get('runbook') or 'not configured', 300)}",
            f"**Dashboard**: {_safe_text(annotations.get('dashboard') or 'not configured', 300)}",
            f"**Fingerprint**: {_safe_text(alert.get('fingerprint') or 'n/a', 200)}",
        ]
    )

    message = {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {
                "template": template,
                "title": {
                    "tag": "plain_text",
                    "content": f"[{status_prefix}][{severity.upper()}][{system}][{env}] {alertname}",
                },
            },
            "elements": [
                {
                    "tag": "div",
                    "text": {
                        "tag": "lark_md",
                        "content": "\n\n".join(lines),
                    },
                }
            ],
        },
    }
    if len(json.dumps(message, ensure_ascii=False).encode("utf-8")) > MAX_CARD_BYTES:
        message["card"]["elements"][0]["text"]["content"] = "\n\n".join(lines[:6])
    return message


async def send_lark_alert(route: LarkRoute, alert: dict[str, Any]) -> dict[str, Any]:
    if not route.webhook:
        raise LarkAlertError(f"missing_lark_webhook:{route.name}")

    timestamp = int(time.time())
    body = build_lark_card(alert)
    if route.secret:
        body = {
            "timestamp": str(timestamp),
            "sign": _sign_lark_request(route.secret, timestamp),
            **body,
        }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.post(route.webhook, json=body)
    except Exception as exc:  # pragma: no cover: httpx transport exceptions vary by OS/socket layer.
        logger.exception(
            "alert_trigger=LARK_RELAY_FAILURE route=%s error=%s",
            route.name,
            exc.__class__.__name__,
        )
        raise LarkAlertError(str(exc)) from exc

    if response.status_code < HTTP_OK_MIN or response.status_code >= HTTP_OK_MAX_EXCLUSIVE:
        logger.error(
            "alert_trigger=LARK_RELAY_FAILURE route=%s http_status=%s",
            route.name,
            response.status_code,
        )
        raise LarkAlertError(f"lark_webhook_http_{response.status_code}")

    return {"ok": True, "route": route.name, "status": response.status_code}
