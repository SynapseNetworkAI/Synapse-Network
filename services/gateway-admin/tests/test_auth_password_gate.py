from uuid import uuid4

from src.domain import AdminUser
from src.domain.enums import AdminUserStatus
from tests.test_app import PLACEHOLDER_PASSWORD, _test_store, client


def test_admin_auth_login_does_not_start_mfa_enrollment_without_password_hash() -> None:
    email = f"missing-password-{uuid4().hex[:8]}@synapse-network.ai"
    store = _test_store()
    store.identity.create_user(
        AdminUser(
            admin_id=f"admin_{uuid4().hex[:12]}",
            email=email,
            display_name="No Password Bootstrap Admin",
            status=AdminUserStatus.ACTIVE,
            password_hash=None,
            require_mfa=True,
        )
    )
    client.cookies.clear()

    response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": email,
            "password": PLACEHOLDER_PASSWORD,
        },
    )

    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "UNAUTHORIZED"
    assert "data" not in body
