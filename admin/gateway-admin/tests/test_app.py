from dataclasses import replace
from datetime import datetime, timezone
from decimal import Decimal

from fastapi.testclient import TestClient
from uuid import uuid4

from src.app import app
from src.api import deps
from src.core.config import get_settings
from src.core.totp import generate_totp_code, generate_totp_secret
from src.core.security import hash_password
from src.domain import AdminMfaFactor, AdminUser
from src.domain.enums import AdminUserStatus, MfaFactorStatus, MfaFactorType
from src.services.dashboard.service import DashboardService
from src.storage.analytics import InMemoryGatewayDashboardProjectionRepository, InMemoryProviderWithdrawReviewRepository, ProviderWithdrawReviewItem
from src.storage import InMemoryAdminStore

client = TestClient(app)
PLACEHOLDER_PASSWORD = "phase1-" + "placeholder"


def _login_as(email: str) -> dict[str, str]:
    client.cookies.clear()
    response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": email,
            "password": PLACEHOLDER_PASSWORD,
            "otpCode": _otp_code_for(email),
        },
    )
    assert response.status_code == 200
    csrf_token = response.json()["data"]["csrfToken"]
    return {"X-CSRF-Token": csrf_token}


def _seed_test_passwords() -> None:
    store = deps.get_store()
    for email in (
        "ops@synapse.network",
        "audit@synapse.network",
        "finance@synapse.network",
        "finance-review@synapse.network",
        "risk@synapse.network",
        "risk-review@synapse.network",
        "readonly@synapse.network",
        "super@synapse.network",
    ):
        user = store.identity.get_user_by_email(email)
        if user is not None:
            store.identity.update_password_hash(user.admin_id, hash_password(PLACEHOLDER_PASSWORD))


def _otp_code_for(email: str) -> str:
    store = deps.get_store()
    user = store.identity.get_user_by_email(email)
    assert user is not None
    factors = store.identity.list_mfa_factors(user.admin_id)
    secret = next(str(factor.payload.get("totpSecret") or "") for factor in factors if factor.payload.get("totpSecret"))
    return generate_totp_code(secret)


def _ensure_unenrolled_admin(email: str = "unenrolled@synapse.network") -> None:
    store = deps.get_store()
    existing = store.identity.get_user_by_email(email)
    if existing is None:
        store.identity.create_user(
            AdminUser(
                admin_id="admin_unenrolled",
                email=email,
                display_name="Unenrolled Admin",
                status=AdminUserStatus.ACTIVE,
                password_hash=hash_password(PLACEHOLDER_PASSWORD),
                require_mfa=True,
            )
        )
        return
    store.identity.update_user(
        AdminUser(
            admin_id=existing.admin_id,
            email=existing.email,
            display_name=existing.display_name,
            status=AdminUserStatus.ACTIVE,
            auth_source=existing.auth_source,
            sso_subject=existing.sso_subject,
            password_hash=existing.password_hash,
            require_mfa=True,
            last_login_at=existing.last_login_at,
            created_at=existing.created_at,
            updated_at=existing.updated_at,
            disabled_at=None,
        )
    )
    store.identity.update_password_hash(existing.admin_id, hash_password(PLACEHOLDER_PASSWORD))


def _refresh_auth_settings() -> None:
    get_settings.cache_clear()
    deps.get_auth_service.cache_clear()


_seed_test_passwords()


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_admin_auth_login() -> None:
    response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": "ops@synapse.network",
            "password": PLACEHOLDER_PASSWORD,
            "otpCode": _otp_code_for("ops@synapse.network"),
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["admin"]["email"] == "ops@synapse.network"
    assert body["data"]["expiresIn"] == 3600
    assert body["data"]["csrfToken"]
    assert body["data"]["security"]["loginTotpRequired"] is True
    assert body["data"]["security"]["highRiskTotpRequired"] is True
    assert "synapse_admin_session=" in response.headers["set-cookie"]


def test_admin_auth_login_requires_mfa_enrollment_for_unbound_account() -> None:
    _ensure_unenrolled_admin()
    client.cookies.clear()

    response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": "unenrolled@synapse.network",
            "password": PLACEHOLDER_PASSWORD,
        },
    )

    assert response.status_code == 428
    body = response.json()
    assert body["error"]["code"] == "MFA_ENROLLMENT_REQUIRED"
    assert body["data"]["enrollmentToken"]
    assert body["data"]["expiresIn"] == 600
    assert body["data"]["totpIssuer"] == "Synapse Gateway Admin"


def test_admin_auth_mfa_enrollment_begin_and_verify_issue_session() -> None:
    _ensure_unenrolled_admin()
    client.cookies.clear()

    login_response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": "unenrolled@synapse.network",
            "password": PLACEHOLDER_PASSWORD,
        },
    )
    assert login_response.status_code == 428
    enrollment_token = login_response.json()["data"]["enrollmentToken"]

    begin_response = client.post(
        "/api/admin/v1/auth/mfa/enroll/begin",
        json={"enrollmentToken": enrollment_token},
    )
    assert begin_response.status_code == 200
    begin_body = begin_response.json()["data"]
    assert begin_body["factorId"]
    assert begin_body["manualEntryKey"]
    assert begin_body["otpauthUrl"].startswith("otpauth://totp/")

    verify_response = client.post(
        "/api/admin/v1/auth/mfa/enroll/verify",
        json={
            "enrollmentToken": enrollment_token,
            "factorId": begin_body["factorId"],
            "otpCode": generate_totp_code(begin_body["manualEntryKey"]),
        },
    )
    assert verify_response.status_code == 200
    verify_body = verify_response.json()["data"]
    assert verify_body["admin"]["email"] == "unenrolled@synapse.network"
    assert verify_body["csrfToken"]
    assert "synapse_admin_session=" in verify_response.headers["set-cookie"]

    store = deps.get_store()
    user = store.identity.get_user_by_email("unenrolled@synapse.network")
    assert user is not None
    factors = store.identity.list_mfa_factors(user.admin_id)
    active_factors = [factor for factor in factors if factor.status.value == "active"]
    assert len(active_factors) == 1


