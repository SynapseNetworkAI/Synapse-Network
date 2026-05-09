from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import logging
import re
import threading
import time
from typing import Any
from uuid import uuid4

import httpx

from src.core.common import normalize_wallet
from src.core.config import settings
from src.services.notifications.models import NotificationIntent
from src.services.notifications.sanitizer import mask_email, redact_payload, redact_text
from src.storage.base import BaseStorage

logger = logging.getLogger("synapse.notifications.transactional")

HTTP_OK_MIN = 200
HTTP_REDIRECT_MIN = 300

TRANSACTION_EMAIL_TEMPLATES = frozenset(
    {
        "deposit_confirmed",
        "refund_completed",
        "consumer_withdrawal_ticket_ready",
        "consumer_withdrawal_completed",
        "consumer_withdrawal_failed_expired",
        "provider_withdrawal_ticket_ready",
        "provider_withdrawal_completed",
        "provider_withdrawal_rejected",
        "provider_withdrawal_failed_expired",
        "email_verification",
        "email_bound_success",
        "email_changed_notice",
        "email_removed_notice",
    }
)


def build_public_app_url(path: str = "/dashboard") -> str:
    """Return a user-facing app URL for email/Lark CTAs.

    This is intentionally separate from ``PUBLIC_GATEWAY_BASE_URL``. Gateway
    URLs are for API callbacks such as email verification; receipt CTAs must
    take the user to User-front.
    """

    base = (settings.public_app_base_url or settings.public_gateway_base_url or "").rstrip("/")
    route = f"/{str(path or '').lstrip('/')}"
    return f"{base}{route}" if base else route


def _resource_id(payload: dict[str, Any], fallback: str = "unknown") -> str:
    for key in ("depositId", "refundId", "withdrawalId", "requestId"):
        value = payload.get(key)
        if value not in (None, ""):
            return str(value)
    return fallback


def _email_safe_key(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.:-]+", "-", str(value or "").strip())[:180] or uuid4().hex


async def _post_notification_outbox_trigger() -> bool:
    if (
        not settings.notification_outbox_trigger_enabled
        or not settings.internal_trigger_secret
        or not settings.notification_outbox_trigger_url
    ):
        return False
    try:
        async with httpx.AsyncClient(
            timeout=settings.notification_outbox_trigger_timeout_sec,
            trust_env=False,
        ) as client:
            response = await client.post(
                settings.notification_outbox_trigger_url,
                headers={
                    "X-Synapse-Internal-Token": settings.internal_trigger_secret,
                },
                json={"source": "notification_outbox_enqueue"},
            )
        if response.status_code < HTTP_OK_MIN or response.status_code >= HTTP_REDIRECT_MIN:
            logger.warning(
                "NOTIFICATION_OUTBOX_TRIGGER_FAILED status=%s",
                response.status_code,
            )
            return False
    except Exception:
        logger.exception("NOTIFICATION_OUTBOX_TRIGGER_FAILED")
        return False
    return True


def _schedule_notification_outbox_trigger() -> None:
    if (
        not settings.notification_outbox_trigger_enabled
        or not settings.internal_trigger_secret
        or not settings.notification_outbox_trigger_url
    ):
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        threading.Thread(
            target=lambda: asyncio.run(_post_notification_outbox_trigger()),
            daemon=True,
            name="notification-outbox-trigger",
        ).start()
        return
    loop.create_task(_post_notification_outbox_trigger())


def _owner_profile(storage: BaseStorage, owner_wallet: str):
    try:
        return storage.get_data_manager().system.credential_auth.read_owner_profile(
            owner_wallet,
            ensure_exists=False,
        )
    except Exception:
        logger.exception("TRANSACTION_NOTIFICATION_PROFILE_LOOKUP_FAILED")
        return None


