from fastapi.testclient import TestClient

from src.app import app

client = TestClient(app)
PLACEHOLDER_PASSWORD = "phase1-" + "placeholder"


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
            "otpCode": "123456",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["accessToken"].startswith("adm_demo_")


def test_dashboard_requires_auth() -> None:
    response = client.get("/api/admin/v1/dashboard/overview")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"
    assert response.json()["requestId"].startswith("req_")


def test_approval_submit_forbidden_without_permission() -> None:
    login_response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": "audit@synapse.network",
            "password": PLACEHOLDER_PASSWORD,
            "otpCode": "123456",
        },
    )
    token = login_response.json()["data"]["accessToken"]

    response = client.post(
        "/api/admin/v1/approvals",
        headers={"Authorization": f"Bearer {token}"},
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
    login_response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": "finance-review@synapse.network",
            "password": PLACEHOLDER_PASSWORD,
            "otpCode": "123456",
        },
    )
    token = login_response.json()["data"]["accessToken"]

    response = client.post(
        "/api/admin/v1/approvals/APR-20260316-001/decision",
        headers={"Authorization": f"Bearer {token}"},
        json={"decision": "APPROVE", "comment": "approved"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "APPROVED_PENDING_EXECUTION"
