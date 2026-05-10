from datetime import datetime, timezone

from psycopg import errors as psycopg_errors
from psycopg.types.json import Jsonb

from src.domain import AdminMfaFactor
from src.domain.enums import MfaFactorStatus, MfaFactorType
from src.storage.admin_identity import postgres as identity_postgres


class _FakeCursor:
    def __init__(self, *, fail_first_insert: bool = False) -> None:
        self.params = None
        self.fail_first_insert = fail_first_insert
        self.execute_calls = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def execute(self, query: object, params: object) -> None:
        self.execute_calls += 1
        self.params = params
        if self.fail_first_insert and self.execute_calls == 1:
            raise psycopg_errors.UniqueViolation("duplicate key value violates unique constraint")

    def fetchone(self) -> dict[str, object]:
        assert self.params is not None
        if self.execute_calls == 2:
            return {
                "factor_id": "existing_primary_factor",
                "admin_id": self.params[7],
                "factor_type": self.params[8],
                "factor_label": self.params[9],
                "status": self.params[0],
                "secret_ref": self.params[1],
                "totp_secret_fingerprint": self.params[2],
                "payload_json": {"totpSecret": "SYNAPSESECRET"},
                "last_verified_at": self.params[4],
                "created_at": datetime.now(timezone.utc),
                "updated_at": self.params[5],
                "revoked_at": self.params[6],
            }
        return {
            "factor_id": self.params[0],
            "admin_id": self.params[1],
            "factor_type": self.params[2],
            "factor_label": self.params[3],
            "status": self.params[4],
            "secret_ref": self.params[5],
            "totp_secret_fingerprint": self.params[6],
            "payload_json": {"totpSecret": "SYNAPSESECRET"},
            "last_verified_at": self.params[8],
            "created_at": self.params[9],
            "updated_at": self.params[10],
            "revoked_at": self.params[11],
        }


class _FakeConnection:
    def __init__(self, *, fail_first_insert: bool = False) -> None:
        self.cursor_instance = _FakeCursor(fail_first_insert=fail_first_insert)
        self.rollback_called = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def cursor(self) -> _FakeCursor:
        return self.cursor_instance

    def rollback(self) -> None:
        self.rollback_called = True


def test_upsert_mfa_factor_serializes_payload_as_jsonb(monkeypatch) -> None:
    fake_connection = _FakeConnection()
    monkeypatch.setattr(identity_postgres, "_connect", lambda dsn: fake_connection)
    repository = identity_postgres.PostgresAdminIdentityRepository("postgresql://example")
    now = datetime.now(timezone.utc)

    factor = repository.upsert_mfa_factor(
        AdminMfaFactor(
            factor_id="factor_123",
            admin_id="admin_123",
            factor_type=MfaFactorType.TOTP,
            factor_label="primary",
            status=MfaFactorStatus.PENDING,
            totp_secret_fingerprint="fingerprint_123",
            payload={"totpSecret": "SYNAPSESECRET"},
            created_at=now,
            updated_at=now,
        )
    )

    params = fake_connection.cursor_instance.params
    assert params is not None
    assert params[6] == "fingerprint_123"
    assert isinstance(params[7], Jsonb)
    assert factor.payload["totpSecret"] == "SYNAPSESECRET"


def test_upsert_mfa_factor_recovers_from_identity_unique_conflict(monkeypatch) -> None:
    fake_connection = _FakeConnection(fail_first_insert=True)
    monkeypatch.setattr(identity_postgres, "_connect", lambda dsn: fake_connection)
    repository = identity_postgres.PostgresAdminIdentityRepository("postgresql://example")
    now = datetime.now(timezone.utc)

    factor = repository.upsert_mfa_factor(
        AdminMfaFactor(
            factor_id="factor_new_attempt",
            admin_id="admin_123",
            factor_type=MfaFactorType.TOTP,
            factor_label="primary",
            status=MfaFactorStatus.PENDING,
            totp_secret_fingerprint="fingerprint_123",
            payload={"totpSecret": "SYNAPSESECRET"},
            created_at=now,
            updated_at=now,
        )
    )

    assert fake_connection.rollback_called is True
    assert factor.factor_id == "existing_primary_factor"
    assert factor.factor_label == "primary"
    assert factor.payload["totpSecret"] == "SYNAPSESECRET"
    assert factor.totp_secret_fingerprint == "fingerprint_123"
