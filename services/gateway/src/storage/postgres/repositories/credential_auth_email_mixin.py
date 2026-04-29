"""Credential auth repository — email verification helpers."""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

from src.domain.identity import OwnerProfileRecord

EMAIL_VERIFICATION_MAX_ATTEMPTS = 5


class CredentialAuthEmailMixin:
    """Email verification code persistence for owner profiles."""

    @staticmethod
    def _email_verification_is_expired(expires_at: object, now: datetime) -> bool:
        if not expires_at:
            return True
        if isinstance(expires_at, datetime):
            candidate = expires_at
            if candidate.tzinfo is None and now.tzinfo is not None:
                candidate = candidate.replace(tzinfo=timezone.utc)
            return candidate < now
        try:
            candidate = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
        except ValueError:
            return True
        if candidate.tzinfo is None and now.tzinfo is not None:
            candidate = candidate.replace(tzinfo=timezone.utc)
        return candidate < now

    def prepare_owner_email_verification_code(
        self,
        wallet: str,
        email: str,
        *,
        code_hash: str,
        expires_at: datetime,
        daily_limit: int,
        send_date: date,
    ) -> OwnerProfileRecord:
        normalized_wallet = str(wallet or "").strip().lower()
        normalized_email = str(email or "").strip().lower()
        if not normalized_wallet or not normalized_email or not code_hash:
            raise ValueError("EMAIL_VERIFICATION_INVALID_REQUEST")
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                SELECT email_verification_send_count, email_verification_send_count_date
                FROM synapse_owner_accounts
                WHERE owner_wallet = %s
                FOR UPDATE
                """,
                (normalized_wallet,),
            )
            row = cur.fetchone()
            if not row:
                raise ValueError("EMAIL_VERIFICATION_PROFILE_NOT_FOUND")
            current_count, current_date = row
            effective_count = int(current_count or 0) if current_date == send_date else 0
            if effective_count >= daily_limit:
                raise ValueError("EMAIL_VERIFICATION_DAILY_LIMIT_REACHED")
            cur.execute(
                """
                UPDATE synapse_owner_accounts
                SET pending_email = %s,
                    email_verification_code_hash = %s,
                    email_verification_expires_at = %s,
                    email_verification_attempts = 0,
                    email_verification_requested_at = NOW(),
                    updated_at = NOW()
                WHERE owner_wallet = %s
                RETURNING
                    owner_id, owner_wallet, display_name, email, email_verified,
                    pending_email, email_verification_expires_at,
                    email_verification_attempts, email_verification_send_count,
                    email_verification_send_count_date, notify_marketing,
                    notify_alerts, status, default_currency, created_at, updated_at
                """,
                (normalized_email, code_hash, expires_at, normalized_wallet),
            )
            profile_row = cur.fetchone()
        return self._row_to_owner_profile(profile_row)

    def mark_owner_email_verification_sent(
        self,
        wallet: str,
        email: str,
        *,
        send_date: date,
    ) -> Optional[OwnerProfileRecord]:
        normalized_wallet = str(wallet or "").strip().lower()
        normalized_email = str(email or "").strip().lower()
        if not normalized_wallet or not normalized_email:
            return None
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_owner_accounts
                SET email_verification_send_count = CASE
                        WHEN email_verification_send_count_date = %s
                            THEN email_verification_send_count + 1
                        ELSE 1
                    END,
                    email_verification_send_count_date = %s,
                    updated_at = NOW()
                WHERE owner_wallet = %s
                  AND lower(pending_email) = lower(%s)
                RETURNING
                    owner_id, owner_wallet, display_name, email, email_verified,
                    pending_email, email_verification_expires_at,
                    email_verification_attempts, email_verification_send_count,
                    email_verification_send_count_date, notify_marketing,
                    notify_alerts, status, default_currency, created_at, updated_at
                """,
                (send_date, send_date, normalized_wallet, normalized_email),
            )
            row = cur.fetchone()
        return self._row_to_owner_profile(row) if row else None

    def verify_owner_email_code(
        self,
        wallet: str,
        email: str,
        *,
        code_hash: str,
        now: datetime,
    ) -> OwnerProfileRecord:
        normalized_wallet = str(wallet or "").strip().lower()
        normalized_email = str(email or "").strip().lower()
        if not normalized_wallet or not normalized_email or not code_hash:
            raise ValueError("EMAIL_VERIFICATION_INVALID_REQUEST")
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                SELECT pending_email, email_verification_code_hash,
                       email_verification_expires_at, email_verification_attempts
                FROM synapse_owner_accounts
                WHERE owner_wallet = %s
                FOR UPDATE
                """,
                (normalized_wallet,),
            )
            pending = cur.fetchone()
            if not pending:
                raise ValueError("EMAIL_VERIFICATION_PROFILE_NOT_FOUND")
            pending_email, stored_hash, expires_at, attempts = pending
            if not pending_email or str(pending_email).lower() != normalized_email:
                raise ValueError("EMAIL_VERIFICATION_NOT_PENDING")
            if int(attempts or 0) >= EMAIL_VERIFICATION_MAX_ATTEMPTS:
                raise ValueError("EMAIL_VERIFICATION_ATTEMPTS_EXCEEDED")
            if self._email_verification_is_expired(expires_at, now):
                raise ValueError("EMAIL_VERIFICATION_EXPIRED")
            if stored_hash != code_hash:
                cur.execute(
                    """
                    UPDATE synapse_owner_accounts
                    SET email_verification_attempts = email_verification_attempts + 1,
                        updated_at = NOW()
                    WHERE owner_wallet = %s
                    """,
                    (normalized_wallet,),
                )
                raise ValueError("EMAIL_VERIFICATION_INVALID_CODE")
            cur.execute(
                """
                SELECT owner_id
                FROM synapse_owner_accounts
                WHERE lower(email) = lower(%s)
                  AND owner_wallet <> %s
                LIMIT 1
                """,
                (normalized_email, normalized_wallet),
            )
            if cur.fetchone():
                raise ValueError("EMAIL_ALREADY_IN_USE")
            cur.execute(
                """
                UPDATE synapse_owner_accounts
                SET email = pending_email,
                    email_verified = TRUE,
                    pending_email = NULL,
                    email_verification_code_hash = NULL,
                    email_verification_expires_at = NULL,
                    email_verification_attempts = 0,
                    email_verification_requested_at = NULL,
                    updated_at = NOW()
                WHERE owner_wallet = %s
                RETURNING
                    owner_id, owner_wallet, display_name, email, email_verified,
                    pending_email, email_verification_expires_at,
                    email_verification_attempts, email_verification_send_count,
                    email_verification_send_count_date, notify_marketing,
                    notify_alerts, status, default_currency, created_at, updated_at
                """,
                (normalized_wallet,),
            )
            row = cur.fetchone()
        return self._row_to_owner_profile(row)