def test_admin_auth_mfa_enrollment_begin_reuses_same_secret_for_same_token() -> None:
    email = f"repeat-begin-{uuid4().hex[:8]}@synapse.network"
    store = deps.get_store()
    store.identity.create_user(
        AdminUser(
            admin_id=f"admin_{uuid4().hex[:12]}",
            email=email,
            display_name="Repeat Begin Admin",
            status=AdminUserStatus.ACTIVE,
            password_hash=hash_password(PLACEHOLDER_PASSWORD),
            require_mfa=True,
        )
    )
    client.cookies.clear()

    login_response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": email,
            "password": PLACEHOLDER_PASSWORD,
        },
    )
    assert login_response.status_code == 428
    enrollment_token = login_response.json()["data"]["enrollmentToken"]

    first_begin = client.post(
        "/api/admin/v1/auth/mfa/enroll/begin",
        json={"enrollmentToken": enrollment_token},
    )
    second_begin = client.post(
        "/api/admin/v1/auth/mfa/enroll/begin",
        json={"enrollmentToken": enrollment_token},
    )

    assert first_begin.status_code == 200
    assert second_begin.status_code == 200
    first_body = first_begin.json()["data"]
    second_body = second_begin.json()["data"]
    assert second_body["factorId"] == first_body["factorId"]
    assert second_body["manualEntryKey"] == first_body["manualEntryKey"]

    verify_response = client.post(
        "/api/admin/v1/auth/mfa/enroll/verify",
        json={
            "enrollmentToken": enrollment_token,
            "factorId": first_body["factorId"],
            "otpCode": generate_totp_code(first_body["manualEntryKey"]),
        },
    )
    assert verify_response.status_code == 200


def test_admin_auth_mfa_enrollment_begin_reuses_existing_primary_factor_identity() -> None:
    email = f"broken-factor-{uuid4().hex[:8]}@synapse.network"
    store = deps.get_store()
    user = store.identity.create_user(
        AdminUser(
            admin_id=f"admin_{uuid4().hex[:12]}",
            email=email,
            display_name="Broken Factor Admin",
            status=AdminUserStatus.ACTIVE,
            password_hash=hash_password(PLACEHOLDER_PASSWORD),
            require_mfa=True,
        )
    )
    existing_factor = store.identity.upsert_mfa_factor(
        AdminMfaFactor(
            factor_id="factor_existing_primary",
            admin_id=user.admin_id,
            factor_type=MfaFactorType.TOTP,
            factor_label="primary",
            status=MfaFactorStatus.ACTIVE,
            payload={},
        )
    )

    client.cookies.clear()
    login_response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": email,
            "password": PLACEHOLDER_PASSWORD,
        },
    )
    assert login_response.status_code == 428
    enrollment_token = login_response.json()["data"]["enrollmentToken"]

    begin_response = client.post(
        "/api/admin/v1/auth/mfa/enroll/begin",
        json={"enrollmentToken": enrollment_token},
    )

    assert begin_response.status_code == 200
    begin_body = begin_response.json()["data"]
    assert begin_body["factorId"] == existing_factor.factor_id
    factors = store.identity.list_mfa_factors(user.admin_id)
    primary_factors = [
        factor
        for factor in factors
        if factor.factor_type == MfaFactorType.TOTP and factor.factor_label == "primary"
    ]
    assert len(primary_factors) == 1
    assert primary_factors[0].status == MfaFactorStatus.PENDING
    assert primary_factors[0].payload["totpSecret"] == begin_body["manualEntryKey"]


def test_admin_auth_mfa_enrollment_verify_revokes_other_totp_factors() -> None:
    email = f"rebind-factor-{uuid4().hex[:8]}@synapse.network"
    store = deps.get_store()
    user = store.identity.create_user(
        AdminUser(
            admin_id=f"admin_{uuid4().hex[:12]}",
            email=email,
            display_name="Rebind Factor Admin",
            status=AdminUserStatus.ACTIVE,
            password_hash=hash_password(PLACEHOLDER_PASSWORD),
            require_mfa=True,
        )
    )

    client.cookies.clear()
    login_response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": email,
            "password": PLACEHOLDER_PASSWORD,
        },
    )
    assert login_response.status_code == 428
    enrollment_token = login_response.json()["data"]["enrollmentToken"]

    begin_response = client.post(
        "/api/admin/v1/auth/mfa/enroll/begin",
        json={"enrollmentToken": enrollment_token},
    )
    assert begin_response.status_code == 200
    begin_body = begin_response.json()["data"]

    legacy_factor = store.identity.upsert_mfa_factor(
        AdminMfaFactor(
            factor_id=f"legacy_{uuid4().hex[:12]}",
            admin_id=user.admin_id,
            factor_type=MfaFactorType.TOTP,
            factor_label="bootstrap_totp",
            status=MfaFactorStatus.ACTIVE,
            payload={"totpSecret": generate_totp_secret()},
        )
    )

    verify_response = client.post(
        "/api/admin/v1/auth/mfa/enroll/verify",
        json={
            "enrollmentToken": enrollment_token,
            "factorId": begin_body["factorId"],
            "otpCode": generate_totp_code(begin_body["manualEntryKey"]),
        },
    )

    assert verify_response.status_code == 200
    factors = store.identity.list_mfa_factors(user.admin_id)
    active_totp_factors = [
        factor
        for factor in factors
        if factor.factor_type == MfaFactorType.TOTP and factor.status == MfaFactorStatus.ACTIVE
    ]
    assert len(active_totp_factors) == 1
    assert active_totp_factors[0].factor_id == begin_body["factorId"]
    revoked_legacy_factor = next(factor for factor in factors if factor.factor_id == legacy_factor.factor_id)
    assert revoked_legacy_factor.status == MfaFactorStatus.REVOKED


def test_admin_auth_policy_exposes_google_authenticator_switches() -> None:
    response = client.get("/api/admin/v1/auth/policy")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["loginTotpRequired"] is True
    assert body["highRiskTotpRequired"] is True
    assert body["totpIssuer"] == "Synapse Gateway Admin"


