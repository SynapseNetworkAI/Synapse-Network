from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


# ---------------------------------------------------------------------------
# Domain facade dataclasses — 仓储层的领域导航容器
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SynapseUnitOfWork:
    db: Any

    def tx_cursor(self):
        return self.db.tx_cursor()

    def readonly_cursor(self):
        return self.db.readonly_cursor()


@dataclass(frozen=True)
class FinanceDomain:
    balance: Any
    atomic: Any
    fee_policy: Any
    business_policy: Any = None


@dataclass(frozen=True)
class SystemDomain:
    gateway_state: Any
    idempotency: Any
    registry: Any
    credential_auth: Any
    execution: Any = None
    in_app_notifications: Any = None


@dataclass(frozen=True)
class AuditDomain:
    logs: Any


@dataclass(frozen=True)
class SynapseDataManager:
    uow: SynapseUnitOfWork
    finance: FinanceDomain
    system: SystemDomain
    audit: AuditDomain


# ---------------------------------------------------------------------------
# Abstract storage interface
# ---------------------------------------------------------------------------


class BaseStorage(ABC):
    @abstractmethod
    def get_data_manager(self) -> SynapseDataManager:
        pass

    def close(self) -> None:
        """Release storage resources before process shutdown."""
        return None
