from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query

from src.api.routers.balance_helpers import get_owner_wallet
from src.services.notifications import in_app
from src.storage import BaseStorage, get_storage

router = APIRouter()


def _serialize_notification(row: Any) -> dict[str, Any]:
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
        "readAt": row.read_at,
        "archivedAt": row.archived_at,
        "expiresAt": row.expires_at,
        "createdAt": row.created_at,
    }


@router.get("/v1/notifications")
async def list_notifications(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    storage: Annotated[BaseStorage, Depends(get_storage)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(max_length=80)] = None,
    unread_only: Annotated[bool, Query(alias="unreadOnly")] = False,
):
    rows = await in_app.list_owner_notifications(
        storage,
        owner_wallet=owner_wallet,
        limit=limit,
        cursor=cursor,
        unread_only=unread_only,
    )
    next_cursor = rows[-1].created_at if len(rows) == limit else None
    return {
        "status": "success",
        "ownerAddress": owner_wallet,
        "notifications": [_serialize_notification(row) for row in rows],
        "nextCursor": next_cursor,
    }


@router.get("/v1/notifications/unread-count")
async def get_unread_count(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    storage: Annotated[BaseStorage, Depends(get_storage)],
):
    count = await in_app.unread_count(storage, owner_wallet=owner_wallet)
    return {"status": "success", "ownerAddress": owner_wallet, "unreadCount": count}


@router.post("/v1/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    storage: Annotated[BaseStorage, Depends(get_storage)],
):
    updated = await in_app.mark_read(
        storage,
        owner_wallet=owner_wallet,
        notification_id=notification_id,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"status": "success", "notificationId": notification_id, "read": True}


@router.post("/v1/notifications/mark-all-read")
async def mark_all_notifications_read(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    storage: Annotated[BaseStorage, Depends(get_storage)],
):
    updated = await in_app.mark_all_read(storage, owner_wallet=owner_wallet)
    return {"status": "success", "ownerAddress": owner_wallet, "updated": updated}


@router.post("/v1/notifications/{notification_id}/archive")
async def archive_notification(
    notification_id: str,
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    storage: Annotated[BaseStorage, Depends(get_storage)],
):
    updated = await in_app.archive(
        storage,
        owner_wallet=owner_wallet,
        notification_id=notification_id,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"status": "success", "notificationId": notification_id, "archived": True}