def test_admin_auth_policy_disables_login_totp_when_switch_is_off(monkeypatch) -> None:
    monkeypatch.setenv("ADMIN_GOOGLE_AUTHENTICATOR_LOGIN_ENABLED", "false")
    _refresh_auth_settings()

    try:
        response = client.get("/api/admin/v1/auth/policy")

        assert response.status_code == 200
        body = response.json()["data"]
        assert body["loginTotpRequired"] is False
        assert body["highRiskTotpRequired"] is True
    finally:
        _refresh_auth_settings()


def test_admin_auth_login_skips_google_authenticator_when_login_switch_is_off(monkeypatch) -> None:
    _ensure_unenrolled_admin("mfa-disabled@synapse.network")
    monkeypatch.setenv("ADMIN_GOOGLE_AUTHENTICATOR_LOGIN_ENABLED", "false")
    _refresh_auth_settings()
    client.cookies.clear()

    try:
        response = client.post(
            "/api/admin/v1/auth/login",
            json={
                "email": "mfa-disabled@synapse.network",
                "password": PLACEHOLDER_PASSWORD,
            },
        )

        assert response.status_code == 200
        body = response.json()["data"]
        assert body["admin"]["email"] == "mfa-disabled@synapse.network"
        assert body["security"]["loginTotpRequired"] is False
        assert "synapse_admin_session=" in response.headers["set-cookie"]
    finally:
        _refresh_auth_settings()


def test_admin_auth_me_and_logout_use_cookie_session() -> None:
    csrf_headers = _login_as("ops@synapse.network")

    me_response = client.get("/api/admin/v1/auth/me")
    assert me_response.status_code == 200
    assert me_response.json()["data"]["admin"]["email"] == "ops@synapse.network"
    assert me_response.json()["data"]["csrfToken"]

    logout_response = client.post("/api/admin/v1/auth/logout", headers=csrf_headers)
    assert logout_response.status_code == 200
    assert logout_response.json()["data"]["loggedOut"] is True
    assert "synapse_admin_session=" in logout_response.headers["set-cookie"]

    me_after_logout = client.get("/api/admin/v1/auth/me")
    assert me_after_logout.status_code == 401


def test_admin_auth_login_rejects_wrong_password() -> None:
    response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": "ops@synapse.network",
            "password": "wrong-password",
            "otpCode": _otp_code_for("ops@synapse.network"),
        },
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_admin_auth_login_rejects_invalid_google_authenticator_code() -> None:
    response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": "ops@synapse.network",
            "password": PLACEHOLDER_PASSWORD,
            "otpCode": "000000",
        },
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_admin_users_catalog_and_create_user() -> None:
    csrf_headers = _login_as("super@synapse.network")
    store = deps.get_store()

    roles_response = client.get("/api/admin/v1/users/roles")
    assert roles_response.status_code == 200
    role_items = roles_response.json()["data"]["items"]
    assert any(item["roleKey"] == "super_admin" for item in role_items)

    create_response = client.post(
        "/api/admin/v1/users",
        headers=csrf_headers,
        json={
            "email": "new-ops@synapse.network",
            "displayName": "New Ops",
            "roleKey": "platform_ops_admin",
            "password": PLACEHOLDER_PASSWORD,
            "requireMfa": False,
            "status": "active",
        },
    )
    assert create_response.status_code == 200
    created_admin = create_response.json()["data"]["admin"]
    assert created_admin["email"] == "new-ops@synapse.network"
    assert created_admin["roleKeys"] == ["platform_ops_admin"]
    bindings = store.authorization.list_role_bindings(created_admin["adminId"])
    assert len(bindings) == 1
    assert bindings[0].starts_at is not None

    list_response = client.get("/api/admin/v1/users")
    assert list_response.status_code == 200
    emails = [item["email"] for item in list_response.json()["data"]["items"]]
    assert "new-ops@synapse.network" in emails


def test_admin_users_update_and_disable_user() -> None:
    csrf_headers = _login_as("super@synapse.network")

    create_response = client.post(
        "/api/admin/v1/users",
        headers=csrf_headers,
        json={
            "email": "crud-user@synapse.network",
            "displayName": "CRUD User",
            "roleKey": "platform_ops_admin",
            "password": PLACEHOLDER_PASSWORD,
            "requireMfa": False,
            "status": "active",
        },
    )
    assert create_response.status_code == 200
    admin_id = create_response.json()["data"]["admin"]["adminId"]

    update_response = client.patch(
        f"/api/admin/v1/users/{admin_id}",
        headers=csrf_headers,
        json={
            "displayName": "Updated CRUD User",
            "roleKey": "finance_admin",
            "password": "",
            "requireMfa": True,
            "status": "active",
        },
    )
    assert update_response.status_code == 200
    updated_admin = update_response.json()["data"]["admin"]
    assert updated_admin["displayName"] == "Updated CRUD User"
    assert updated_admin["roleKeys"] == ["finance_admin"]
    assert updated_admin["requireMfa"] is True

    delete_response = client.delete(f"/api/admin/v1/users/{admin_id}", headers=csrf_headers)
    assert delete_response.status_code == 200
    assert delete_response.json()["data"]["status"] == "disabled"

    filtered_response = client.get("/api/admin/v1/users?status=disabled&search=crud-user&roleKey=finance_admin")
    assert filtered_response.status_code == 200
    filtered_items = filtered_response.json()["data"]["items"]
    assert len(filtered_items) == 1
    assert filtered_items[0]["adminId"] == admin_id


