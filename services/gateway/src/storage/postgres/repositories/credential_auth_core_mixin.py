"""Credential auth repository — core helpers, profile, and credential prep mixin."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional, TypeVar

from pydantic import BaseModel

from src.domain.identity import (
    OwnerAccountRecord,
    OwnerProfileRecord,
    RuntimeCredentialRecord,
)
from src.utils.datetime_utils import now_dt_str, to_dt_str

StateModel = TypeVar("StateModel", bound=BaseModel)



class CredentialAuthCoreMixin:
    """Static helpers, profile ops, and credential preparation."""

    @staticmethod
    def _owner_id(wallet: str) -> str:
        return f"owner:{str(wallet or '').lower()}"

    @staticmethod
    def _agent_id(credential_type: str, wallet: str) -> str:
        return f"agent:{str(credential_type or '').lower()}:{str(wallet or '').lower()}"

    @staticmethod
    def _policy_id(credential_id: str) -> str:
        return f"policy:{credential_id}"

    @staticmethod
    def _credential_state_key(credential_type: str, credential_id: str) -> str:
        return f"credential_meta::{str(credential_type or '').lower()}::{credential_id}"

    @staticmethod
    def _auth_session_state_key(wallet: str) -> str:
        return f"auth_session::{str(wallet or '').lower()}"

    @staticmethod
    def _json_object(value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            return dict(value)
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except Exception:
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return {}

    @classmethod
    def _normalize_state_value(cls, value: Any) -> Any:
        if isinstance(value, dict):
            return {
                str(key): cls._normalize_state_value(item)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [cls._normalize_state_value(item) for item in value]
        if isinstance(value, datetime):
            return to_dt_str(value, "") or ""
        return value

    @classmethod
    def _parse_state_model(
        cls,
        value: Any,
        model_cls: type[StateModel],
        fallback: Optional[dict[str, Any]] = None,
    ) -> Optional[StateModel]:
        payload = cls._json_object(value)
        merged = cls._normalize_state_value(dict(fallback or {}))
        merged.update(payload)
        if not merged:
            return None
        return model_cls.model_validate(cls._normalize_state_value(merged))

    @classmethod
    def _string_list(cls, value: Any) -> list[str]:
        if isinstance(value, list):
            return [str(item) for item in value if str(item or "")]
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except Exception:
                return []
            if isinstance(parsed, list):
                return [str(item) for item in parsed if str(item or "")]
        return []

    def _ensure_owner_account(self, cur: Any, owner: OwnerAccountRecord) -> str:
        normalized_wallet = str(owner.owner_wallet or "").lower()
        owner_id = str(owner.owner_id or self._owner_id(normalized_wallet))
        created_at = to_dt_str(owner.created_at, now_dt_str())
        updated_at = to_dt_str(owner.updated_at, created_at)
        cur.execute(
            """
            INSERT INTO synapse_owner_accounts (
                owner_id, owner_wallet, status, default_currency, created_at, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (owner_id)
            DO UPDATE SET
                owner_wallet = EXCLUDED.owner_wallet,
                status = EXCLUDED.status,
                default_currency = EXCLUDED.default_currency,
                updated_at = EXCLUDED.updated_at
            """,
            (
                owner_id,
                normalized_wallet,
                owner.status,
                owner.default_currency,
                created_at,
                updated_at,
            ),
        )
        return owner_id

    @staticmethod
    def _row_to_owner_profile(row: Any) -> OwnerProfileRecord:
        (
            owner_id,
            owner_wallet,
            display_name,
            email,
            email_verified,
            pending_email,
            email_verification_expires_at,
            email_verification_attempts,
            email_verification_send_count,
            email_verification_send_count_date,
            notify_marketing,
            notify_alerts,
            status,
            default_currency,
            created_at,
            updated_at,
        ) = row
        return OwnerProfileRecord(
            ownerId=owner_id,
            ownerWallet=str(owner_wallet or "").lower(),
            displayName=display_name,
            email=email,
            emailVerified=bool(email_verified),
            pendingEmail=pending_email,
            emailVerificationExpiresAt=(
                to_dt_str(email_verification_expires_at)
                if email_verification_expires_at
                else None
            ),
            emailVerificationAttempts=int(email_verification_attempts or 0),
            emailVerificationSendCount=int(email_verification_send_count or 0),
            emailVerificationSendCountDate=(
                str(email_verification_send_count_date)
                if email_verification_send_count_date
                else None
            ),
            notifyMarketing=bool(notify_marketing),
            notifyAlerts=bool(notify_alerts),
            status=status,
            defaultCurrency=default_currency,
            createdAt=to_dt_str(created_at),
            updatedAt=to_dt_str(updated_at),
        )

    def read_owner_profile(
        self, wallet: str, *, ensure_exists: bool = True
    ) -> Optional[OwnerProfileRecord]:
        normalized_wallet = str(wallet or "").strip().lower()
        if not normalized_wallet:
            return None

        if ensure_exists:
            with self._db.tx_cursor() as cur:
                owner_id = self._ensure_owner_account(
                    cur,
                    OwnerAccountRecord(
                        ownerId=self._owner_id(normalized_wallet),
                        ownerWallet=normalized_wallet,
                    ),
                )
                cur.execute(
                    """
                    SELECT
                        owner_id,
                        owner_wallet,
                        display_name,
                        email,
                        email_verified,
                        pending_email,
                        email_verification_expires_at,
                        email_verification_attempts,
                        email_verification_send_count,
                        email_verification_send_count_date,
                        notify_marketing,
                        notify_alerts,
                        status,
                        default_currency,
                        created_at,
                        updated_at
                    FROM synapse_owner_accounts
                    WHERE owner_id = %s
                    """,
                    (owner_id,),
                )
                row = cur.fetchone()
        else:
            with self._db.readonly_cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        owner_id,
                        owner_wallet,
                        display_name,
                        email,
                        email_verified,
                        pending_email,
                        email_verification_expires_at,
                        email_verification_attempts,
                        email_verification_send_count,
                        email_verification_send_count_date,
                        notify_marketing,
                        notify_alerts,
                        status,
                        default_currency,
                        created_at,
                        updated_at
                    FROM synapse_owner_accounts
                    WHERE owner_wallet = %s
                    """,
                    (normalized_wallet,),
                )
                row = cur.fetchone()
        if not row:
            return None
        return self._row_to_owner_profile(row)

    def update_owner_profile(
        self,
        wallet: str,
        *,
        display_name: Optional[str],
        email: Optional[str],
        notify_marketing: bool,
        notify_alerts: bool,
    ) -> OwnerProfileRecord:
        normalized_wallet = str(wallet or "").strip().lower()
        normalized_display_name = str(display_name or "").strip() or None
        normalized_email = str(email or "").strip().lower() or None
        with self._db.tx_cursor() as cur:
            owner_id = self._ensure_owner_account(
                cur,
                OwnerAccountRecord(
                    ownerId=self._owner_id(normalized_wallet),
                    ownerWallet=normalized_wallet,
                ),
            )
            if normalized_email:
                cur.execute(
                    """
                    SELECT owner_id
                    FROM synapse_owner_accounts
                    WHERE lower(email) = lower(%s)
                      AND owner_id <> %s
                    LIMIT 1
                    """,
                    (normalized_email, owner_id),
                )
                if cur.fetchone():
                    raise ValueError("EMAIL_ALREADY_IN_USE")
            cur.execute(
                """
                UPDATE synapse_owner_accounts
                SET
                    display_name = %s,
                    email = CASE
                        WHEN %s::text IS NULL THEN NULL
                        WHEN COALESCE(lower(email), '') = lower(%s) THEN email
                        ELSE email
                    END,
                    email_verified = CASE
                        WHEN %s::text IS NULL THEN FALSE
                        WHEN COALESCE(lower(email), '') = lower(%s) THEN email_verified
                        ELSE email_verified
                    END,
                    pending_email = CASE
                        WHEN %s::text IS NULL THEN NULL
                        WHEN COALESCE(lower(email), '') = lower(%s) THEN NULL
                        ELSE %s
                    END,
                    email_verification_code_hash = CASE
                        WHEN %s::text IS NULL OR COALESCE(lower(email), '') = lower(%s)
                            THEN NULL
                        ELSE email_verification_code_hash
                    END,
                    email_verification_expires_at = CASE
                        WHEN %s::text IS NULL OR COALESCE(lower(email), '') = lower(%s)
                            THEN NULL
                        ELSE email_verification_expires_at
                    END,
                    email_verification_attempts = CASE
                        WHEN %s::text IS NULL OR COALESCE(lower(email), '') = lower(%s)
                            THEN 0
                        ELSE email_verification_attempts
                    END,
                    email_verification_requested_at = CASE
                        WHEN %s::text IS NULL OR COALESCE(lower(email), '') = lower(%s)
                            THEN NULL
                        ELSE email_verification_requested_at
                    END,
                    notify_marketing = %s,
                    notify_alerts = %s,
                    updated_at = NOW()
                WHERE owner_id = %s
                RETURNING
                    owner_id,
                    owner_wallet,
                    display_name,
                    email,
                    email_verified,
                    pending_email,
                    email_verification_expires_at,
                    email_verification_attempts,
                    email_verification_send_count,
                    email_verification_send_count_date,
                    notify_marketing,
                    notify_alerts,
                    status,
                    default_currency,
                    created_at,
                    updated_at
                """,
                (
                    normalized_display_name,
                    normalized_email,
                    normalized_email,
                    normalized_email,
                    normalized_email,
                    normalized_email,
                    normalized_email,
                    normalized_email,
                    normalized_email,
                    normalized_email,
                    normalized_email,
                    normalized_email,
                    normalized_email,
                    normalized_email,
                    normalized_email,
                    normalized_email,
                    bool(notify_marketing),
                    bool(notify_alerts),
                    owner_id,
                ),
            )
            row = cur.fetchone()
        return self._row_to_owner_profile(row)

    def _ensure_agent_profile(self, cur: Any, record: RuntimeCredentialRecord) -> str:
        runtime_label = str(record.agent.runtime_label or "").lower()
        owner = record.owner.model_copy(
            update={
                "owner_id": str(
                    record.owner.owner_id or self._owner_id(record.owner.owner_wallet)
                ),
                "owner_wallet": str(record.owner.owner_wallet or "").lower(),
            }
        )
        owner_id = self._ensure_owner_account(cur, owner)
        agent_id = str(record.agent.agent_id or self._agent_id(runtime_label, owner.owner_wallet))
        created_at = to_dt_str(record.agent.created_at, now_dt_str())
        updated_at = to_dt_str(record.agent.updated_at, created_at)
        cur.execute(
            """
            INSERT INTO synapse_agent_profiles (
                agent_id, owner_id, name, purpose, status, runtime_label, created_at, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (agent_id)
            DO UPDATE SET
                owner_id = EXCLUDED.owner_id,
                name = EXCLUDED.name,
                purpose = EXCLUDED.purpose,
                status = EXCLUDED.status,
                runtime_label = EXCLUDED.runtime_label,
                updated_at = EXCLUDED.updated_at
            """,
            (
                agent_id,
                owner_id,
                record.agent.name,
                record.agent.purpose,
                record.agent.status,
                runtime_label,
                created_at,
                updated_at,
            ),
        )
        return agent_id

    def _upsert_runtime_state(
        self,
        cur: Any,
        state_key: str,
        state: BaseModel,
        updated_at: str | None = None,
    ) -> None:
        cur.execute(
            """
            INSERT INTO synapse_runtime_state (state_key, payload, updated_at)
            VALUES (%s, %s::jsonb, %s)
            ON CONFLICT (state_key)
            DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
            """,
            (
                state_key,
                json.dumps(state.model_dump(by_alias=True, mode="json")),
                to_dt_str(updated_at, now_dt_str()),
            ),
        )
