from __future__ import annotations

import asyncio
from typing import Any

from src.storage.base import BaseStorage
from src.domain.registry import ServiceTargetHealthHistory
from src.domain.service_contract import (
    AgentDiscoveryQueryRecord,
    PublicServiceDiscoveryRecord,
    ServiceDefinitionRecord,
)
from .registry import (
    count_agent_discovery_results as count_agent_discovery_results_op,
    delete_service as delete_service_op,
    discover_public_services as discover_public_services_op,
    discover_services as discover_services_op,
    has_owner_service as has_owner_service_op,
    health_status as health_status_op,
    list_owner_services as list_owner_services_op,
    public_network_stats as public_network_stats_op,
    register_service as register_service_op,
    search_agent_discovery as search_agent_discovery_op,
    service_health_history as service_health_history_op,
    update_service as update_service_op,
)
from .registry.discovery_helpers import hydrate_service_runtime_health

SERVICE_DELETE_ACTIVE_CONFLICT = "SERVICE_DELETE_ACTIVE_CONFLICT"
SERVICE_ALREADY_DELETED = "SERVICE_ALREADY_DELETED"


class RegistryService:
    def __init__(self, storage: BaseStorage):
        self.storage = storage
        self._lock: asyncio.Lock | None = None

    def _registry_lock(self) -> asyncio.Lock:
        if self._lock is None:
            asyncio.get_running_loop()
            self._lock = asyncio.Lock()
        return self._lock

    def _load_service_registry_rows(self) -> list[ServiceDefinitionRecord]:
        raw_rows = (
            self.storage.get_data_manager().system.registry.read_service_registry_rows()
        )
        health_rows = self.storage.get_data_manager().system.registry.read_service_target_health_rows()
        return hydrate_service_runtime_health(health_rows, raw_rows)

    def _save_service_registry_rows(self, rows: list[ServiceDefinitionRecord]) -> None:
        self.storage.get_data_manager().system.registry.write_service_registry_rows(rows)

    def _load_service_target_health_history_rows(
        self,
    ) -> list[ServiceTargetHealthHistory]:
        return list(
            self.storage.get_data_manager().system.registry.read_service_target_health_history_rows()
        )

    async def register_service(
        self, req_data: dict[str, Any], owner_wallet: str
    ) -> dict[str, Any]:
        return await register_service_op(self, req_data, owner_wallet)

    async def update_service(
        self, service_record_id: str, req_data: dict[str, Any], owner_wallet: str
    ) -> dict[str, Any] | None:
        return await update_service_op(self, service_record_id, req_data, owner_wallet)

    async def delete_service(self, service_record_id: str, owner_wallet: str) -> bool:
        return await delete_service_op(self, service_record_id, owner_wallet)

    async def has_owner_service(
        self, service_record_id: str, owner_wallet: str
    ) -> bool:
        return await has_owner_service_op(self, service_record_id, owner_wallet)

    async def discover_public_services(
        self,
        intent: str | None = None,
        public_gateway_url: str | None = None,
        sort_by: str = "best_match",
        sort_order: str = "desc",
    ) -> list[PublicServiceDiscoveryRecord]:
        return await discover_public_services_op(
            self,
            intent=intent,
            public_gateway_url=public_gateway_url,
            sort_by=sort_by,
            sort_order=sort_order,
        )

    async def discover_services(
        self,
        intent: str | None = None,
        public_gateway_url: str | None = None,
        sort_by: str = "best_match",
        sort_order: str = "desc",
    ) -> list[dict[str, Any]]:
        return await discover_services_op(
            self,
            intent=intent,
            public_gateway_url=public_gateway_url,
            sort_by=sort_by,
            sort_order=sort_order,
        )

    async def public_network_stats(self) -> dict[str, Any]:
        return await public_network_stats_op(self)

    async def search_agent_discovery(
        self,
        query: AgentDiscoveryQueryRecord,
        public_gateway_url: str | None = None,
    ) -> list[PublicServiceDiscoveryRecord]:
        return await search_agent_discovery_op(
            self,
            query,
            public_gateway_url=public_gateway_url,
        )

    async def count_agent_discovery_results(
        self,
        query: AgentDiscoveryQueryRecord,
    ) -> int:
        return await count_agent_discovery_results_op(self, query)

    async def list_owner_services(self, owner_wallet: str) -> list[dict[str, Any]]:
        return await list_owner_services_op(self, owner_wallet)

    async def health_status(
        self, intent: str | None = None, include_inactive: bool = False
    ) -> list[dict[str, Any]]:
        return await health_status_op(
            self,
            intent=intent,
            include_inactive=include_inactive,
        )

    async def service_health_history(
        self,
        service_record_id: str,
        owner_wallet: str,
        limit_per_target: int,
        hours: int | None = None,
        days: int | None = None,
    ) -> dict[str, Any]:
        return await service_health_history_op(
            self,
            service_record_id,
            owner_wallet,
            limit_per_target,
            hours=hours,
            days=days,
        )
