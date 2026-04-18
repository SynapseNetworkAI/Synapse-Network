from __future__ import annotations

import asyncio
import math
from typing import Any

from src.domain.service_contract import ServiceDefinitionRecord
from src.services.owner.downstream_concurrency import downstream_snapshot_for_service
from src.services.platform import credential_service, service_health_service
from src.services.provider.registry.payload_helpers import (
    is_deleted_service,
    service_lifecycle_status,
)
from src.utils.datetime_utils import now_dt_str

from .interfaces import RegistryContext


def _runtime_status(service: ServiceDefinitionRecord) -> str:
    return service_health_service.effective_runtime_status(service)


def _target_payloads(service: ServiceDefinitionRecord) -> list[dict[str, Any]]:
    health = service.runtime_health
    if health is None:
        return []
    return [
        target.model_dump(by_alias=True, mode="json", exclude_none=True)
        for target in health.targets
    ]


def _admin_service_payload(service: ServiceDefinitionRecord) -> dict[str, Any]:
    control_status = service_lifecycle_status(service)
    downstream = downstream_snapshot_for_service(service)
    return {
        "serviceId": service.service_id,
        "ownerAddress": service.owner_address,
        "serviceName": service.service_name,
        "summary": service.summary,
        "tags": list(service.tags),
        "pricing": {
            "amount": str(service.pricing_amount),
            "currency": service.pricing_currency,
        },
        "controlStatus": control_status,
        "status": control_status,
        "isActive": bool(service.is_active),
        "runtimeStatus": _runtime_status(service),
        "runtimeAvailable": service_health_service.is_service_discoverable(service),
        "probeTier": service_health_service.service_probe_tier(service),
        "health": service_health_service.public_health_summary(service),
        "targets": _target_payloads(service),
        "adaptiveConcurrencyLimit": downstream["adaptiveConcurrencyLimit"],
        "inFlight": downstream["inFlight"],
        "queueDepth": downstream["queueDepth"],
        "latencyP95Ms": downstream["latencyP95Ms"],
        "errorRate": downstream["errorRate"],
        "circuitState": downstream["circuitState"],
        "lastConcurrencyAdjustmentAt": downstream["lastConcurrencyAdjustmentAt"],
        "downstreamTargets": downstream["targets"],
        "createdAt": service.created_at,
        "updatedAt": service.updated_at,
    }


def _matches_query(service: ServiceDefinitionRecord, query: str | None) -> bool:
    normalized = str(query or "").strip().lower()
    if not normalized:
        return True
    haystack = " ".join(
        [
            str(service.service_id or ""),
            str(service.service_name or ""),
            str(service.owner_address or ""),
            str(service.summary or ""),
            " ".join(str(tag) for tag in service.tags),
        ]
    ).lower()
    return normalized in haystack