def test_admin_roles_crud_flow() -> None:
    csrf_headers = _login_as("super@synapse.network")

    permissions_response = client.get("/api/admin/v1/users/permissions")
    assert permissions_response.status_code == 200
    permission_keys = [item["permissionKey"] for item in permissions_response.json()["data"]["items"]]
    assert "dashboard:read" in permission_keys

    create_response = client.post(
        "/api/admin/v1/users/roles",
        headers=csrf_headers,
        json={
            "roleKey": "ops_shift_manager",
            "roleName": "Ops Shift Manager",
            "description": "Shift-level control plane operator",
            "status": "active",
            "permissions": ["dashboard:read", "execution:read"],
        },
    )
    assert create_response.status_code == 200
    created_role = create_response.json()["data"]["role"]
    assert created_role["roleKey"] == "ops_shift_manager"
    assert created_role["permissions"] == ["dashboard:read", "execution:read"]

    update_response = client.patch(
        "/api/admin/v1/users/roles/ops_shift_manager",
        headers=csrf_headers,
        json={
            "roleName": "Ops Shift Lead",
            "description": "Lead for operations shift",
            "status": "active",
            "permissions": ["dashboard:read", "execution:read", "audit:read"],
        },
    )
    assert update_response.status_code == 200
    updated_role = update_response.json()["data"]["role"]
    assert updated_role["roleName"] == "Ops Shift Lead"
    assert "audit:read" in updated_role["permissions"]

    delete_response = client.delete("/api/admin/v1/users/roles/ops_shift_manager", headers=csrf_headers)
    assert delete_response.status_code == 200
    assert delete_response.json()["data"]["status"] == "disabled"


def test_admin_menu_config_crud_and_publish_flow() -> None:
    csrf_headers = _login_as("super@synapse.network")

    list_response = client.get("/api/admin/v1/config/menu-items")
    assert list_response.status_code == 200
    assert any(item["itemId"] == "dashboard" for item in list_response.json()["data"]["items"])
    dashboard_item = next(item for item in list_response.json()["data"]["items"] if item["itemId"] == "dashboard")
    assert dashboard_item["parentItemId"] == "control-overview"
    assert dashboard_item["nodeType"] == "category"
    assert dashboard_item["href"] is None
    assert dashboard_item["iconKey"] == "OV"
    dashboard_runtime_item = next(item for item in list_response.json()["data"]["items"] if item["itemId"] == "dashboard-runtime")
    assert dashboard_runtime_item["parentItemId"] == "dashboard"
    assert dashboard_runtime_item["nodeType"] == "page"
    assert dashboard_runtime_item["href"] == "/dashboard/runtime"

    create_response = client.post(
        "/api/admin/v1/config/menu-items",
        headers=csrf_headers,
        json={
            "itemId": "ops-copilot",
            "sectionId": "ops-controls",
            "sectionLabel": "业务控制",
            "sectionDescription": "审批、资金、风控和系统运维的受控操作入口。",
            "label": "运行副驾",
            "href": "/ops-copilot",
            "description": "值班辅助和运行手册入口。",
            "parentItemId": "business-control",
            "nodeType": "page",
            "iconKey": "OC",
            "requiredRoles": ["super_admin"],
            "requiredPermissions": ["dashboard:read"],
            "sortOrder": 65,
            "keywords": ["copilot", "runbook"],
        },
    )
    assert create_response.status_code == 200
    created_item = next(item for item in create_response.json()["data"]["items"] if item["itemId"] == "ops-copilot")
    assert created_item["parentItemId"] == "business-control"
    assert created_item["nodeType"] == "page"
    assert created_item["iconKey"] == "OC"
    assert created_item["keywords"] == ["copilot", "runbook"]
    assert create_response.json()["data"]["meta"]["isDirty"] is True

    update_response = client.patch(
        "/api/admin/v1/config/menu-items/ops-copilot",
        headers=csrf_headers,
        json={
            "sectionId": "ops-controls",
            "sectionLabel": "业务控制",
            "sectionDescription": "审批、资金、风控和系统运维的受控操作入口。",
            "label": "运行副驾中心",
            "href": "/ops-copilot",
            "description": "值班辅助和运行手册入口。",
            "parentItemId": "business-control",
            "nodeType": "page",
            "iconKey": "OC",
            "requiredRoles": ["super_admin", "platform_ops_admin"],
            "requiredPermissions": ["dashboard:read"],
            "sortOrder": 66,
            "keywords": ["copilot", "shift"],
        },
    )
    assert update_response.status_code == 200
    updated_item = next(item for item in update_response.json()["data"]["items"] if item["itemId"] == "ops-copilot")
    assert updated_item["label"] == "运行副驾中心"
    assert updated_item["keywords"] == ["copilot", "shift"]

    publish_headers = {**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("super@synapse.network")}
    publish_response = client.post("/api/admin/v1/config/menu-items/publish", headers=publish_headers)
    assert publish_response.status_code == 200
    assert publish_response.json()["data"]["meta"]["isDirty"] is False

    published_response = client.get("/api/admin/v1/config/menu-items?stage=published")
    assert published_response.status_code == 200
    assert any(item["itemId"] == "ops-copilot" for item in published_response.json()["data"]["items"])

    delete_response = client.delete("/api/admin/v1/config/menu-items/ops-copilot", headers=csrf_headers)
    assert delete_response.status_code == 200
    assert all(item["itemId"] != "ops-copilot" for item in delete_response.json()["data"]["items"])


def test_visible_menu_config_is_filtered_by_backend_permissions() -> None:
    _login_as("finance@synapse.network")

    response = client.get("/api/admin/v1/config/menu-items/visible")
    assert response.status_code == 200
    item_ids = {item["itemId"] for item in response.json()["data"]["items"]}
    assert item_ids == {
        "control-overview",
        "dashboard",
        "dashboard-overview",
        "dashboard-runtime",
        "system",
        "business-control",
        "approvals",
        "withdrawal-reviews",
        "review-history",
        "finance",
        "risk",
    }
    runtime_item = next(item for item in response.json()["data"]["items"] if item["itemId"] == "dashboard-runtime")
    dashboard_item = next(item for item in response.json()["data"]["items"] if item["itemId"] == "dashboard")
    system_item = next(item for item in response.json()["data"]["items"] if item["itemId"] == "system")
    assert dashboard_item["href"] is None
    assert dashboard_item["nodeType"] == "category"
    assert runtime_item["href"] == "/dashboard/runtime"
    assert system_item["href"] == "/system"


