from pathlib import Path
import sys

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import reset_mfa_enrollment_test_admin as reset_script


TEST_PASSWORD = "".join(("EnrollUser#", "2026!"))


def test_ensure_safe_target_email_rejects_non_default_email() -> None:
    try:
        reset_script._ensure_safe_target_email("cliff@synapse-network.ai", False)
    except SystemExit as exc:
        assert "only allows the dedicated test email" in str(exc)
    else:
        raise AssertionError("expected SystemExit for non-default email")


def test_ensure_safe_target_email_allows_override_flag() -> None:
    assert reset_script._ensure_safe_target_email("cliff@synapse-network.ai", True) is None


class _FakeIdentityRepository:
    def __init__(self) -> None:
        self.created_user = None

    def create_user(self, user):
        self.created_user = user
        return user


class _FakeAuthorizationRepository:
    def __init__(self) -> None:
        self.created_binding = None

    def create_role_binding(self, binding):
        self.created_binding = binding
        return binding


class _FakeStore:
    def __init__(self) -> None:
        self.identity = _FakeIdentityRepository()
        self.authorization = _FakeAuthorizationRepository()


def test_reset_test_admin_recreates_unenrolled_account(monkeypatch) -> None:
    fake_store = _FakeStore()

    monkeypatch.setattr(reset_script.PostgresAdminStore, "from_dsn", lambda dsn: fake_store)
    monkeypatch.setattr(reset_script, "_ensure_role_available", lambda store, role_key: None)
    monkeypatch.setattr(
        reset_script,
        "_delete_existing_admin_state",
        lambda dsn, email: (
            "adm_old_test",
            {
                "deleted_sessions": 1,
                "deleted_challenges": 2,
                "deleted_factors": 1,
                "deleted_bindings": 1,
                "deleted_users": 1,
            },
        ),
    )

    summary = reset_script.reset_test_admin(
        dsn="postgresql://example",
        email="MFA-ENROLL-TEST@SYNAPSE-NETWORK.AI",
        password=TEST_PASSWORD,
        display_name="MFA Enrollment Test",
        role_key="platform_ops_admin",
        require_mfa=True,
        cleanup_only=False,
    )

    assert summary is not None
    assert summary.email == "mfa-enroll-test@synapse-network.ai"
    assert summary.require_mfa is True
    assert summary.deleted_sessions == 1
    assert fake_store.identity.created_user is not None
    assert fake_store.identity.created_user.email == "mfa-enroll-test@synapse-network.ai"
    assert fake_store.identity.created_user.require_mfa is True
    assert fake_store.authorization.created_binding is not None
    assert fake_store.authorization.created_binding.role_key == "platform_ops_admin"


def test_reset_test_admin_cleanup_only_skips_recreate(monkeypatch, capsys) -> None:
    fake_store = _FakeStore()

    monkeypatch.setattr(reset_script.PostgresAdminStore, "from_dsn", lambda dsn: fake_store)
    monkeypatch.setattr(reset_script, "_ensure_role_available", lambda store, role_key: None)
    monkeypatch.setattr(
        reset_script,
        "_delete_existing_admin_state",
        lambda dsn, email: (
            "adm_old_test",
            {
                "deleted_sessions": 1,
                "deleted_challenges": 1,
                "deleted_factors": 1,
                "deleted_bindings": 1,
                "deleted_users": 1,
            },
        ),
    )

    summary = reset_script.reset_test_admin(
        dsn="postgresql://example",
        email="mfa-enroll-test@synapse-network.ai",
        password=TEST_PASSWORD,
        display_name="MFA Enrollment Test",
        role_key="platform_ops_admin",
        require_mfa=True,
        cleanup_only=True,
    )

    captured = capsys.readouterr()
    assert summary is None
    assert "cleanup complete:" in captured.out
    assert fake_store.identity.created_user is None
    assert fake_store.authorization.created_binding is None
