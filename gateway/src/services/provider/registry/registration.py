from __future__ import annotations

import asyncio
import uuid
from typing import Any, Dict, Optional

from src.services.platform import credential_service, service_health_service
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


def _masked_payout_address(value: str | None) -> str | None:
    normalized = str(value or "").strip()
    if len(normalized) <= 8:
        return normalized or None
    return f"{normalized[:6]}...{normalized[-4:]}"


def _audit_details(service_payload: Dict[str, Any]) -> Dict[str, Any]:
    payout_account = service_payload.get("payoutAccount")
    provider_profile = service_payload.get("providerProfile")
    governance = service_payload.get("governance")
    auth_payload = service_payload.get("auth")
    details: Dict[str, Any] = {
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
    context: RegistryContext, req_data: Dict[str, Any], owner_wallet: str
) -> Dict[str, Any]:
    async with context._registry_lock():
        rows = context._load_service_registry_rows()
        new_svc = normalize_service_payload(req_data, owner_wallet)
        if not new_svc.service_id:
            new_svc = new_svc.model_copy(
                update={"service_id": generate_service_id(owner_wallet)}
            )
        ensure_unique_service_id(rows, str(new_svc.service_id or ""))
        new_svc = bind_forwarding_service_id(new_svc)
        created_at = now_dt_str()
        new_svc = new_svc.model_copy(
            update={
                "id": str(new_svc.id or uuid.uuid4()),
                "created_at": created_at,
                "updated_at": created_at,
            }
        )
        new_svc = await service_health_service.probe_service_health(new_svc)

        rows.append(new_svc)
        context._save_service_registry_rows(rows)
        service_health_service.sync_service_target_health_table(context.storage, rows)
        response = new_svc.model_dump(by_alias=True, mode="json")
        credential_service.append_audit_log(
            context.storage,
            "provider.service.registered",
            owner_wallet,
            _audit_details(response),
        )
        return response


async def update_service(
    context: RegistryContext,
    service_record_id: str,
    req_data: Dict[str, Any],
    owner_wallet: str,
) -> Optional[Dict[str, Any]]:
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
            updated = await service_health_service.probe_service_health(updated)
            rows[index] = updated
            context._save_service_registry_rows(rows)
            service_health_service.sync_service_target_health_table(
                context.storage, rows
            )
            response = updated.model_dump(by_alias=True, mode="json")
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
