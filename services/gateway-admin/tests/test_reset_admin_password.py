from pathlib import Path
import sys

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import reset_admin_password as reset_script


def test_remote_dsn_requires_explicit_confirmation() -> None:
    try:
        reset_script._require_confirmation_for_remote_dsn(
            "postgresql://synapse_admin_app:secret@prod-db.internal:5432/synapse_gateway_admin",
            confirmed=False,
        )
    except SystemExit as exc:
        assert "refusing to reset password on non-local database" in str(exc)
    else:
        raise AssertionError("expected SystemExit for unconfirmed remote DSN")


def test_remote_dsn_allows_confirmation() -> None:
    reset_script._require_confirmation_for_remote_dsn(
        "postgresql://synapse_admin_app:secret@prod-db.internal:5432/synapse_gateway_admin",
        confirmed=True,
    )


def test_local_dsn_does_not_require_confirmation() -> None:
    reset_script._require_confirmation_for_remote_dsn(
        "postgresql://synapse_admin_app:secret@localhost:5432/synapse_gateway_admin",
        confirmed=False,
    )
