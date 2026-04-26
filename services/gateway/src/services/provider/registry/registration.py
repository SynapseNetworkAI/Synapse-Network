from __future__ import annotations

import asyncio
import uuid
from typing import Any, Optional

from src.services.platform import credential_service, service_health_service
from src.services.analytics.gateway_events import (
    emit_service_registered,
    emit_service_register_failed,
)
from src.utils.datetime_utils import now_dt_str

from .interfaces import RegistryContext
from .payload_helpers import (
    bind_forwarding_service_id,
    ensure_unique_service_id,
    generate_service_id,
    is_deleted_service,
    normalize_service_payload,
    service_lifecycle_status,
)

_MIN_FULL_PAYOUT_ADDRESS_LENGTH = 8


def _latest_probe_error(service) -> str | None:
    health = getattr(service, "runtime_health", None)
    if health is None:
        return None
    for target in getattr(health, "targets", []) or []:
        error = str(getattr(target, "error", "") or "").strip()
        if error:
            return error
    return None


def _owner_service_response(service) -> dict[str, Any]:
    response = service.model_dump(by_alias=True, mode="json")
    health = service_health_service.public_health_summary(service)
    response["health"] = health
    response["runtimeAvailable"] = service_health_service.is_service_discoverable(service)
    response["probeStatus"] = health.get("probeStatus")
    response["lastCheckedAt"] = health.get("lastCheckedAt")
    response["probeError"] = _latest_probe_error(service)
    return response


def _masked_payout_address(value: str | None) -> str | None:
    normalized = str(value or "").strip()
    if len(normalized) <= _MIN_FULL_PAYOUT_ADDRESS_LENGTH:
        return normalized or None
    return f"{normalized[:6]}...{normalized[-4:]}"


def _audit_details(service_payload: dict[str, Any]) -> dict[str, Any]:
    payout_account = service_payload.get("payoutAccount")
    provider_profile = service_payload.get("providerProfile")
    governance = service_payload.get("governance")
    auth_payload = service_payload.get("auth")
    details: dict[str, Any] = {
        "serviceId": service_payload.get("serviceId"),
        "serviceName": service_payload.get("serviceName"),
        "status": service_payload.get("status"),
        "authType": auth_payload.get("type") if isinstance(auth_payload, dict) else None,
    }
    if isinstance(provider_profile, dict):
        details["providerDisplayName"] = provider_profile.get("displayName")
    if isinstance(payout_account, dict):
        details["payoutAccount"] = {
            "payoutAddress": _masked_payout_address(payout_account.get("payoutAddress")),
            "chainId": payout_account.get("chainId"),
            "settlementCurrency": payout_account.get("settlementCurrency"),
            "status": payout_account.get("status"),
        }
    if isinstance(governance, dict):
        details["governance"] = {
            "termsAccepted": bool(governance.get("termsAccepted", False)),
            "riskAcknowledged": bool(governance.get("riskAcknowledged", False)),
            "note": governance.get("note"),
        }
    return details


async def register_service(
    context: RegistryContext, req_data: dict[str, Any], owner_wallet: str
) -> dict[str, Any]:
    async with context._registry_lock():
        rows = context._load_service_registry_rows()
        new_svc = normalize_service_payload(req_data, owner_wallet)
        if not new_svc.service_id:
            new_svc = new_svc.model_copy(
                update={"service_id": generate_service_id(owner_wallet)}
            )
        try:
            ensure_unique_service_id(rows, str(new_svc.service_id or ""))
        except ValueError as exc:
            await emit_service_register_failed(
                owner_wallet,
                error_code="SERVICE_ID_CONFLICT",
                reason=str(exc),
            )
            raise
        new_svc = bind_forwarding_service_id(new_svc)
        created_at = now_dt_str()
        new_svc = new_svc.model_copy(
            update={
                "id": str(new_svc.id or uuid.uuid4()),
                "created_at": created_at,
                "updated_at": created_at,
            }
        )
        new_svc = await service_health_service.force_probe_service_health(new_svc)

        rows.append(new_svc)
        context._save_service_registry_rows(rows)
        service_health_service.sync_service_target_health_table(context.storage, rows)
        response = _owner_service_response(new_svc)
        credential_service.append_audit_log(
            context.storage,
            "provider.service.registered",
            owner_wallet,
            _audit_details(response),
        )
        await emit_service_registered(
            owner_wallet,
            service_id=str(new_svc.service_id or ""),
            service_name=str(new_svc.service_name or ""),
        )
        return response


