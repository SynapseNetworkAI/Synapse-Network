from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, Protocol

from src.storage.base import BaseStorage
from src.domain.registry import ServiceTargetHealthHistory
from src.domain.service_contract import ServiceDefinitionRecord


class RegistryContext(Protocol):
    storage: BaseStorage

    def _registry_lock(self) -> asyncio.Lock: ...

    def _load_service_registry_rows(self) -> List[ServiceDefinitionRecord]: ...

    def _save_service_registry_rows(self, rows: List[ServiceDefinitionRecord]) -> None: ...

    def _load_service_target_health_history_rows(
        self,
    ) -> List[ServiceTargetHealthHistory]: ...


JsonDict = Dict[str, Any]
JsonList = List[JsonDict]
MaybeString = Optional[str]