"""Owner email verification helpers for auth router."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta

from fastapi import HTTPException

from src.core.config import settings
from src.services.notifications.email_verification import (
    create_email_verification_code,
    hash_email_verification_code,
)
from src.services.notifications.transactional import enqueue_email_verification_code
from src.storage import BaseStorage
from src.utils.datetime_utils import now_dt_str

EMAIL_VERIFICATION_MAX_ATTEMPTS = 5


def email_verification_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def email_verification_status(row) -> str:
    if not getattr(row, "pending_email", None):
        return "none"
    if int(getattr(row, "email_verification_attempts", 0) or 0) >= EMAIL_VERIFICATION_MAX_ATTEMPTS:
        return "locked"
    expires_at = str(getattr(row, "email_verification_expires_at", "") or "")
    if not expires_at or expires_at < now_dt_str():
        return "expired"
    return "pending"


def email_verification_sends_remaining(row) -> int:
    count_date = str(getattr(row, "email_verification_send_count_date", "") or "")
    count = int(getattr(row, "email_verification_send_count", 0) or 0)
    if count_date != datetime.now(timezone.utc).date().isoformat():
        count = 0
    return max(0, int(settings.email_verification_daily_send_limit) - count)


def send_owner_email_verification_code(
    storage: BaseStorage,
    *,
    owner: str,
    email: str,
):
    code = create_email_verification_code()
    expires_at = datetime.now(timezone.utc) + timedelta(
        seconds=int(settings.email_verification_ttl_sec)
    )
    repo = storage.get_data_manager().system.credential_auth
    try:
        profile = repo.prepare_owner_email_verification_code(
            owner,
            email,
            code_hash=hash_email_verification_code(
                owner_wallet=owner,
                email=email,
                code=code,
            ),
            expires_at=expires_at,
            daily_limit=int(settings.email_verification_daily_send_limit),
            send_date=datetime.now(timezone.utc).date(),
        )
    except ValueError as exc:
        if str(exc) == "EMAIL_VERIFICATION_DAILY_LIMIT_REACHED":
            raise email_verification_error(
                429,
                "EMAIL_VERIFICATION_DAILY_LIMIT_REACHED",
                "Daily email verification limit reached. Please try again tomorrow.",
            ) from exc
        raise

    sent = enqueue_email_verification_code(
        storage,
        owner_wallet=owner,
        recipient_email=email,
        code=code,
        expires_in_minutes=max(1, int(settings.email_verification_ttl_sec) // 60),
    )
    if not sent:
        raise email_verification_error(
            502,
            "EMAIL_VERIFICATION_SEND_FAILED",
            "Failed to send email verification code. Please try again.",
        )
    return repo.mark_owner_email_verification_sent(
        owner,
        email,
        send_date=datetime.now(timezone.utc).date(),
    ) or profile
