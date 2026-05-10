from __future__ import annotations

from datetime import datetime, timezone

import pytest

from src.core.totp_secret_store import build_inline_totp_secret_ref, payload_totp_metadata
from src.core.totp import generate_totp_code, generate_totp_secret
from src.domain import AdminMfaFactor
from src.domain.enums import MfaFactorStatus, MfaFactorType
from src.services.auth.google_authenticator import verify_google_authenticator_code


def test_google_authenticator_default_window_accepts_adjacent_totp_steps() -> None:
    secret = generate_totp_secret()
    factor = AdminMfaFactor(
        factor_id="totp_window_test",
        admin_id="admin_totp_window",
        factor_type=MfaFactorType.TOTP,
        factor_label="bootstrap_totp",
        status=MfaFactorStatus.ACTIVE,
        payload={"totpSecret": secret},
    )
    now = int(datetime(2026, 4, 28, 1, 30, tzinfo=timezone.utc).timestamp())

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("time.time", lambda: now)
        assert verify_google_authenticator_code(factor, generate_totp_code(secret, for_time=now))
        assert verify_google_authenticator_code(factor, generate_totp_code(secret, for_time=now - 30))
        assert verify_google_authenticator_code(factor, generate_totp_code(secret, for_time=now + 30))
        assert not verify_google_authenticator_code(factor, generate_totp_code(secret, for_time=now + 60))


def test_google_authenticator_accepts_secret_ref_storage() -> None:
    secret = generate_totp_secret()
    factor = AdminMfaFactor(
        factor_id="totp_window_secret_ref",
        admin_id="admin_totp_window",
        factor_type=MfaFactorType.TOTP,
        factor_label="primary",
        status=MfaFactorStatus.ACTIVE,
        secret_ref=build_inline_totp_secret_ref(secret),
        payload=payload_totp_metadata(secret),
    )
    now = int(datetime(2026, 4, 28, 1, 30, tzinfo=timezone.utc).timestamp())

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("time.time", lambda: now)
        assert verify_google_authenticator_code(factor, generate_totp_code(secret, for_time=now))