async def list_admin_provider_services(
    context: RegistryContext,
    *,
    query: str | None,
    status: str | None,
    runtime_status: str | None,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    await asyncio.sleep(0)
    rows = context._load_service_registry_rows()
    normalized_status = str(status or "all").strip().lower()
    normalized_runtime_status = str(runtime_status or "all").strip().lower()
    filtered = [
        row
        for row in rows
        if not is_deleted_service(row)
        and _matches_query(row, query)
        and (
            normalized_status == "all"
            or service_lifecycle_status(row) == normalized_status
        )
        and (
            normalized_runtime_status == "all"
            or _runtime_status(row) == normalized_runtime_status
        )
    ]
    filtered.sort(key=lambda row: str(row.updated_at or row.created_at or ""), reverse=True)
    safe_page = max(1, int(page or 1))
    safe_page_size = max(1, min(int(page_size or 20), 100))
    total = len(filtered)
    start = (safe_page - 1) * safe_page_size
    end = start + safe_page_size
    return {
        "items": [_admin_service_payload(row) for row in filtered[start:end]],
        "page": safe_page,
        "pageSize": safe_page_size,
        "totalCount": total,
        "totalPages": max(1, math.ceil(total / safe_page_size)),
    }


async def get_admin_provider_service(
    context: RegistryContext,
    service_id: str,
) -> dict[str, Any] | None:
    await asyncio.sleep(0)
    for row in context._load_service_registry_rows():
        if str(row.service_id or "") == service_id and not is_deleted_service(row):
            return _admin_service_payload(row)
    return None


def _find_service_index(rows: list[ServiceDefinitionRecord], service_id: str) -> int:
    for index, service in enumerate(rows):
        if str(service.service_id or "") == service_id and not is_deleted_service(service):
            return index
    return -1


async def force_probe_admin_provider_service(
    context: RegistryContext,
    *,
    service_id: str,
    actor_wallet: str,
    actor_admin_id: str,
) -> dict[str, Any] | None:
    async with context._registry_lock():
        rows = context._load_service_registry_rows()
        index = _find_service_index(rows, service_id)
        if index < 0:
            return None
        probed = await service_health_service.force_probe_service_health(rows[index])
        rows[index] = probed
        service_health_service.sync_service_target_health_table(context.storage, rows)
        if service_health_service.settings.service_health_history_enabled:
            service_health_service.append_health_history_rows(
                context.storage,
                service_health_service.build_probe_history_rows(probed),
            )
        credential_service.append_audit_log(
            context.storage,
            "admin.provider_service.force_probe",
            actor_wallet,
            {
                "serviceId": service_id,
                "actorAdminId": actor_admin_id,
                "resultStatus": "success",
            },
        )
        return _admin_service_payload(probed)


async def update_admin_provider_service_lifecycle(
    context: RegistryContext,
    *,
    service_id: str,
    action: str,
    actor_wallet: str,
    actor_admin_id: str,
    note: str | None = None,
) -> dict[str, Any] | None:
    async with context._registry_lock():
        rows = context._load_service_registry_rows()
        index = _find_service_index(rows, service_id)
        if index < 0:
            return None
        service = rows[index]
        normalized_action = str(action or "").strip().upper()
        if normalized_action == "PAUSE":
            updated = service.model_copy(update={"status": "inactive", "is_active": False, "updated_at": now_dt_str()})
        elif normalized_action == "SUSPEND":
            updated = service.model_copy(update={"status": "suspended", "is_active": False, "updated_at": now_dt_str()})
        elif normalized_action == "RESUME":
            updated = service.model_copy(update={"status": "active", "is_active": True, "updated_at": now_dt_str()})
            updated = await service_health_service.force_probe_service_health(updated)
        else:
            raise ValueError("SERVICE_LIFECYCLE_ACTION_INVALID")

        rows[index] = updated
        context._save_service_registry_rows(rows)
        service_health_service.sync_service_target_health_table(context.storage, rows)
        credential_service.append_audit_log(
            context.storage,
            "admin.provider_service.lifecycle_updated",
            actor_wallet,
            {
                "serviceId": service_id,
                "action": normalized_action,
                "controlStatus": service_lifecycle_status(updated),
                "actorAdminId": actor_admin_id,
                "note": note,
                "resultStatus": "success",
            },
        )
        return _admin_service_payload(updated)


async def delete_admin_provider_service(
    context: RegistryContext,
    *,
    service_id: str,
    actor_wallet: str,
    actor_admin_id: str,
    note: str | None = None,
) -> bool:
    async with context._registry_lock():
        rows = context._load_service_registry_rows()
        index = _find_service_index(rows, service_id)
        if index < 0:
            return False
        service = rows[index]
        if service_lifecycle_status(service) == "active":
            raise ValueError("SERVICE_DELETE_ACTIVE_CONFLICT")
        deleted = service.model_copy(
            update={"status": "deleted", "is_active": False, "updated_at": now_dt_str()}
        )
        rows[index] = deleted
        context._save_service_registry_rows(rows)
        service_health_service.sync_service_target_health_table(context.storage, rows)
        credential_service.append_audit_log(
            context.storage,
            "admin.provider_service.deleted",
            actor_wallet,
            {
                "serviceId": service_id,
                "actorAdminId": actor_admin_id,
                "note": note,
                "resultStatus": "success",
            },
        )
        return True
