from fastapi.testclient import TestClient
from uuid import uuid4

from src.app import app
from src.api import deps
from src.core.totp import generate_totp_code
from src.core.security import hash_password
from src.domain import AdminMfaFactor, AdminUser
from src.domain.enums import AdminUserStatus, MfaFactorStatus, MfaFactorType

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


def test_admin_auth_policy_exposes_google_authenticator_switches() -> None:
    response = client.get("/api/admin/v1/auth/policy")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["loginTotpRequired"] is True
    assert body["highRiskTotpRequired"] is True
    assert body["totpIssuer"] == "Synapse Gateway Admin"


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
            "requiredRoles": ["super_admin"],
            "requiredPermissions": ["dashboard:read"],
            "sortOrder": 65,
        },
    )
    assert create_response.status_code == 200
    assert any(item["itemId"] == "ops-copilot" for item in create_response.json()["data"]["items"])
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
            "requiredRoles": ["super_admin", "platform_ops_admin"],
            "requiredPermissions": ["dashboard:read"],
            "sortOrder": 66,
        },
    )
    assert update_response.status_code == 200
    assert any(item["label"] == "运行副驾中心" for item in update_response.json()["data"]["items"])

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


def test_published_menu_config_is_available_to_regular_admins() -> None:
    _login_as("finance@synapse.network")

    response = client.get("/api/admin/v1/config/menu-items?stage=published")
    assert response.status_code == 200
    assert any(item["itemId"] == "dashboard" for item in response.json()["data"]["items"])


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


def test_draft_menu_config_requires_control_plane_role() -> None:
    _login_as("finance@synapse.network")

    response = client.get("/api/admin/v1/config/menu-items")

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
    assert body["metrics"]["pendingApprovals"] >= 1
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
    assert body["approvalQueueDepth"] >= 1
    assert body["lastReconciliationAt"] == "2026-03-16T08:00:00Z"


def test_finance_overview_exposes_gateway_finance_projection() -> None:
    _login_as("ops@synapse.network")

    response = client.get("/api/admin/v1/dashboard/finance-overview")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["todayChargeUsdc"] == "1280.40"
    assert body["todayDepositUsdc"] == "1640.00"
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
    assert points[-1]["netFlowUsdc"] == "1287.25"


def test_operations_overview_exposes_gateway_ops_projection() -> None:
    _login_as("ops@synapse.network")

    response = client.get("/api/admin/v1/dashboard/operations-overview")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["gatewayStatus"] == "degraded"
    assert body["backfillLastScannedBlock"] == 19450321
    assert body["reconciliationAlert"] is True
    assert body["reconciliationLastError"] == "vault_delta_detected"


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