def test_menu_config_delete_removes_descendants() -> None:
    csrf_headers = _login_as("super@synapse.network")

    create_response = client.post(
        "/api/admin/v1/config/menu-items",
        headers=csrf_headers,
        json={
            "itemId": "ops-root",
            "sectionId": "ops-controls",
            "sectionLabel": "业务控制",
            "sectionDescription": "审批、资金、风控和系统运维的受控操作入口。",
            "label": "Ops Root",
            "href": None,
            "description": "临时父节点。",
            "nodeType": "category",
            "iconKey": "OR",
            "requiredRoles": ["super_admin"],
            "requiredPermissions": [],
            "sortOrder": 500,
            "keywords": ["temporary"],
        },
    )
    assert create_response.status_code == 200

    child_response = client.post(
        "/api/admin/v1/config/menu-items",
        headers=csrf_headers,
        json={
            "itemId": "ops-child",
            "sectionId": "ops-controls",
            "sectionLabel": "业务控制",
            "sectionDescription": "审批、资金、风控和系统运维的受控操作入口。",
            "label": "Ops Child",
            "href": "/ops-child",
            "description": "临时子节点。",
            "parentItemId": "ops-root",
            "nodeType": "page",
            "iconKey": "OC",
            "requiredRoles": ["super_admin"],
            "requiredPermissions": ["dashboard:read"],
            "sortOrder": 501,
            "keywords": ["temporary"],
        },
    )
    assert child_response.status_code == 200

    delete_response = client.delete("/api/admin/v1/config/menu-items/ops-root", headers=csrf_headers)
    assert delete_response.status_code == 200
    deleted_ids = {item["itemId"] for item in delete_response.json()["data"]["items"]}
    assert "ops-root" not in deleted_ids
    assert "ops-child" not in deleted_ids


def test_visible_menu_config_returns_full_tree_for_super_admin() -> None:
    _login_as("super@synapse.network")

    published_response = client.get("/api/admin/v1/config/menu-items?stage=published")
    visible_response = client.get("/api/admin/v1/config/menu-items/visible")

    assert published_response.status_code == 200
    assert visible_response.status_code == 200
    published_ids = {item["itemId"] for item in published_response.json()["data"]["items"]}
    visible_ids = {item["itemId"] for item in visible_response.json()["data"]["items"]}
    assert visible_ids == published_ids


def test_approvals_list_includes_projected_provider_withdraw_reviews() -> None:
    _login_as("finance-review@synapse.network")

    response = client.get("/api/admin/v1/approvals?limit=20")
    assert response.status_code == 200
    items = response.json()["data"]["items"]
    projected = [item for item in items if item["approvalType"] == "provider_withdraw_review"]
    assert projected
    assert all(item["approvalId"].startswith("PWR-") for item in projected)
    assert all(item["status"] == "UNDER_REVIEW" for item in projected)


def test_approvals_list_filter_can_select_only_projected_provider_reviews() -> None:
    _login_as("finance-review@synapse.network")

    response = client.get("/api/admin/v1/approvals?approvalType=provider_withdraw_review&status=UNDER_REVIEW&limit=20")
    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert len(items) >= 1
    assert all(item["approvalType"] == "provider_withdraw_review" for item in items)
    assert all(item["status"] == "UNDER_REVIEW" for item in items)


def test_approval_decision_can_route_to_projected_provider_withdraw_review() -> None:
    csrf_headers = _login_as("finance-review@synapse.network")

    response = client.post(
        "/api/admin/v1/approvals/PWR-wd-demo-review-002/decision",
        headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance-review@synapse.network")},
        json={
            "decision": "APPROVE",
            "comment": "Projected approval routed to provider manual review flow.",
        },
    )
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["approvalId"] == "PWR-wd-demo-review-002"
    assert payload["status"] == "APPROVED_AUTO"


def test_provider_withdraw_review_list_and_decision() -> None:
    csrf_headers = _login_as("finance-review@synapse.network")

    list_response = client.get("/api/admin/v1/withdrawal-reviews?limit=10")
    assert list_response.status_code == 200
    items = list_response.json()["data"]["items"]
    assert len(items) >= 1
    first_item = items[0]
    assert first_item["status"] == "PENDING_MANUAL_REVIEW"

    decision_response = client.post(
        f"/api/admin/v1/withdrawal-reviews/{first_item['withdrawalId']}/decision",
        headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance-review@synapse.network")},
        json={
            "decision": "APPROVE",
            "note": "Looks consistent with provider income.",
        },
    )
    assert decision_response.status_code == 200
    result = decision_response.json()["data"]
    assert result["reviewDecision"] == "APPROVE"
    assert result["status"] == "APPROVED_AUTO"

    list_after_response = client.get("/api/admin/v1/withdrawal-reviews?limit=10")
    assert list_after_response.status_code == 200
    remaining_ids = [item["withdrawalId"] for item in list_after_response.json()["data"]["items"]]
    assert first_item["withdrawalId"] not in remaining_ids