async def update_service(
    context: RegistryContext,
    service_record_id: str,
    req_data: dict[str, Any],
    owner_wallet: str,
) -> Optional[dict[str, Any]]:
    async with context._registry_lock():
        rows = context._load_service_registry_rows()
        for index, svc in enumerate(rows):
            if svc.service_id != service_record_id or svc.owner_address != owner_wallet:
                continue

            if is_deleted_service(svc):
                raise ValueError("SERVICE_ALREADY_DELETED")

            blocked = {
                "id",
                "serviceId",
                "ownerAddress",
                "createdAt",
                "schemaVersion",
            }
            safe_patch = {key: value for key, value in req_data.items() if key not in blocked}
            # When isActive is explicitly set to False without a status override,
            # inject "paused" so the merged payload does not inherit the existing
            # "active" status — preventing service_lifecycle_status from returning "active".
            if "isActive" in safe_patch and not safe_patch["isActive"] and "status" not in safe_patch:
                safe_patch["status"] = "paused"
            updated_payload = {
                **svc.model_dump(by_alias=True, mode="json"),
                **safe_patch,
            }
            updated = normalize_service_payload(updated_payload, owner_wallet)
            updated = updated.model_copy(
                update={
                    "id": svc.id,
                    "service_id": svc.service_id,
                    "created_at": svc.created_at,
                    "owner_address": owner_wallet,
                    "updated_at": now_dt_str(),
                }
            )
            updated = bind_forwarding_service_id(updated)
            updated = await service_health_service.force_probe_service_health(updated)
            rows[index] = updated
            context._save_service_registry_rows(rows)
            service_health_service.sync_service_target_health_table(
                context.storage, rows
            )
            response = _owner_service_response(updated)
            credential_service.append_audit_log(
                context.storage,
                "provider.service.updated",
                owner_wallet,
                _audit_details(response),
            )
            return response

    return None


async def delete_service(
    context: RegistryContext, service_record_id: str, owner_wallet: str
) -> bool:
    async with context._registry_lock():
        rows = context._load_service_registry_rows()
        for index, svc in enumerate(rows):
            if svc.service_id != service_record_id or svc.owner_address != owner_wallet:
                continue

            if is_deleted_service(svc):
                return False
            if bool(svc.is_active) or service_lifecycle_status(svc) == "active":
                raise ValueError("SERVICE_DELETE_ACTIVE_CONFLICT")

            deleted = svc.model_copy(
                update={
                    "status": "deleted",
                    "is_active": False,
                    "updated_at": now_dt_str(),
                }
            )
            rows[index] = deleted
            context._save_service_registry_rows(rows)
            service_health_service.sync_service_target_health_table(
                context.storage, rows
            )
            credential_service.append_audit_log(
                context.storage,
                "provider.service.deleted",
                owner_wallet,
                {
                    "serviceId": service_record_id,
                    "serviceName": deleted.service_name,
                    "status": "deleted",
                    "deletedAt": deleted.updated_at,
                },
            )
            return True

    return False


async def has_owner_service(
    context: RegistryContext, service_record_id: str, owner_wallet: str
) -> bool:
    await asyncio.sleep(0)
    rows = context._load_service_registry_rows()
    for svc in rows:
        if svc.service_id != service_record_id or svc.owner_address != owner_wallet:
            continue
        return not is_deleted_service(svc)
    return False


async def force_probe_owner_service(
    context: RegistryContext, service_record_id: str, owner_wallet: str
) -> dict[str, Any] | None:
    async with context._registry_lock():
        rows = context._load_service_registry_rows()
        for index, svc in enumerate(rows):
            if svc.service_id != service_record_id or svc.owner_address != owner_wallet:
                continue
            if is_deleted_service(svc):
                return None
            probed = await service_health_service.force_probe_service_health(svc)
            rows[index] = probed
            service_health_service.sync_service_target_health_table(context.storage, rows)
            if service_health_service.settings.service_health_history_enabled:
                service_health_service.append_health_history_rows(
                    context.storage,
                    service_health_service.build_probe_history_rows(probed),
                )
            credential_service.append_audit_log(
                context.storage,
                "provider.service.force_probe",
                owner_wallet,
                {
                    "serviceId": service_record_id,
                    "runtimeAvailable": service_health_service.is_service_discoverable(probed),
                    "probeStatus": service_health_service.public_health_summary(probed).get("probeStatus"),
                },
            )
            return _owner_service_response(probed)
    return None
