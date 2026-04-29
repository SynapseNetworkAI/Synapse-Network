from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import time
from typing import Any

import httpx

from src.core.common import normalize_wallet
from src.core.config import settings
from src.services.notifications.sanitizer import redact_payload, redact_text

logger = logging.getLogger("synapse.community.support_lark")

HTTP_OK_MIN = 200
HTTP_REDIRECT_MIN = 300


def _sign_lark_request(secret: str, timestamp: int) -> str:
    string_to_sign = f"{timestamp}\n{secret}".encode("utf-8")
    digest = hmac.new(string_to_sign, b"", hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def _short(value: Any, max_chars: int = 220) -> str:
    return redact_text(str(value or ""), max_chars=max_chars)


def _event_ref(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


async def send_support_case_lark_card(
    *,
    feedback_id: str,
    support_task_id: str | None,
    category: str,
    priority: str,
    owner_wallet: str | None,
    route: str,
    message: str,
    source: str,
) -> bool:
    if not settings.support_lark_enabled or not settings.support_lark_webhook_url:
        return False

    event_ref = _event_ref(feedback_id)
    owner = normalize_wallet(owner_wallet or "") or "anonymous"
    sanitized = redact_payload(
        {
            "feedbackId": feedback_id,
            "supportTaskId": support_task_id or "",
            "category": category,
            "priority": priority,
            "owner": owner,
            "route": route,
            "source": source,
            "message": message,
        }
    )
    admin_path = "/forum-support"
    if support_task_id:
        admin_path = f"{admin_path}?taskId={support_task_id}"
    lines = [
        "**Marker**: SUPPORT_CASE_CREATED",
        f"**Action**: {'NO_ACTION_REQUIRED staging support drill.' if settings.environment == 'staging' else 'Triage in Admin Console.'}",
        f"**Environment**: {_short(settings.environment, 80)}",
        f"**Category**: {_short(sanitized.get('category'), 80)}",
        f"**Priority**: {_short(sanitized.get('priority'), 80)}",
        f"**Feedback ID**: {_short(sanitized.get('feedbackId'), 120)}",
        f"**Support task**: {_short(sanitized.get('supportTaskId'), 120)}",
        f"**Owner**: {_short(sanitized.get('owner'), 80)}",
        f"**Route**: {_short(sanitized.get('route'), 220)}",
        f"**Admin**: `{admin_path}`",
        f"**Message**: {_short(sanitized.get('message'), 600)}",
    ]
    body: dict[str, Any] = {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {
                "template": "red" if priority in {"critical", "high"} else "orange",
                "title": {"tag": "plain_text", "content": f"[SUPPORT] {_short(category, 80)}"},
            },
            "elements": [{"tag": "div", "text": {"tag": "lark_md", "content": "\n\n".join(lines)}}],
        },
    }
    if settings.support_lark_secret:
        timestamp = int(time.time())
        body = {
            "timestamp": str(timestamp),
            "sign": _sign_lark_request(settings.support_lark_secret, timestamp),
            **body,
        }
    try:
        async with httpx.AsyncClient(timeout=settings.support_lark_timeout_sec, trust_env=False) as client:
            response = await client.post(settings.support_lark_webhook_url, json=body)
        if response.status_code < HTTP_OK_MIN or response.status_code >= HTTP_REDIRECT_MIN:
            logger.error(
                "SUPPORT_LARK_SEND_FAILED status=%s event_ref=%s",
                response.status_code,
                event_ref,
            )
            return False
        logger.info(
            "alert_trigger=SUPPORT_CASE_CREATED event_ref=%s task_ref=%s category=%s priority=%s",
            event_ref,
            _event_ref(support_task_id or "none"),
            category,
            priority,
        )
    except Exception:
        logger.warning("SUPPORT_LARK_SEND_FAILED event_ref=%s", event_ref)
        return False
    return True
