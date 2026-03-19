from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any, cast

from src.domain.finance import UsageLogRow
from src.domain.registry import ServiceTargetHealthHistory
from src.domain.service_contract import ServiceDefinitionRecord, ServiceRuntimeHealthRecord
from src.storage.base import BaseStorage


class InMemoryRegistryRepo:
    def __init__(self, rows: list[ServiceDefinitionRecord] | None = None) -> None:
        self.rows = list(rows or [])

    def read_service_registry_rows(self):
        return list(self.rows)

    def write_service_registry_rows(self, rows):
        self.rows = list(rows)


class InMemoryGatewayStateRepo:
    def __init__(self, rows: list[UsageLogRow] | None = None) -> None:
        self.rows = list(rows or [])

    def read_invocation_billing_rows(self):
        return list(self.rows)


class InMemoryAuditRepo:
    def __init__(self) -> None:
        self.rows: list[object] = []

    def append_audit_row(self, row) -> None:
        self.rows.append(row)


class FakeStorage:
    def __init__(
        self,
        services: list[ServiceDefinitionRecord] | None = None,
        usage_rows: list[UsageLogRow] | None = None,
    ) -> None:
        self.data_manager = SimpleNamespace(
            system=SimpleNamespace(
                registry=InMemoryRegistryRepo(services),
                gateway_state=InMemoryGatewayStateRepo(usage_rows),
            ),
            audit=SimpleNamespace(logs=InMemoryAuditRepo()),
        )

    def get_data_manager(self):
        return self.data_manager


class FakeRegistryContext:
    def __init__(
        self,
        services: list[ServiceDefinitionRecord] | None = None,
        usage_rows: list[UsageLogRow] | None = None,
        history_rows: list[Any] | None = None,
    ) -> None:
        self.storage = cast(BaseStorage, FakeStorage(services, usage_rows))
        self.history_rows = history_rows
        self._lock = asyncio.Lock()

    def _registry_lock(self) -> asyncio.Lock:
        return self._lock

    def _load_service_registry_rows(self):
        return self.storage.get_data_manager().system.registry.read_service_registry_rows()

    def _save_service_registry_rows(self, rows) -> None:
        self.storage.get_data_manager().system.registry.write_service_registry_rows(rows)

    def _load_service_target_health_history_rows(self) -> list[ServiceTargetHealthHistory]:
        return cast(list[ServiceTargetHealthHistory], self.history_rows)


def service_payload(
    service_id: str | None,
    *,
    service_name: str = "Famous Quotes Top 3",
    summary: str = "Return the top 3 famous quotes.",
    tags: list[str] | None = None,
    pricing: str = "0.01",
    status: str = "active",
    is_active: bool = True,
    target_url: str = "https://quotes.test/invoke",
) -> dict[str, Any]:
    return {
        "serviceId": service_id,
        "serviceName": service_name,
        "pricing": pricing,
        "summary": summary,
        "tags": list(tags or ["quotes", "inspiration"]),
        "status": status,
        "isActive": is_active,
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
            "targets": [{"url": target_url, "weight": 100}],
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


def service_definition(
    service_id: str,
    *,
    owner_address: str = "0xprovider",
    service_name: str = "Famous Quotes Top 3",
    summary: str = "Return the top 3 famous quotes.",
    tags: list[str] | None = None,
    pricing_amount: str = "0.01",
    status: str = "active",
    is_active: bool = True,
    target_url: str | None = None,
    created_at: str = "",
    updated_at: str = "",
    row_id: str | None = None,
    runtime_health: ServiceRuntimeHealthRecord | None = None,
) -> ServiceDefinitionRecord:
    payload = service_payload(
        service_id,
        service_name=service_name,
        summary=summary,
        tags=tags,
        pricing=pricing_amount,
        status=status,
        is_active=is_active,
        target_url=target_url or f"https://{service_id}.test/invoke",
    )
    payload.update(
        {
            "ownerAddress": owner_address,
            "pricingAmount": pricing_amount,
            "pricingCurrency": "USDC",
        }
    )
    if created_at:
        payload["createdAt"] = created_at
    if updated_at:
        payload["updatedAt"] = updated_at
    if row_id is not None:
        payload["id"] = row_id
    if runtime_health is not None:
        payload["serviceHealth"] = runtime_health.model_dump(by_alias=True)
    return ServiceDefinitionRecord.model_validate(payload)