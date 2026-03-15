from __future__ import annotations

from dataclasses import dataclass
from typing import Any


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


@dataclass(frozen=True)
class SystemDomain:
    gateway_state: Any
    idempotency: Any
    registry: Any
    credential_auth: Any


@dataclass(frozen=True)
class AuditDomain:
    logs: Any


@dataclass(frozen=True)
class SynapseDataManager:
    uow: SynapseUnitOfWork
    finance: FinanceDomain
    system: SystemDomain
    audit: AuditDomain
