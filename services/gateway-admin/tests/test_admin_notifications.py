from datetime import datetime, timezone
from uuid import uuid4

from src.domain import AdminInAppNotification
from src.services.adapters.provider_services import (
    HttpProviderServicesAdapter,
    ProviderServicesAdapterError,
)
from src.services.admin_notifications import AdminNotificationService
from src.services.auth.service import AdminIdentity
from src.storage import InMemoryAdminStore

from test_app import (
    TEST_PROVIDER_SERVICES_ADAPTER,
    TEST_STORE,
    _login_as,
    client,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _notification(
    *,
    recipient_admin_id: str,
    notification_id: str | None = None,
    dedupe_key: str | None = None,
    event_type: str = "admin.provider_service.pause",
    resource_id: str = "svc_quotes",
) -> AdminInAppNotification:
    suffix = uuid4().hex
    return AdminInAppNotification(
        notification_id=notification_id or f"notif_{suffix}",
        dedupe_key=dedupe_key or f"dedupe_{suffix}",
        recipient_admin_id=recipient_admin_id,
        event_type=event_type,
        category="service",
        severity="warning",
        priority="ops",
        title="Provider service pause submitted",
        body="Quote Engine is now inactive. Review the service record if follow-up is needed.",
        action_url=f"/provider-services?serviceId={resource_id}",
        resource_type="provider_service",
        resource_id=resource_id,
        payload={"serviceId": resource_id, "action": "PAUSE"},
        created_at=_now(),
    )


def test_admin_notification_repository_dedupe_read_archive_flow() -> None:
    store = InMemoryAdminStore.seed_demo()
    first = _notification(
        recipient_admin_id="adm_super_admin",
        notification_id="notif_first",
        dedupe_key="admin:provider-service:svc_quotes:lifecycle:PAUSE:inactive:adm_super_admin",
    )
    replacement = _notification(
        recipient_admin_id="adm_super_admin",
        notification_id="notif_replacement",
        dedupe_key=first.dedupe_key,
    )

    store.notifications.enqueue(first)
    store.notifications.enqueue(replacement)

    rows = store.notifications.list_for_admin(admin_id="adm_super_admin")
    assert len([row for row in rows if row.dedupe_key == first.dedupe_key]) == 1
    assert rows[0].notification_id == "notif_replacement"
    assert store.notifications.unread_count_for_admin(admin_id="adm_super_admin") == 1
    assert store.notifications.mark_read(
        admin_id="adm_super_admin",
        notification_id="notif_replacement",
    )
    assert store.notifications.unread_count_for_admin(admin_id="adm_super_admin") == 0
    assert store.notifications.archive(
        admin_id="adm_super_admin",
        notification_id="notif_replacement",
    )
    assert store.notifications.list_for_admin(admin_id="adm_super_admin") == []


def test_admin_notifications_api_scopes_rows_to_current_admin() -> None:
    own = _notification(
        recipient_admin_id="adm_super_admin",
        notification_id=f"notif_scope_own_{uuid4().hex}",
        dedupe_key=f"dedupe_scope_own_{uuid4().hex}",
        resource_id="svc_scope_own",
    )
    other = _notification(
        recipient_admin_id="adm_finance_admin",
        notification_id=f"notif_scope_other_{uuid4().hex}",
        dedupe_key=f"dedupe_scope_other_{uuid4().hex}",
        resource_id="svc_scope_other",
    )
    TEST_STORE.notifications.enqueue(own)
    TEST_STORE.notifications.enqueue(other)
    csrf_headers = _login_as("cliff@synapse-network.ai")

    response = client.get("/api/admin/v1/notifications?limit=100")

    assert response.status_code == 200
    notifications = response.json()["data"]["notifications"]
    ids = {item["notificationId"] for item in notifications}
    assert own.notification_id in ids
    assert other.notification_id not in ids

    other_read_response = client.post(
        f"/api/admin/v1/notifications/{other.notification_id}/read",
        headers=csrf_headers,
    )
    assert other_read_response.status_code == 200
    assert other_read_response.json()["data"]["read"] is False

    own_read_response = client.post(
        f"/api/admin/v1/notifications/{own.notification_id}/read",
        headers=csrf_headers,
    )
    assert own_read_response.status_code == 200
    assert own_read_response.json()["data"]["read"] is True

    mark_all_response = client.post(
        "/api/admin/v1/notifications/mark-all-read",
        headers=csrf_headers,
    )
    assert mark_all_response.status_code == 200
    assert mark_all_response.json()["data"]["markedCount"] >= 0


def test_provider_services_lifecycle_notification_read_archive_flow() -> None:
    csrf_headers = _login_as("cliff@synapse-network.ai")

    lifecycle_response = client.post(
        "/api/admin/v1/provider-services/svc_quotes/lifecycle",
        headers=csrf_headers,
        json={"action": "SUSPEND", "note": "ops suspend"},
    )
    assert lifecycle_response.status_code == 200

    inbox_response = client.get("/api/admin/v1/notifications")
    assert inbox_response.status_code == 200
    notifications = inbox_response.json()["data"]["notifications"]
    notification = next(
        item
        for item in notifications
        if item["resourceId"] == "svc_quotes"
        and item["eventType"] == "admin.provider_service.suspend"
    )
    assert notification["title"] == "Provider service suspend submitted"
    assert notification["actionUrl"] == "/provider-services?serviceId=svc_quotes"
    assert "synapse_in_app_notifications" not in notification["body"]

    count_response = client.get("/api/admin/v1/notifications/unread-count")
    assert count_response.status_code == 200
    assert count_response.json()["data"]["unreadCount"] >= 1

    read_response = client.post(
        f"/api/admin/v1/notifications/{notification['notificationId']}/read",
        headers=csrf_headers,
    )
    assert read_response.status_code == 200
    assert read_response.json()["data"]["read"] is True

    archive_response = client.post(
        f"/api/admin/v1/notifications/{notification['notificationId']}/archive",
        headers=csrf_headers,
    )
    assert archive_response.status_code == 200
    assert archive_response.json()["data"]["archived"] is True


def test_provider_services_delete_success_enqueues_admin_notification() -> None:
    csrf_headers = _login_as("cliff@synapse-network.ai")

    response = client.request(
        "DELETE",
        "/api/admin/v1/provider-services/svc_quotes",
        headers=csrf_headers,
        json={"note": "delete from test"},
    )

    assert response.status_code == 200
    inbox_response = client.get("/api/admin/v1/notifications?limit=100")
    assert any(
        item["eventType"] == "admin.provider_service.delete" and item["resourceId"] == "svc_quotes"
        for item in inbox_response.json()["data"]["notifications"]
    )


def test_provider_services_action_failures_enqueue_actor_notification() -> None:
    csrf_headers = _login_as("cliff@synapse-network.ai")
    original_probe = TEST_PROVIDER_SERVICES_ADAPTER.force_probe
    original_lifecycle = TEST_PROVIDER_SERVICES_ADAPTER.update_lifecycle
    original_delete = TEST_PROVIDER_SERVICES_ADAPTER.delete_service

    def fail_probe(*, actor, service_id):
        _ = actor, service_id
        raise ProviderServicesAdapterError(
            code="UPSTREAM_DOWN",
            message="Provider service action failed.",
            status_code=503,
        )

    def fail_lifecycle(*, actor, service_id, action, note):
        _ = actor, service_id, action, note
        raise ProviderServicesAdapterError(
            code="UPSTREAM_DOWN",
            message="Provider service action failed.",
            status_code=503,
        )

    def fail_delete(*, actor, service_id, note):
        _ = actor, service_id, note
        raise ProviderServicesAdapterError(
            code="UPSTREAM_DOWN",
            message="Provider service action failed.",
            status_code=503,
        )

    try:
        TEST_PROVIDER_SERVICES_ADAPTER.force_probe = fail_probe
        TEST_PROVIDER_SERVICES_ADAPTER.update_lifecycle = fail_lifecycle
        TEST_PROVIDER_SERVICES_ADAPTER.delete_service = fail_delete

        probe = client.post(
            "/api/admin/v1/provider-services/svc_probe_fail/force-probe",
            headers=csrf_headers,
        )
        lifecycle = client.post(
            "/api/admin/v1/provider-services/svc_lifecycle_fail/lifecycle",
            headers=csrf_headers,
            json={"action": "PAUSE"},
        )
        delete = client.request(
            "DELETE",
            "/api/admin/v1/provider-services/svc_delete_fail",
            headers=csrf_headers,
            json={"note": "delete fail"},
        )
    finally:
        TEST_PROVIDER_SERVICES_ADAPTER.force_probe = original_probe
        TEST_PROVIDER_SERVICES_ADAPTER.update_lifecycle = original_lifecycle
        TEST_PROVIDER_SERVICES_ADAPTER.delete_service = original_delete

    assert probe.status_code == 503
    assert lifecycle.status_code == 503
    assert delete.status_code == 503
    inbox_response = client.get("/api/admin/v1/notifications?limit=100")
    rows = inbox_response.json()["data"]["notifications"]
    assert {
        "svc_probe_fail",
        "svc_lifecycle_fail",
        "svc_delete_fail",
    }.issubset(
        {
            item["resourceId"]
            for item in rows
            if item["eventType"] == "admin.provider_service.action_failed"
        }
    )


def test_http_provider_service_adapter_handles_null_detail_error(monkeypatch) -> None:
    actor = AdminIdentity(
        admin_id="adm_super_admin",
        email="cliff@synapse-network.ai",
        display_name="Super Admin",
        role="super_admin",
        permissions=("dashboard:read",),
    )
    adapter = HttpProviderServicesAdapter(
        base_url="https://gateway.test",
        admin_wallet="0xabc",
        jwt_secret="x" * 32,
        token_issuer="test",
        token_audience="gateway",
        service_subject="admin",
        timeout_sec=1,
    )

    def fake_request(*args, **kwargs):
        _ = args, kwargs
        return type(
            "Response",
            (),
            {
                "is_success": False,
                "status_code": 500,
                "text": "Internal Server Error",
                "json": lambda self: {"detail": None},
            },
        )()

    monkeypatch.setattr("src.services.adapters.provider_services.httpx.request", fake_request)

    try:
        adapter.list_services(actor=actor, params={})
    except ProviderServicesAdapterError as exc:
        assert exc.code == "GATEWAY_HTTP_500"
        assert exc.status_code == 500
    else:
        raise AssertionError("expected ProviderServicesAdapterError")


def test_admin_notification_service_fans_out_provider_lifecycle_to_actor_and_submitters() -> None:
    store = InMemoryAdminStore.seed_demo()
    service = AdminNotificationService(store)
    actor = AdminIdentity(
        admin_id="adm_super_admin",
        email="cliff@synapse-network.ai",
        display_name="Super Admin",
        role="super_admin",
        permissions=("dashboard:read", "approval:submit"),
    )

    service.notify_provider_service_action(
        actor=actor,
        service={"serviceId": "svc_quotes", "serviceName": "Quote Engine"},
        action="PAUSE",
        status="inactive",
    )

    super_rows = store.notifications.list_for_admin(admin_id="adm_super_admin")
    finance_rows = store.notifications.list_for_admin(admin_id="adm_finance_admin")
    readonly_rows = store.notifications.list_for_admin(admin_id="adm_readonly_analyst")

    assert any(row.event_type == "admin.provider_service.pause" for row in super_rows)
    assert any(row.event_type == "admin.provider_service.pause" for row in finance_rows)
    assert not any(row.event_type == "admin.provider_service.pause" for row in readonly_rows)
    assert super_rows[0].action_url == "/provider-services?serviceId=svc_quotes"
    assert super_rows[0].payload["actorAdminId"] == "adm_super_admin"


def test_provider_services_force_probe_only_enqueues_attention_when_unhealthy() -> None:
    csrf_headers = _login_as("cliff@synapse-network.ai")
    original = TEST_PROVIDER_SERVICES_ADAPTER.service
    service_id = "svc_quotes"
    try:
        healthy_response = client.post(
            f"/api/admin/v1/provider-services/{service_id}/force-probe",
            headers=csrf_headers,
        )
        assert healthy_response.status_code == 200
        healthy_inbox = client.get("/api/admin/v1/notifications")
        assert not any(
            item["eventType"] == "admin.provider_service.health_attention"
            and item["resourceId"] == service_id
            for item in healthy_inbox.json()["data"]["notifications"]
        )

        TEST_PROVIDER_SERVICES_ADAPTER.service = {
            **original,
            "runtimeStatus": "unhealthy",
            "health": {
                **original["health"],
                "overallStatus": "unhealthy",
                "probeStatus": "unhealthy",
                "isStale": False,
            },
        }

        response = client.post(
            f"/api/admin/v1/provider-services/{service_id}/force-probe",
            headers=csrf_headers,
        )

        assert response.status_code == 200
        after_response = client.get("/api/admin/v1/notifications?limit=100")
        after_count = sum(
            1
            for item in after_response.json()["data"]["notifications"]
            if item["eventType"] == "admin.provider_service.health_attention"
            and item["resourceId"] == service_id
        )
        assert after_count >= 1
        assert any(
            item["eventType"] == "admin.provider_service.health_attention"
            and item["resourceId"] == service_id
            and item["severity"] in {"warning", "critical"}
            for item in after_response.json()["data"]["notifications"]
        )
    finally:
        TEST_PROVIDER_SERVICES_ADAPTER.service = original
