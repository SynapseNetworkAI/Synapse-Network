from __future__ import annotations

import asyncio
from typing import Any

import pytest

from src.domain.service_contract import ServiceDefinitionRecord, ServiceRuntimeHealthRecord
from src.services.provider.registry.registration import (
    delete_service,
    has_owner_service,
    register_service,
    update_service,
)
from tests.unit.registry_test_helper import (
    FakeRegistryContext,
    service_definition,
)


@pytest.mark.asyncio
async def test_register_service_generates_service_id_and_persists_runtime_health(monkeypatch) -> None:
    context = FakeRegistryContext()
    sync_calls: list[list[ServiceDefinitionRecord]] = []
    normalized = service_definition("svc.template", row_id="row-svc.template").model_copy(
        update={
            "service_id": "",
            "id": None,
            "created_at": "",
            "updated_at": "",
        }
    )

    async def _healthy_probe(payload: ServiceDefinitionRecord) -> ServiceDefinitionRecord:
        await asyncio.sleep(0)
        return payload.model_copy(
            update={
                "runtime_health": ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=1710000000000,
                )
            }
        )

    monkeypatch.setattr(
        "src.services.provider.registry.registration.now_dt_str",
        lambda: "2026-03-20 12:00:00",
    )
    monkeypatch.setattr(
        "src.services.provider.registry.registration.normalize_service_payload",
        lambda req_data, owner_wallet: normalized.model_copy(),
    )
    monkeypatch.setattr(
        "src.services.provider.registry.registration.service_health_service.probe_service_health",
        _healthy_probe,
    )
    monkeypatch.setattr(
        "src.services.provider.registry.registration.service_health_service.sync_service_target_health_table",
        lambda storage, rows: sync_calls.append(list(rows)),
    )

    created = await register_service(context, {}, "0xabc")
    stored_rows = context._load_service_registry_rows()

    assert created["serviceId"].startswith("SVC_")
    assert len(stored_rows) == 1
    assert stored_rows[0].created_at == "2026-03-20 12:00:00"
    assert stored_rows[0].updated_at == "2026-03-20 12:00:00"
    assert stored_rows[0].runtime_health is not None
    assert stored_rows[0].runtime_health.overall_status == "healthy"
    assert len(sync_calls) == 1
    assert sync_calls[0][0].service_id == created["serviceId"]


@pytest.mark.asyncio
async def test_update_service_preserves_immutable_fields(monkeypatch) -> None:
    context = FakeRegistryContext(
        [
            service_definition(
                "svc.quotes",
                owner_address="0xabc",
                row_id="row-svc.quotes",
                created_at="2026-03-20 10:00:00",
                updated_at="2026-03-20 10:00:00",
            )
        ]
    )

    async def _no_probe(payload: ServiceDefinitionRecord) -> ServiceDefinitionRecord:
        await asyncio.sleep(0)
        return payload

    monkeypatch.setattr(
        "src.services.provider.registry.registration.now_dt_str",
        lambda: "2026-03-20 12:30:00",
    )
    monkeypatch.setattr(
        "src.services.provider.registry.registration.service_health_service.probe_service_health",
        _no_probe,
    )
    monkeypatch.setattr(
        "src.services.provider.registry.registration.service_health_service.sync_service_target_health_table",
        lambda storage, rows: None,
    )

    updated = await update_service(
        context,
        "svc.quotes",
        {
            "serviceId": "svc.hijacked",
            "ownerAddress": "0xdef",
            "createdAt": "2099-01-01 00:00:00",
            "schemaVersion": 999,
            "serviceName": "Renamed Quotes",
        },
        "0xabc",
    )

    assert updated is not None
    assert updated["serviceId"] == "svc.quotes"
    assert updated["ownerAddress"] == "0xabc"
    assert updated["createdAt"] == "2026-03-20 10:00:00"
    assert updated["serviceName"] == "Renamed Quotes"
    assert updated["updatedAt"] == "2026-03-20 12:30:00"
    assert updated["id"] == "row-svc.quotes"


@pytest.mark.asyncio
async def test_delete_service_marks_deleted_and_appends_audit(monkeypatch) -> None:
    context = FakeRegistryContext(
        [
            service_definition(
                "svc.quotes",
                owner_address="0xabc",
                status="inactive",
                is_active=False,
                row_id="row-svc.quotes",
            )
        ]
    )
    audit_calls: list[dict[str, Any]] = []

    monkeypatch.setattr(
        "src.services.provider.registry.registration.now_dt_str",
        lambda: "2026-03-20 13:00:00",
    )
    monkeypatch.setattr(
        "src.services.provider.registry.registration.service_health_service.sync_service_target_health_table",
        lambda storage, rows: None,
    )
    monkeypatch.setattr(
        "src.services.provider.registry.registration.credential_service.append_audit_log",
        lambda storage, action, owner_wallet, details: audit_calls.append(
            {
                "action": action,
                "owner": owner_wallet,
                "details": dict(details),
            }
        ),
    )

    deleted = await delete_service(context, "svc.quotes", "0xabc")
    stored_rows = context._load_service_registry_rows()

    assert deleted is True
    assert stored_rows[0].status == "archived"
    assert stored_rows[0].is_active is False
    assert stored_rows[0].updated_at == "2026-03-20 13:00:00"
    assert audit_calls == [
        {
            "action": "provider.service.deleted",
            "owner": "0xabc",
            "details": {
                "serviceId": "svc.quotes",
                "serviceName": "Famous Quotes Top 3",
                "status": "deleted",
                "deletedAt": "2026-03-20 13:00:00",
            },
        }
    ]


@pytest.mark.asyncio
async def test_has_owner_service_skips_deleted_rows() -> None:
    context = FakeRegistryContext(
        [
            service_definition("svc.active", owner_address="0xabc", row_id="row-svc.active"),
            service_definition(
                "svc.deleted",
                owner_address="0xabc",
                status="deleted",
                is_active=False,
                row_id="row-svc.deleted",
            ),
        ]
    )

    assert await has_owner_service(context, "svc.active", "0xabc") is True
    assert await has_owner_service(context, "svc.deleted", "0xabc") is False
    assert await has_owner_service(context, "svc.active", "0xdef") is False