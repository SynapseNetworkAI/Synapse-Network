# pyright: reportMissingImports=false

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

import pytest

from src.storage.postgres.repositories.credential_auth_repository import (
    CredentialAuthRepository,
)
from tests.unit.storage.test_postgres_repositories_unit import FakeDB, _q6


def _owner_profile_row(
    *,
    email: str | None = "ops@synapse.test",
    email_verified: bool = True,
    pending_email: str | None = None,
    attempts: int = 0,
    send_count: int = 0,
    send_date: str | None = None,
) -> tuple[Any, ...]:
    return (
        "owner:0xabc",
        "0xabc",
        "Infra Desk",
        email,
        email_verified,
        pending_email,
        "2026-04-03 10:10:00" if pending_email else None,
        attempts,
        send_count,
        send_date,
        False,
        True,
        "active",
        "USDC",
        "2026-04-03 10:00:00",
        "2026-04-03 10:07:00",
    )


def test_email_verification_expiry_helper_handles_empty_bad_and_naive_dates() -> None:
    repo = CredentialAuthRepository(FakeDB(), _q6)
    now = datetime(2026, 4, 3, 10, 0, 0, tzinfo=timezone.utc)

    assert repo._email_verification_is_expired(None, now) is True
    assert repo._email_verification_is_expired("not-a-date", now) is True
    assert (
        repo._email_verification_is_expired(
            datetime(2026, 4, 3, 9, 59, 0), now
        )
        is True
    )
    assert repo._email_verification_is_expired("2026-04-03T10:01:00Z", now) is False


def test_credential_auth_repository_prepare_email_code_enforces_daily_limit() -> None:
    db = FakeDB()
    db.tx_plan.append({"fetchone": [(5, date(2026, 4, 3))]})
    repo = CredentialAuthRepository(db, _q6)

    with pytest.raises(ValueError, match="EMAIL_VERIFICATION_DAILY_LIMIT_REACHED"):
        repo.prepare_owner_email_verification_code(
            "0xABC",
            "new@synapse.test",
            code_hash="hash",
            expires_at=datetime(2026, 4, 3, 10, 10, 0, tzinfo=timezone.utc),
            daily_limit=5,
            send_date=date(2026, 4, 3),
        )


def test_credential_auth_repository_prepare_and_mark_email_code_sent() -> None:
    db = FakeDB()
    db.tx_plan.append(
        {
            "fetchone": [
                (1, date(2026, 4, 2)),
                _owner_profile_row(
                    email="ops@synapse.test",
                    email_verified=True,
                    pending_email="new@synapse.test",
                    send_count=1,
                    send_date="2026-04-02",
                ),
            ]
        }
    )
    db.tx_plan.append(
        {
            "fetchone": [
                _owner_profile_row(
                    email="ops@synapse.test",
                    email_verified=True,
                    pending_email="new@synapse.test",
                    send_count=2,
                    send_date="2026-04-03",
                )
            ]
        }
    )
    repo = CredentialAuthRepository(db, _q6)

    prepared = repo.prepare_owner_email_verification_code(
        "0xABC",
        "NEW@SYNAPSE.TEST",
        code_hash="hash",
        expires_at=datetime(2026, 4, 3, 10, 10, 0, tzinfo=timezone.utc),
        daily_limit=5,
        send_date=date(2026, 4, 3),
    )
    sent = repo.mark_owner_email_verification_sent(
        "0xABC",
        "NEW@SYNAPSE.TEST",
        send_date=date(2026, 4, 3),
    )

    assert prepared.pending_email == "new@synapse.test"
    assert sent is not None
    assert sent.email_verification_send_count == 2
    assert (
        repo.mark_owner_email_verification_sent(
            "",
            "new@synapse.test",
            send_date=date(2026, 4, 3),
        )
        is None
    )


def test_credential_auth_repository_verify_email_code_rejects_pending_edge_cases() -> None:
    cases = [
        (
            None,
            "hash",
            datetime(2026, 4, 3, 10, 10, 0, tzinfo=timezone.utc),
            "EMAIL_VERIFICATION_PROFILE_NOT_FOUND",
        ),
        (
            (
                "other@synapse.test",
                "hash",
                datetime(2026, 4, 3, 10, 10, 0, tzinfo=timezone.utc),
                0,
            ),
            "hash",
            datetime(2026, 4, 3, 10, 10, 0, tzinfo=timezone.utc),
            "EMAIL_VERIFICATION_NOT_PENDING",
        ),
        (
            (
                "new@synapse.test",
                "hash",
                datetime(2026, 4, 3, 10, 10, 0, tzinfo=timezone.utc),
                5,
            ),
            "hash",
            datetime(2026, 4, 3, 10, 10, 0, tzinfo=timezone.utc),
            "EMAIL_VERIFICATION_ATTEMPTS_EXCEEDED",
        ),
        (
            (
                "new@synapse.test",
                "hash",
                datetime(2026, 4, 3, 9, 59, 0, tzinfo=timezone.utc),
                0,
            ),
            "hash",
            datetime(2026, 4, 3, 10, 0, 0, tzinfo=timezone.utc),
            "EMAIL_VERIFICATION_EXPIRED",
        ),
    ]

    for pending_row, code_hash, now, expected in cases:
        db = FakeDB()
        db.tx_plan.append({"fetchone": [] if pending_row is None else [pending_row]})
        repo = CredentialAuthRepository(db, _q6)

        with pytest.raises(ValueError, match=expected):
            repo.verify_owner_email_code(
                "0xABC",
                "new@synapse.test",
                code_hash=code_hash,
                now=now,
            )


def test_credential_auth_repository_verify_email_code_increments_invalid_attempts() -> None:
    db = FakeDB()
    db.tx_plan.append(
        {
            "fetchone": [
                (
                    "new@synapse.test",
                    "expected-hash",
                    datetime(2026, 4, 3, 10, 10, 0, tzinfo=timezone.utc),
                    2,
                )
            ]
        }
    )
    repo = CredentialAuthRepository(db, _q6)

    with pytest.raises(ValueError, match="EMAIL_VERIFICATION_INVALID_CODE"):
        repo.verify_owner_email_code(
            "0xABC",
            "new@synapse.test",
            code_hash="wrong-hash",
            now=datetime(2026, 4, 3, 10, 0, 0, tzinfo=timezone.utc),
        )

    assert any(
        "email_verification_attempts = email_verification_attempts + 1" in sql
        for sql, _ in db.tx_cursors[-1].executed
    )
