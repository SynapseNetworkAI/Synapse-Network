from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import cast

import pytest

from src.api.routers.services import RegisterServiceRequest
from src.domain.service_contract import ServiceDefinitionRecord
from src.services.platform import service_health_service
from src.services.provider.registry_service import RegistryService
from src.storage.base import BaseStorage


class InMemoryRegistryRepo:
    def __init__(self) -> None:
        self._rows: list[ServiceDefinitionRecord] = []
        self._health_history_rows: list[object] = []

    def read_service_registry_rows(self):
        return list(self._rows)

    def write_service_registry_rows(self, rows):
        self._rows = list(rows)

    def read_service_target_health_rows(self):
        return []

    def write_service_target_health_rows(self, rows):
        return list(rows)

    def read_service_target_health_history_rows(self):
        return list(self._health_history_rows)

    def write_service_target_health_history_rows(self, rows):
        self._health_history_rows = list(rows)


class InMemoryAuditRepo:
    def __init__(self) -> None:
        self.rows: list[object] = []

    def append_audit_row(self, row):
        self.rows.append(row)


class FakeStorage:
    def __init__(self) -> None:
        self.data_manager = SimpleNamespace(
            system=SimpleNamespace(
                registry=InMemoryRegistryRepo(),
            )
            ,
            audit=SimpleNamespace(
                logs=InMemoryAuditRepo(),
            )
        )

    def get_data_manager(self):
        return self.data_manager


def _service_payload(service_id: str | None) -> dict:
    return {
        "serviceId": service_id,
        "serviceName": "Famous Quotes Top 3",
        "pricing": "0.01",
        "summary": "Return the top 3 famous quotes.",
        "status": "active",
        "isActive": True,
        "healthCheck": {
            "path": "/health",
            "method": "GET",
            "timeoutMs": 3000,
            "successCodes": [200],
            "healthyThreshold": 2,
            "unhealthyThreshold": 3,
        },
        "constraints": {
            "timeoutMs": 15000,
            "maxResponseBytes": 4096,
            "maxRequestBytes": 4096,
            "maxQps": 100,
        },
        "invoke": {
            "method": "POST",
            "targets": [{"url": "https://quotes.test/invoke", "weight": 100}],
            "timeoutMs": 15000,
            "request": {
                "contentType": "application/json",
                "schema": {"body": {"type": "object"}},
            },
            "response": {
                "contentType": "application/json",
                "schema": {"body": {"type": "object"}},
            },
        },
    }


def test_register_service_request_maps_agent_tool_name_to_service_id() -> None:
    request = RegisterServiceRequest.model_validate(
        {
            **_service_payload(None),
            "agentToolName": "famous_quotes_top3",
        }
    )

    assert request.serviceId == "famous_quotes_top3"
    assert request.model_dump()["serviceId"] == "famous_quotes_top3"


def test_registry_service_rejects_duplicate_service_id(monkeypatch) -> None:
    storage = FakeStorage()
    service = RegistryService(cast(BaseStorage, storage))

    async def _no_probe(payload):
        await asyncio.sleep(0)
        return payload

    monkeypatch.setattr(service_health_service, "probe_service_health", _no_probe)
    monkeypatch.setattr(
        service_health_service,
        "sync_service_target_health_table",
        lambda storage_ref, rows: rows,
    )

    asyncio.run(service.register_service(_service_payload("famous_quotes_top3"), "0xabc"))

    with pytest.raises(ValueError, match="already exists"):
        asyncio.run(service.register_service(_service_payload("famous_quotes_top3"), "0xdef"))


def test_delete_service_requires_inactive_state(monkeypatch) -> None:
    storage = FakeStorage()
    service = RegistryService(cast(BaseStorage, storage))

    async def _no_probe(payload):
        await asyncio.sleep(0)
        return payload

    monkeypatch.setattr(service_health_service, "probe_service_health", _no_probe)
    monkeypatch.setattr(
        service_health_service,
        "sync_service_target_health_table",
        lambda storage_ref, rows: rows,
    )

    asyncio.run(service.register_service(_service_payload("famous_quotes_top3"), "0xabc"))

    with pytest.raises(ValueError, match="SERVICE_DELETE_ACTIVE_CONFLICT"):
        asyncio.run(service.delete_service("famous_quotes_top3", "0xabc"))


def test_delete_service_marks_deleted_and_hides_from_owner_list(monkeypatch) -> None:
    storage = FakeStorage()
    service = RegistryService(cast(BaseStorage, storage))

    async def _no_probe(payload):
        await asyncio.sleep(0)
        return payload

    monkeypatch.setattr(service_health_service, "probe_service_health", _no_probe)
    monkeypatch.setattr(
        service_health_service,
        "sync_service_target_health_table",
        lambda storage_ref, rows: rows,
    )

    asyncio.run(service.register_service(_service_payload("famous_quotes_top3"), "0xabc"))
    asyncio.run(
        service.update_service(
            "famous_quotes_top3",
            {"status": "inactive", "isActive": False},
            "0xabc",
        )
    )

    deleted = asyncio.run(service.delete_service("famous_quotes_top3", "0xabc"))
    owner_rows = asyncio.run(service.list_owner_services("0xabc"))
    persisted_rows = storage.get_data_manager().system.registry.read_service_registry_rows()

    assert deleted is True
    assert owner_rows == []
    assert len(persisted_rows) == 1
    assert persisted_rows[0].status == "deleted"
    assert persisted_rows[0].is_active is False
    assert storage.get_data_manager().audit.logs.rows[-1].action == "provider.service.deleted"


def test_deleted_service_cannot_be_updated(monkeypatch) -> None:
    storage = FakeStorage()
    service = RegistryService(cast(BaseStorage, storage))

    async def _no_probe(payload):
        await asyncio.sleep(0)
        return payload

    monkeypatch.setattr(service_health_service, "probe_service_health", _no_probe)
    monkeypatch.setattr(
        service_health_service,
        "sync_service_target_health_table",
        lambda storage_ref, rows: rows,
    )

    asyncio.run(service.register_service(_service_payload("famous_quotes_top3"), "0xabc"))
    asyncio.run(
        service.update_service(
            "famous_quotes_top3",
            {"status": "inactive", "isActive": False},
            "0xabc",
        )
    )
    asyncio.run(service.delete_service("famous_quotes_top3", "0xabc"))

    with pytest.raises(ValueError, match="SERVICE_ALREADY_DELETED"):
        asyncio.run(
            service.update_service(
                "famous_quotes_top3",
                {"serviceName": "Renamed"},
                "0xabc",
            )
        )
