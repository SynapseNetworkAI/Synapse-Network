from datetime import datetime, timezone

from psycopg.types.json import Jsonb

from src.domain import AdminMfaFactor
from src.domain.enums import MfaFactorStatus, MfaFactorType
from src.storage.admin_identity import postgres as identity_postgres


class _FakeCursor:
    def __init__(self) -> None:
        self.params = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def execute(self, query: object, params: object) -> None:
        self.params = params

    def fetchone(self) -> dict[str, object]:
        assert self.params is not None
        return {
            "factor_id": self.params[0],
            "admin_id": self.params[1],
            "factor_type": self.params[2],
            "factor_label": self.params[3],
            "status": self.params[4],
            "secret_ref": self.params[5],
            "payload_json": {"totpSecret": "SYNAPSESECRET"},
            "last_verified_at": self.params[7],
            "created_at": self.params[8],
            "updated_at": self.params[9],
            "revoked_at": self.params[10],
        }


class _FakeConnection:
    def __init__(self) -> None:
        self.cursor_instance = _FakeCursor()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def cursor(self) -> _FakeCursor:
        return self.cursor_instance


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
            payload={"totpSecret": "SYNAPSESECRET"},
            created_at=now,
            updated_at=now,
        )
    )

    params = fake_connection.cursor_instance.params
    assert params is not None
    assert isinstance(params[6], Jsonb)
    assert factor.payload["totpSecret"] == "SYNAPSESECRET"