def test_provider_withdraw_review_history_returns_reviewed_items() -> None:
    csrf_headers = _login_as("finance-review@synapse.network")
    repository = deps.get_provider_withdraw_review_repository()
    review_item_id = f"wd-history-{uuid4().hex[:8]}"
    if isinstance(repository, InMemoryProviderWithdrawReviewRepository):
        repository._items.append(
            ProviderWithdrawReviewItem(
                withdrawal_id=review_item_id,
                owner_address="0x1111111111111111111111111111111111111111",
                amount_usdc=Decimal("64.00"),
                status="PENDING_MANUAL_REVIEW",
                request_id="history-review-request",
                tx_hash=None,
                risk_level="yellow",
                risk_reason_code="AUTO_SINGLE_LIMIT_EXCEEDED",
                evidence_summary="Seeded by test for review history endpoint.",
                message="Manual review required before issuing withdraw ticket.",
                created_at="2026-03-20T09:30:00Z",
                updated_at="2026-03-20T09:30:00Z",
            )
        )

    decision_response = client.post(
        f"/api/admin/v1/withdrawal-reviews/{review_item_id}/decision",
        headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance-review@synapse.network")},
        json={
            "decision": "APPROVE",
            "note": "History page should show this reviewed item.",
        },
    )
    assert decision_response.status_code == 200

    history_response = client.get("/api/admin/v1/withdrawal-reviews/history?limit=10")
    assert history_response.status_code == 200
    items = history_response.json()["data"]["items"]
    reviewed = next(item for item in items if item["withdrawalId"] == review_item_id)
    assert reviewed["reviewDecision"] == "APPROVE"
    assert reviewed["currentStatus"] == "APPROVED_AUTO"
    assert reviewed["reviewerNote"] == "History page should show this reviewed item."
    assert reviewed["riskLevel"] == "yellow"
    assert reviewed["riskReasonCode"] == "AUTO_SINGLE_LIMIT_EXCEEDED"
    assert reviewed["evidenceSummary"] == "Seeded by test for review history endpoint."
    assert reviewed["createdAt"] == "2026-03-20T09:30:00Z"
    assert reviewed["updatedAt"] is not None


def test_provider_withdraw_review_history_supports_filters_and_pagination() -> None:
    csrf_headers = _login_as("finance-review@synapse.network")
    repository = deps.get_provider_withdraw_review_repository()
    review_ids = [f"wd-history-filter-{uuid4().hex[:6]}", f"wd-history-filter-{uuid4().hex[:6]}"]
    reviewed_on = datetime.now(timezone.utc).date().isoformat()
    if isinstance(repository, InMemoryProviderWithdrawReviewRepository):
        repository._items.extend(
            [
                ProviderWithdrawReviewItem(
                    withdrawal_id=review_ids[0],
                    owner_address="0x9999999999999999999999999999999999999991",
                    amount_usdc=Decimal("51.00"),
                    status="PENDING_MANUAL_REVIEW",
                    request_id="history-page-1",
                    tx_hash=None,
                    risk_level="yellow",
                    risk_reason_code="AUTO_SINGLE_LIMIT_EXCEEDED",
                    evidence_summary="First paginated reviewer record.",
                    message="Awaiting reviewer action.",
                    created_at="2026-03-21T08:00:00Z",
                    updated_at="2026-03-21T08:00:00Z",
                ),
                ProviderWithdrawReviewItem(
                    withdrawal_id=review_ids[1],
                    owner_address="0x9999999999999999999999999999999999999992",
                    amount_usdc=Decimal("52.00"),
                    status="PENDING_MANUAL_REVIEW",
                    request_id="history-page-2",
                    tx_hash=None,
                    risk_level="yellow",
                    risk_reason_code="AUTO_SINGLE_LIMIT_EXCEEDED",
                    evidence_summary="Second paginated reviewer record.",
                    message="Awaiting reviewer action.",
                    created_at="2026-03-22T08:00:00Z",
                    updated_at="2026-03-22T08:00:00Z",
                ),
            ]
        )

    for withdrawal_id in review_ids:
        decision_response = client.post(
            f"/api/admin/v1/withdrawal-reviews/{withdrawal_id}/decision",
            headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance-review@synapse.network")},
            json={
                "decision": "APPROVE",
                "note": f"Reviewed item {withdrawal_id}",
            },
        )
        assert decision_response.status_code == 200

    first_page_response = client.get(
        f"/api/admin/v1/withdrawal-reviews/history?query=wd-history-filter-&reviewer=finance-review&reviewedFrom={reviewed_on}&reviewedTo={reviewed_on}&limit=1"
    )
    assert first_page_response.status_code == 200
    first_page = first_page_response.json()["data"]
    assert len(first_page["items"]) == 1
    assert first_page["items"][0]["withdrawalId"] == review_ids[1]
    assert first_page["nextCursor"] == "1"

    second_page_response = client.get(
        f"/api/admin/v1/withdrawal-reviews/history?query=wd-history-filter-&reviewer=finance-review&reviewedFrom={reviewed_on}&reviewedTo={reviewed_on}&limit=1&cursor={first_page['nextCursor']}"
    )
    assert second_page_response.status_code == 200
    second_page = second_page_response.json()["data"]
    assert len(second_page["items"]) == 1
    assert second_page["items"][0]["withdrawalId"] == review_ids[0]
    assert second_page["nextCursor"] is None


def test_menu_config_snapshot_auto_adds_review_history_seed_item() -> None:
    _login_as("super@synapse.network")
    store = deps.get_store()
    snapshot = store.config.get_menu_config("admin_menu_config")
    assert snapshot is not None

    trimmed_snapshot = replace(
        snapshot,
        draft_items=tuple(item for item in snapshot.draft_items if item.item_id != "review-history"),
        published_items=tuple(item for item in snapshot.published_items if item.item_id != "review-history"),
    )
    store.config.save_menu_config(trimmed_snapshot)

    visible_response = client.get("/api/admin/v1/config/menu-items/visible")
    assert visible_response.status_code == 200
    visible_ids = {item["itemId"] for item in visible_response.json()["data"]["items"]}
    assert "review-history" in visible_ids


