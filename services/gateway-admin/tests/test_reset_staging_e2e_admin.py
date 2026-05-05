from __future__ import annotations

from pathlib import Path
import sys

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import reset_staging_e2e_admin as reset_script


STAGING_DSN = "postgresql://synapse_admin_app:secret@10.0.0.1/synapse_staging_admin"
LOCAL_DSN = "postgresql://synapse_admin_app:secret@127.0.0.1/synapse_gateway_admin"


def test_non_e2e_email_requires_explicit_allow_any_flag() -> None:
    with pytest.raises(SystemExit) as exc_info:
        reset_script._require_staging_target(
            dsn=STAGING_DSN,
            email="finance-admin@synapse-network.ai",
            confirmed=True,
            allow_any_staging_admin=False,
        )

    assert str(exc_info.value) == reset_script.ERROR_NON_E2E_EMAIL


def test_non_e2e_email_allows_existing_staging_admin_with_explicit_flag() -> None:
    host, dbname = reset_script._require_staging_target(
        dsn=STAGING_DSN,
        email="finance-admin@synapse-network.ai",
        confirmed=True,
        allow_any_staging_admin=True,
    )

    assert host == "10.0.0.1"
    assert dbname == "synapse_staging_admin"


def test_non_local_reset_still_requires_staging_confirmation() -> None:
    with pytest.raises(SystemExit) as exc_info:
        reset_script._require_staging_target(
            dsn=STAGING_DSN,
            email="finance-admin@synapse-network.ai",
            confirmed=False,
            allow_any_staging_admin=True,
        )

    assert str(exc_info.value) == reset_script.ERROR_CONFIRM_STAGING


def test_local_dedicated_e2e_email_keeps_default_safe_path() -> None:
    host, dbname = reset_script._require_staging_target(
        dsn=LOCAL_DSN,
        email="staging-admin-e2e@synapse-network.ai",
        confirmed=False,
        allow_any_staging_admin=False,
    )

    assert host == "127.0.0.1"
    assert dbname == "synapse_gateway_admin"