def build_notification_intent_for_owner(
    *,
    owner_wallet: str,
    recipient_email: str,
    template_key: str,
    event_type: str,
    resource_id: str,
    payload: dict[str, Any],
    priority: str = "transactional_high",
) -> NotificationIntent:
    owner = normalize_wallet(owner_wallet)
    safe_template = _email_safe_key(template_key)
    safe_resource = _email_safe_key(resource_id)
    return NotificationIntent(
        notification_id=f"email-{safe_template}-{safe_resource}-{uuid4().hex}",
        dedupe_key=f"email:{event_type}:{owner}:{safe_resource}",
        event_type=event_type,
        recipient_email=str(recipient_email or "").strip().lower(),
        recipient_owner_id=owner,
        priority=priority,
        template_key=template_key,
        template_version="v1",
        payload=redact_payload(payload),
    )


def enqueue_transaction_email(
    storage: BaseStorage,
    *,
    owner_wallet: str,
    template_key: str,
    event_type: str,
    payload: dict[str, Any],
    require_verified_email: bool = True,
) -> bool:
    """Best-effort enqueue for money emails. Never call inside a DB transaction."""

    if template_key not in TRANSACTION_EMAIL_TEMPLATES:
        logger.warning("TRANSACTION_EMAIL_TEMPLATE_SKIPPED template=%s", template_key)
        return False
    profile = _owner_profile(storage, owner_wallet)
    email = str(getattr(profile, "email", "") or "").strip().lower()
    if not email:
        return False
    if require_verified_email and not bool(getattr(profile, "email_verified", False)):
        logger.info(
            "TRANSACTION_EMAIL_SKIPPED_UNVERIFIED owner=%s email=%s template=%s",
            normalize_wallet(owner_wallet),
            mask_email(email),
            template_key,
        )
        return False
    intent = build_notification_intent_for_owner(
        owner_wallet=owner_wallet,
        recipient_email=email,
        template_key=template_key,
        event_type=event_type,
        resource_id=_resource_id(payload),
        payload=payload,
    )
    try:
        storage.enqueue_notification_outbox(intent)
    except Exception:
        logger.exception(
            "TRANSACTION_EMAIL_ENQUEUE_FAILED",
            extra={"event_type": event_type, "template_key": template_key},
        )
        return False
    else:
        _schedule_notification_outbox_trigger()
        return True


def enqueue_email_verification_code(
    storage: BaseStorage,
    *,
    owner_wallet: str,
    recipient_email: str,
    code: str,
    expires_in_minutes: int,
) -> bool:
    """Enqueue the one-time email binding code to the pending recipient."""

    owner = normalize_wallet(owner_wallet)
    intent = build_notification_intent_for_owner(
        owner_wallet=owner,
        recipient_email=recipient_email,
        template_key="email_verification",
        event_type="security.email_verification_code_requested",
        resource_id=f"email-code:{owner}:{_email_safe_key(recipient_email)}",
        payload={
            "requestId": f"email-code:{owner}",
            "status": "PENDING_VERIFICATION",
            "verificationCode": code,
            "expiresInMinutes": str(expires_in_minutes),
            "emailMasked": mask_email(recipient_email),
            "wallet": owner,
        },
    )
    try:
        storage.enqueue_notification_outbox(intent)
    except Exception:
        logger.exception(
            "EMAIL_VERIFICATION_CODE_ENQUEUE_FAILED",
            extra={"owner": owner, "email": mask_email(recipient_email)},
        )
        return False
    _schedule_notification_outbox_trigger()
    return True


def enqueue_account_email_notice(
    storage: BaseStorage,
    *,
    owner_wallet: str,
    recipient_email: str,
    template_key: str,
    event_type: str,
    payload: dict[str, Any],
) -> bool:
    """Best-effort account email notice for verified email lifecycle changes."""

    if template_key not in TRANSACTION_EMAIL_TEMPLATES:
        logger.warning("ACCOUNT_EMAIL_NOTICE_TEMPLATE_SKIPPED template=%s", template_key)
        return False
    email = str(recipient_email or "").strip().lower()
    if not email:
        return False
    intent = build_notification_intent_for_owner(
        owner_wallet=owner_wallet,
        recipient_email=email,
        template_key=template_key,
        event_type=event_type,
        resource_id=f"{template_key}:{normalize_wallet(owner_wallet)}:{_email_safe_key(email)}",
        payload=payload,
        priority="transactional_high",
    )
    try:
        storage.enqueue_notification_outbox(intent)
    except Exception:
        logger.exception(
            "ACCOUNT_EMAIL_NOTICE_ENQUEUE_FAILED",
            extra={"event_type": event_type, "template_key": template_key},
        )
        return False
    _schedule_notification_outbox_trigger()
    return True