def test_provider_withdraw_review_decision_requires_permission() -> None:
    csrf_headers = _login_as("finance@synapse.network")

    response = client.post(
        "/api/admin/v1/withdrawal-reviews/wd-demo-review-001/decision",
        headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance@synapse.network")},
        json={
            "decision": "REJECT",
            "note": "Finance admin cannot decide directly.",
        },
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_provider_withdraw_review_decision_rejects_multiple_active_google_authenticator_factors() -> None:
    csrf_headers = _login_as("finance-review@synapse.network")
    store = deps.get_store()
    user = store.identity.get_user_by_email("finance-review@synapse.network")
    assert user is not None
    duplicate_factor = store.identity.upsert_mfa_factor(
        AdminMfaFactor(
            factor_id=f"dup_{uuid4().hex[:12]}",
            admin_id=user.admin_id,
            factor_type=MfaFactorType.TOTP,
            factor_label="bootstrap_totp",
            status=MfaFactorStatus.ACTIVE,
            payload={"totpSecret": generate_totp_secret()},
        )
    )

    try:
        response = client.post(
            "/api/admin/v1/withdrawal-reviews/wd-demo-review-001/decision",
            headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance-review@synapse.network")},
            json={
                "decision": "REJECT",
                "note": "Duplicate active TOTP factors must be rejected.",
            },
        )
        assert response.status_code == 401
        assert response.json()["error"]["message"] == "Multiple active Google Authenticator factors are configured"
    finally:
        factor = store.identity.get_mfa_factor_by_id(duplicate_factor.factor_id)
        assert factor is not None
        store.identity.upsert_mfa_factor(
            AdminMfaFactor(
                factor_id=factor.factor_id,
                admin_id=factor.admin_id,
                factor_type=factor.factor_type,
                factor_label=factor.factor_label,
                status=MfaFactorStatus.REVOKED,
                secret_ref=factor.secret_ref,
                payload=factor.payload,
                last_verified_at=factor.last_verified_at,
                created_at=factor.created_at,
                updated_at=factor.updated_at,
                revoked_at=factor.updated_at,
            )
        )


def test_draft_menu_config_requires_control_plane_role() -> None:
    _login_as("finance@synapse.network")

    response = client.get("/api/admin/v1/config/menu-items")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_raw_published_menu_config_requires_control_plane_role() -> None:
    _login_as("finance@synapse.network")

    response = client.get("/api/admin/v1/config/menu-items?stage=published")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_dashboard_requires_auth() -> None:
    client.cookies.clear()
    response = client.get("/api/admin/v1/dashboard/overview")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"
    assert response.json()["requestId"].startswith("req_")


def test_approval_submit_forbidden_without_permission() -> None:
    csrf_headers = _login_as("audit@synapse.network")

    response = client.post(
        "/api/admin/v1/approvals",
        headers=csrf_headers,
        json={
            "approvalType": "deposit_repair",
            "resourceType": "deposit_intent",
            "resourceId": "dep_123",
            "approvalLevel": "L2",
            "amountUsdc": "100.00",
            "reason": "链上已确认但账本未入账",
            "payload": {"txHash": "0xabc", "ownerAddress": "0x123", "eventKey": "evt_123"},
        },
    )

    assert response.status_code == 403
    body = response.json()
    assert body["error"]["code"] == "FORBIDDEN"
    assert body["requestId"].startswith("req_")


def test_approval_decision_requires_reviewer_role() -> None:
    csrf_headers = _login_as("finance-review@synapse.network")

    response = client.post(
        "/api/admin/v1/approvals/APR-20260316-001/decision",
        headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance-review@synapse.network")},
        json={"decision": "APPROVE", "comment": "approved"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "APPROVED_PENDING_EXECUTION"


def test_dashboard_overview_uses_store_backed_metrics() -> None:
    _login_as("ops@synapse.network")

    response = client.get("/api/admin/v1/dashboard/overview")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["metrics"]["pendingApprovals"] >= 3
    assert body["metrics"]["depositExceptions"] == 2
    assert body["metrics"]["auditAlerts"] == 1
    assert body["metrics"]["vaultLedgerDelta"] == "0.50"


def test_system_status_uses_gateway_projection_snapshot() -> None:
    _login_as("ops@synapse.network")

    response = client.get("/api/admin/v1/dashboard/system-status")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["gatewayAdmin"] == "healthy"
    assert body["gateway"] == "degraded"
    assert body["approvalQueueDepth"] >= 3
    assert body["lastReconciliationAt"] == "2026-03-16T08:00:00Z"


def test_finance_overview_exposes_gateway_finance_projection() -> None:
    _login_as("ops@synapse.network")

    response = client.get("/api/admin/v1/dashboard/finance-overview")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["todayChargeUsdc"] == "1280.40"
    assert body["todayDepositUsdc"] == "1640.00"
    assert body["todayInvocationCount"] == 342
    assert body["todayPlatformFeeEarnedUsdc"] == "196.40"
    assert body["todayProviderEarnedUsdc"] == "1084.00"
    assert body["refundableConsumerBalanceUsdc"] == "7320.35"
    assert body["providerAvailableToWithdrawUsdc"] == "3510.20"
    assert body["providerLockedBalanceUsdc"] == "410.25"
    assert body["vaultLedgerDeltaUsdc"] == "0.50"
    assert body["pendingDepositCount"] == 2
    assert body["pendingWithdrawalCount"] == 1


def test_activity_trends_expose_seven_day_projection() -> None:
    _login_as("ops@synapse.network")

    response = client.get("/api/admin/v1/dashboard/activity-trends")

    assert response.status_code == 200
    points = response.json()["data"]["points"]
    assert len(points) == 7
    assert points[-1]["bucketDate"] == "2026-03-16"
    assert points[-1]["invocationCount"] == 342
    assert points[-1]["platformFeeEarnedUsdc"] == "196.40"
    assert points[-1]["providerEarnedUsdc"] == "1084.00"
    assert points[-1]["netFlowUsdc"] == "1287.25"


def test_operations_overview_exposes_gateway_ops_projection() -> None:
    _login_as("ops@synapse.network")

    response = client.get("/api/admin/v1/dashboard/operations-overview")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["gatewayStatus"] == "degraded"
    assert body["indexerRunning"] is True
    assert body["indexerStatus"] == "lagging"
    assert body["indexerPollIntervalSec"] == 30
    assert body["backfillEnabled"] is True
    assert body["backfillStatus"] == "lagging"
    assert body["backfillLastScannedBlock"] == 19450321
    assert body["backfillLastRecovered"] == 3
    assert body["reconciliationEnabled"] is True
    assert body["reconciliationStatus"] == "alert"
    assert body["reconciliationAlert"] is True
    assert body["reconciliationLastError"] == "vault_delta_detected"


def test_reconciliation_detail_exposes_runtime_breakdown_and_related_backlog() -> None:
    _login_as("ops@synapse.network")

    response = client.get("/api/admin/v1/dashboard/reconciliation-detail")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["gatewayStatus"] == "degraded"
    assert body["reconciliationAlert"] is True
    assert body["reconciliationDeltaUsdc"] == "0.50"
    assert body["signedDifferenceUsdc"] == "-0.50"
    assert body["imbalanceDirection"] == "vault_deficit"
    assert body["chainVaultUsdc"] == "8449.60"
    assert body["ledgerObligationUsdc"] == "8450.10"
    assert body["lastReconciliationAt"] == "2026-03-16T08:00:00Z"
    assert body["runtimeStateUpdatedAt"] == "2026-03-16T08:00:00Z"
    assert body["pendingApprovals"] >= 3
    assert body["depositExceptions"] == 2
    assert body["pendingDepositCount"] == 2
    assert body["pendingWithdrawalCount"] == 1
    assert body["todayRefundUsdc"] == "42.25"
    assert body["todayWithdrawalUsdc"] == "310.50"
    assert body["ownerLiabilityUsdc"] == "8450.10"
    assert body["platformFeeBalanceUsdc"] == "128.75"
    assert body["chainConfirmedNotLedgerConfirmedCount"] == 1
    assert body["depositP95SyncDelaySeconds"] == 184
    assert body["recentlyCompletedOutflowsUsdc"] == "186.40"
    assert len(body["priorityApprovals"]) >= 1
    assert body["depositRepairApprovals"][0]["approvalType"] == "deposit_repair"
    assert isinstance(body["pendingWithdrawalReviews"], list)
    assert body["priorityApprovals"][0]["ownerAddress"]


def test_reconciliation_drilldown_cross_locates_by_owner_and_tx_hash() -> None:
    _login_as("ops@synapse.network")

    owner_response = client.get(
        "/api/admin/v1/dashboard/reconciliation-drilldown",
        params={"ownerAddress": "0x8f3a2c6d4b1180e6ac93d55aefe34c81a8d6d111"},
    )

    assert owner_response.status_code == 200
    owner_body = owner_response.json()["data"]
    assert owner_body["ownerAddress"] == "0x8f3a2c6d4b1180e6ac93d55aefe34c81a8d6d111"
    assert len(owner_body["priorityApprovals"]) >= 1
    assert len(owner_body["depositRepairApprovals"]) >= 1
    assert isinstance(owner_body["pendingWithdrawalReviews"], list)

    tx_response = client.get(
        "/api/admin/v1/dashboard/reconciliation-drilldown",
        params={"txHash": "0xdep003"},
    )

    assert tx_response.status_code == 200
    tx_body = tx_response.json()["data"]
    assert tx_body["txHash"] == "0xdep003"
    assert tx_body["depositRepairApprovals"][0]["approvalId"] == "APR-20260316-003"
    assert tx_body["pendingWithdrawalReviews"] == []


def test_dashboard_diagnostics_expose_runtime_signals_and_actions() -> None:
    _login_as("ops@synapse.network")

    response = client.get("/api/admin/v1/dashboard/diagnostics")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["overallStatus"] == "degraded"
    assert "reconciliation alert present" in body["summary"]
    assert len(body["signals"]) == 5
    assert body["signals"][0]["signalId"] == "reconciliation"
    assert body["signals"][0]["status"] == "degraded"
    assert len(body["actions"]) == 3
    assert "persisted task status" in body["actions"][0]["detail"]


def test_dashboard_service_pending_counts_include_projected_provider_reviews() -> None:
    service = DashboardService(
        InMemoryAdminStore.seed_demo(),
        InMemoryGatewayDashboardProjectionRepository.seed_demo(),
        InMemoryProviderWithdrawReviewRepository.seed_demo(),
    )

    assert service.get_overview()["metrics"]["pendingApprovals"] == 5
    assert service.get_system_status()["approvalQueueDepth"] == 5
    assert service.get_reconciliation_detail()["pendingApprovals"] == 5


def test_audit_actions_list_is_available() -> None:
    _login_as("audit@synapse.network")

    response = client.get("/api/admin/v1/audit/actions?resultStatus=failure")

    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert len(items) >= 1
    assert items[0]["resultStatus"] == "failure"


def test_execution_jobs_list_and_retry() -> None:
    csrf_headers = _login_as("finance-review@synapse.network")

    list_response = client.get("/api/admin/v1/execution-jobs?status=FAILED")
    assert list_response.status_code == 200
    items = list_response.json()["data"]["items"]
    assert len(items) >= 1
    job_id = items[0]["jobId"]

    retry_response = client.post(
        f"/api/admin/v1/execution-jobs/{job_id}/retry",
        headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance-review@synapse.network")},
    )

    assert retry_response.status_code == 200
    assert retry_response.json()["data"]["status"] == "SUCCEEDED"

    jobs_response = client.get("/api/admin/v1/execution-jobs?approvalId=APR-20260316-003")
    assert jobs_response.status_code == 200
    retried_job = jobs_response.json()["data"]["items"][0]
    assert retried_job["status"] == "SUCCEEDED"
    assert retried_job["retryCount"] == 2
    assert retried_job["attempts"][0]["status"] == "SUCCEEDED"


def test_high_risk_route_requires_google_authenticator_header() -> None:
    csrf_headers = _login_as("finance-review@synapse.network")

    response = client.post(
        "/api/admin/v1/approvals/APR-20260316-001/decision",
        headers=csrf_headers,
        json={"decision": "APPROVE", "comment": "missing otp"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_cookie_authenticated_write_requires_csrf_token() -> None:
    _login_as("super@synapse.network")

    response = client.post(
        "/api/admin/v1/users",
        json={
            "email": "csrf-missing@synapse.network",
            "displayName": "Missing CSRF",
            "roleKey": "platform_ops_admin",
            "password": PLACEHOLDER_PASSWORD,
            "requireMfa": False,
            "status": "active",
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["message"] == "Invalid CSRF token"
