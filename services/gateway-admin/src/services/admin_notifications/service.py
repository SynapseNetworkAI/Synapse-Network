from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any
from uuid import uuid4

from src.domain import AdminActionAudit, AdminInAppNotification
from src.domain.enums import AdminUserStatus, AuditResultStatus, RoleBindingStatus
from src.services.auth.service import AdminIdentity
from src.storage.base import AdminStore

logger = logging.getLogger("synapse.gateway_admin.notifications")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _clean_text(value: object, fallback: str) -> str:
    text = str(value or "").strip()
    return text if text else fallback


class AdminNotificationService:
    def __init__(self, store: AdminStore) -> None:
        self._store = store

    def list_for_admin(
        self,
        *,
        admin: AdminIdentity,
        limit: int = 20,
        unread_only: bool = False,
    ) -> list[AdminInAppNotification]:
        return list(
            self._store.notifications.list_for_admin(
                admin_id=admin.admin_id,
                limit=limit,
                unread_only=unread_only,
            )
        )

    def unread_count(self, *, admin: AdminIdentity) -> int:
        return self._store.notifications.unread_count_for_admin(admin_id=admin.admin_id)

    def mark_read(self, *, admin: AdminIdentity, notification_id: str) -> bool:
        return self._store.notifications.mark_read(
            admin_id=admin.admin_id,
            notification_id=notification_id,
        )

    def mark_all_read(self, *, admin: AdminIdentity) -> int:
        return self._store.notifications.mark_all_read(admin_id=admin.admin_id)

    def archive(self, *, admin: AdminIdentity, notification_id: str) -> bool:
        return self._store.notifications.archive(
            admin_id=admin.admin_id,
            notification_id=notification_id,
        )

    def notify_provider_service_action(
        self,
        *,
        actor: AdminIdentity,
        service: dict[str, Any],
        action: str,
        status: str,
    ) -> None:
        service_id = _clean_text(service.get("serviceId"), "unknown-service")
        service_name = _clean_text(service.get("serviceName"), service_id)
        action_label = action.strip().upper()
        recipients = self._recipient_admin_ids(
            actor=actor,
            permissions={"approval:submit"},
        )
        self._fanout(
            recipients,
            event_type=f"admin.provider_service.{action_label.lower()}",
            category="service",
            severity="warning" if action_label in {"SUSPEND", "DELETE"} else "info",
            priority="ops",
            title=f"Provider service {action_label.lower()} submitted",
            body=f"{service_name} is now {status}. Review the service record if follow-up is needed.",
            action_url=f"/provider-services?serviceId={service_id}",
            resource_type="provider_service",
            resource_id=service_id,
            dedupe_prefix=f"admin:provider-service:{service_id}:lifecycle:{action_label}:{status}",
            payload={
                "serviceId": service_id,
                "serviceName": service_name,
                "action": action_label,
                "status": status,
                "actorAdminId": actor.admin_id,
                "resourceUrl": f"/provider-services?serviceId={service_id}",
            },
            actor=actor,
        )

    def notify_provider_service_probe_if_unhealthy(
        self,
        *,
        actor: AdminIdentity,
        service: dict[str, Any],
    ) -> None:
        service_id = _clean_text(service.get("serviceId"), "unknown-service")
        service_name = _clean_text(service.get("serviceName"), service_id)
        health = service.get("health") if isinstance(service.get("health"), dict) else {}
        runtime_status = _clean_text(
            health.get("overallStatus") or service.get("runtimeStatus"),
            "unknown",
        ).lower()
        is_stale = bool(health.get("isStale") or runtime_status == "stale")
        is_healthy = runtime_status == "healthy" and not is_stale
        if is_healthy:
            return
        recipients = self._recipient_admin_ids(
            actor=actor,
            permissions={"dashboard:read", "approval:submit"},
        )
        title = "Provider service needs attention"
        body = f"{service_name} probe is {runtime_status}. Open Provider Services to inspect routing and health."
        if is_stale:
            body = f"{service_name} health data is stale. Open Provider Services to inspect routing and health."
        self._fanout(
            recipients,
            event_type="admin.provider_service.health_attention",
            category="service",
            severity="critical" if runtime_status in {"outage", "unhealthy"} else "warning",
            priority="ops",
            title=title,
            body=body,
            action_url=f"/provider-services?serviceId={service_id}",
            resource_type="provider_service",
            resource_id=service_id,
            dedupe_prefix=f"admin:provider-service:{service_id}:probe:{runtime_status}:{'stale' if is_stale else 'fresh'}",
            payload={
                "serviceId": service_id,
                "serviceName": service_name,
                "runtimeStatus": runtime_status,
                "isStale": is_stale,
                "actorAdminId": actor.admin_id,
                "resourceUrl": f"/provider-services?serviceId={service_id}",
            },
            actor=actor,
        )

    def notify_provider_service_action_failed(
        self,
        *,
        actor: AdminIdentity,
        service_id: str,
        action: str,
    ) -> None:
        self._fanout(
            {actor.admin_id},
            event_type="admin.provider_service.action_failed",
            category="service",
            severity="warning",
            priority="ops",
            title="Provider service action needs retry",
            body="The service action could not be completed. Refresh the service record before trying again.",
            action_url=f"/provider-services?serviceId={service_id}",
            resource_type="provider_service",
            resource_id=service_id,
            dedupe_prefix=f"admin:provider-service:{service_id}:action-failed:{action}:{actor.admin_id}",
            payload={
                "serviceId": service_id,
                "action": action,
                "actorAdminId": actor.admin_id,
                "resourceUrl": f"/provider-services?serviceId={service_id}",
            },
            actor=actor,
        )

    def _recipient_admin_ids(self, *, actor: AdminIdentity, permissions: set[str]) -> set[str]:
        recipients = {actor.admin_id}
        try:
            active_users = self._store.identity.list_users(status=AdminUserStatus.ACTIVE.value, limit=500)
            for user in active_users:
                if self._user_has_any_permission(user.admin_id, permissions):
                    recipients.add(user.admin_id)
        except Exception:
            logger.exception("admin notification recipient fanout failed")
        return recipients

    def _user_has_any_permission(self, admin_id: str, permissions: set[str]) -> bool:
        for binding in self._store.authorization.list_role_bindings(admin_id):
            if binding.status != RoleBindingStatus.ACTIVE:
                continue
            for mapping in self._store.authorization.list_role_permissions(binding.role_key):
                if mapping.permission_key in permissions:
                    return True
        return False

    def _fanout(
        self,
        recipients: set[str],
        *,
        event_type: str,
        category: str,
        severity: str,
        priority: str,
        title: str,
        body: str,
        action_url: str,
        resource_type: str,
        resource_id: str,
        dedupe_prefix: str,
        payload: dict[str, Any],
        actor: AdminIdentity,
    ) -> None:
        for recipient_admin_id in sorted(recipients):
            notification = AdminInAppNotification(
                notification_id=f"admin_inapp_{uuid4().hex}",
                dedupe_key=f"{dedupe_prefix}:{recipient_admin_id}",
                recipient_admin_id=recipient_admin_id,
                event_type=event_type,
                category=category,
                severity=severity,
                priority=priority,
                title=title,
                body=body,
                action_url=action_url,
                resource_type=resource_type,
                resource_id=resource_id,
                payload=payload,
                created_at=_utcnow(),
            )
            try:
                self._store.notifications.enqueue(notification)
            except Exception:
                logger.exception("admin notification enqueue failed")
                try:
                    self._store.audit.append_action(
                        AdminActionAudit(
                            action_type="admin.notification.enqueue_failed",
                            result_status=AuditResultStatus.FAILURE,
                            operator_id=actor.admin_id,
                            operator_email=actor.email,
                            operator_role=actor.role,
                            resource_type=resource_type,
                            resource_id=resource_id,
                            error_code="ADMIN_NOTIFICATION_ENQUEUE_FAILED",
                            detail={
                                "recipientAdminId": recipient_admin_id,
                                "eventType": event_type,
                            },
                        )
                    )
                except Exception:
                    logger.exception("admin notification enqueue audit failed")
