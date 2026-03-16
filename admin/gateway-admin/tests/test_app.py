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


def test_dashboard_overview_uses_store_backed_metrics() -> None:
    login_response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": "ops@synapse.network",
            "password": PLACEHOLDER_PASSWORD,
            "otpCode": "123456",
        },
    )
    token = login_response.json()["data"]["accessToken"]

    response = client.get(
        "/api/admin/v1/dashboard/overview",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["metrics"]["pendingApprovals"] >= 1
    assert body["metrics"]["depositExceptions"] == 2
    assert body["metrics"]["auditAlerts"] == 1
    assert body["metrics"]["vaultLedgerDelta"] == "0.50"


def test_system_status_uses_gateway_projection_snapshot() -> None:
    login_response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": "ops@synapse.network",
            "password": PLACEHOLDER_PASSWORD,
            "otpCode": "123456",
        },
    )
    token = login_response.json()["data"]["accessToken"]

    response = client.get(
        "/api/admin/v1/dashboard/system-status",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["gatewayAdmin"] == "healthy"
    assert body["gateway"] == "degraded"
    assert body["approvalQueueDepth"] >= 1
    assert body["lastReconciliationAt"] == "2026-03-16T08:00:00Z"


def test_finance_overview_exposes_gateway_finance_projection() -> None:
    login_response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": "ops@synapse.network",
            "password": PLACEHOLDER_PASSWORD,
            "otpCode": "123456",
        },
    )
    token = login_response.json()["data"]["accessToken"]

    response = client.get(
        "/api/admin/v1/dashboard/finance-overview",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["todayChargeUsdc"] == "1280.40"
    assert body["todayDepositUsdc"] == "1640.00"
    assert body["vaultLedgerDeltaUsdc"] == "0.50"
    assert body["pendingDepositCount"] == 2
    assert body["pendingWithdrawalCount"] == 1


def test_activity_trends_expose_seven_day_projection() -> None:
    login_response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": "ops@synapse.network",
            "password": PLACEHOLDER_PASSWORD,
            "otpCode": "123456",
        },
    )
    token = login_response.json()["data"]["accessToken"]

    response = client.get(
        "/api/admin/v1/dashboard/activity-trends",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    points = response.json()["data"]["points"]
    assert len(points) == 7
    assert points[-1]["bucketDate"] == "2026-03-16"
    assert points[-1]["netFlowUsdc"] == "1287.25"


def test_operations_overview_exposes_gateway_ops_projection() -> None:
    login_response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": "ops@synapse.network",
            "password": PLACEHOLDER_PASSWORD,
            "otpCode": "123456",
        },
    )
    token = login_response.json()["data"]["accessToken"]

    response = client.get(
        "/api/admin/v1/dashboard/operations-overview",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["gatewayStatus"] == "degraded"
    assert body["backfillLastScannedBlock"] == 19450321
    assert body["reconciliationAlert"] is True
    assert body["reconciliationLastError"] == "vault_delta_detected"


def test_audit_actions_list_is_available() -> None:
    login_response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": "audit@synapse.network",
            "password": PLACEHOLDER_PASSWORD,
            "otpCode": "123456",
        },
    )
    token = login_response.json()["data"]["accessToken"]

    response = client.get(
        "/api/admin/v1/audit/actions?resultStatus=failure",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert len(items) >= 1
    assert items[0]["resultStatus"] == "failure"


def test_execution_jobs_list_and_retry() -> None:
    login_response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": "finance-review@synapse.network",
            "password": PLACEHOLDER_PASSWORD,
            "otpCode": "123456",
        },
    )
    token = login_response.json()["data"]["accessToken"]

    list_response = client.get(
        "/api/admin/v1/execution-jobs?status=FAILED",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert list_response.status_code == 200
    items = list_response.json()["data"]["items"]
    assert len(items) >= 1
    job_id = items[0]["jobId"]

    retry_response = client.post(
        f"/api/admin/v1/execution-jobs/{job_id}/retry",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert retry_response.status_code == 200
    assert retry_response.json()["data"]["status"] == "SUCCEEDED"

    jobs_response = client.get(
        "/api/admin/v1/execution-jobs?approvalId=APR-20260316-003",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert jobs_response.status_code == 200
    retried_job = jobs_response.json()["data"]["items"][0]
    assert retried_job["status"] == "SUCCEEDED"
    assert retried_job["retryCount"] == 2
    assert retried_job["attempts"][0]["status"] == "SUCCEEDED"
