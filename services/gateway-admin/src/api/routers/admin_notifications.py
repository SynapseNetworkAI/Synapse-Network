from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from src.api.deps import get_admin_notification_service, get_request_id, require_admin
from src.api.schemas.common import ApiResponse
from src.domain import AdminInAppNotification
from src.services.admin_notifications import AdminNotificationService
from src.services.auth.service import AdminIdentity

router = APIRouter(prefix="/api/admin/v1/notifications", tags=["admin-notifications"])


def _serialize_notification(row: AdminInAppNotification) -> dict[str, Any]:
    return {
        "notificationId": row.notification_id,
        "eventType": row.event_type,
        "category": row.category,
        "severity": row.severity,
        "priority": row.priority,
        "title": row.title,
        "body": row.body,
        "actionUrl": row.action_url,
        "resourceType": row.resource_type,
        "resourceId": row.resource_id,
        "payload": row.payload,
        "readAt": row.read_at.isoformat().replace("+00:00", "Z") if row.read_at else None,
        "archivedAt": row.archived_at.isoformat().replace("+00:00", "Z") if row.archived_at else None,
        "createdAt": row.created_at.isoformat().replace("+00:00", "Z") if row.created_at else None,
    }


@router.get("", response_model=ApiResponse)
def list_admin_notifications(
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    service: Annotated[AdminNotificationService, Depends(get_admin_notification_service)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    unread_only: Annotated[bool, Query(alias="unreadOnly")] = False,
):
    rows = service.list_for_admin(admin=admin, limit=limit, unread_only=unread_only)
    return ApiResponse(
        data={"notifications": [_serialize_notification(row) for row in rows]},
        request_id=request_id,
    )


@router.get("/unread-count", response_model=ApiResponse)
def get_admin_notification_unread_count(
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    service: Annotated[AdminNotificationService, Depends(get_admin_notification_service)],
):
    return ApiResponse(
        data={"unreadCount": service.unread_count(admin=admin)},
        request_id=request_id,
    )


@router.post("/{notification_id}/read", response_model=ApiResponse)
def mark_admin_notification_read(
    notification_id: str,
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    service: Annotated[AdminNotificationService, Depends(get_admin_notification_service)],
):
    return ApiResponse(
        data={"notificationId": notification_id, "read": service.mark_read(admin=admin, notification_id=notification_id)},
        request_id=request_id,
    )


@router.post("/mark-all-read", response_model=ApiResponse)
def mark_all_admin_notifications_read(
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    service: Annotated[AdminNotificationService, Depends(get_admin_notification_service)],
):
    return ApiResponse(
        data={"markedCount": service.mark_all_read(admin=admin)},
        request_id=request_id,
    )


@router.post("/{notification_id}/archive", response_model=ApiResponse)
def archive_admin_notification(
    notification_id: str,
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    service: Annotated[AdminNotificationService, Depends(get_admin_notification_service)],
):
    return ApiResponse(
        data={"notificationId": notification_id, "archived": service.archive(admin=admin, notification_id=notification_id)},
        request_id=request_id,
    )