def _sign_lark_request(secret: str, timestamp: int) -> str:
    string_to_sign = f"{timestamp}\n{secret}".encode("utf-8")
    digest = hmac.new(string_to_sign, b"", hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def _short(value: Any, max_chars: int = 220) -> str:
    return redact_text(str(value or ""), max_chars=max_chars)


async def _send_lark_transaction_event(
    *,
    template_key: str,
    event_type: str,
    owner_wallet: str,
    payload: dict[str, Any],
) -> bool:
    if not settings.transaction_lark_enabled or not settings.transaction_lark_webhook_url:
        return False
    sanitized = redact_payload(payload)
    amount = sanitized.get("amount") or sanitized.get("amountUsdc") or "n/a"
    status = sanitized.get("status") or "n/a"
    reference = _resource_id(sanitized)
    tx_hash = sanitized.get("txHash") or sanitized.get("transactionHash") or ""
    lines = [
        "**Marker**: STAGING_TRANSACTION_EVENT",
        f"**Event**: {_short(event_type, 120)}",
        f"**Template**: {_short(template_key, 120)}",
        f"**Owner**: {_short(normalize_wallet(owner_wallet), 80)}",
        f"**Status**: {_short(status, 80)}",
        f"**Amount**: {_short(amount, 80)}",
        f"**Reference**: {_short(reference, 160)}",
    ]
    if tx_hash:
        lines.append(f"**Tx**: {_short(tx_hash, 120)}")
    lines.append("**Action**: NO_ACTION_REQUIRED staging transaction watch.")
    body: dict[str, Any] = {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {
                "template": "green" if str(status).upper() in {"CONFIRMED", "COMPLETED", "SIGNED"} else "orange",
                "title": {"tag": "plain_text", "content": f"[STAGING][TRANSACTION] {_short(event_type, 80)}"},
            },
            "elements": [
                {
                    "tag": "div",
                    "text": {"tag": "lark_md", "content": "\n\n".join(lines)},
                }
            ],
        },
    }
    if settings.transaction_lark_secret:
        timestamp = int(time.time())
        body = {
            "timestamp": str(timestamp),
            "sign": _sign_lark_request(settings.transaction_lark_secret, timestamp),
            **body,
        }
    try:
        async with httpx.AsyncClient(timeout=settings.transaction_lark_timeout_sec, trust_env=False) as client:
            response = await client.post(settings.transaction_lark_webhook_url, json=body)
        if response.status_code < HTTP_OK_MIN or response.status_code >= HTTP_REDIRECT_MIN:
            logger.error("TRANSACTION_LARK_SEND_FAILED status=%s template=%s", response.status_code, template_key)
            return False
        logger.info(
            "alert_trigger=STAGING_TRANSACTION_EVENT event_type=%s template=%s reference=%s",
            event_type,
            template_key,
            reference,
        )
    except Exception:
        logger.exception("TRANSACTION_LARK_SEND_FAILED")
        return False
    else:
        return True


def schedule_transaction_notifications(
    storage: BaseStorage,
    *,
    owner_wallet: str,
    template_key: str,
    event_type: str,
    payload: dict[str, Any],
    require_verified_email: bool = True,
    send_lark: bool = True,
) -> None:
    """Run email + staging Lark side effects after the business mutation succeeded."""

    def _write_email() -> None:
        enqueue_transaction_email(
            storage,
            owner_wallet=owner_wallet,
            template_key=template_key,
            event_type=event_type,
            payload=payload,
            require_verified_email=require_verified_email,
        )

    async def _write_all() -> None:
        await asyncio.to_thread(_write_email)
        if send_lark:
            await _send_lark_transaction_event(
                template_key=template_key,
                event_type=event_type,
                owner_wallet=owner_wallet,
                payload=payload,
            )

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        _write_email()
        return
    loop.create_task(_write_all())
