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

    def read_service_registry_rows(self):
        return list(self._rows)

    def write_service_registry_rows(self, rows):
        self._rows = list(rows)

    def read_service_target_health_rows(self):
        return []


class FakeStorage:
    def __init__(self) -> None:
        self.data_manager = SimpleNamespace(
            system=SimpleNamespace(
                registry=InMemoryRegistryRepo(),
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
