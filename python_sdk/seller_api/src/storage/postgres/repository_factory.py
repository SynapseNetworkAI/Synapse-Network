from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, Sequence

from ..normalizers import normalize_service_row
from ..repository_provider import StorageRepositoryProvider
from .database_manager import DatabaseManager
from .repositories.audit_log_repository import AuditLogRepository
from .repositories.balance_repository import BalanceRepository
from .repositories.credential_auth_repository import CredentialAuthRepository
from .repositories.fee_policy_repository import FeePolicyRepository
from .repositories.finance_atomic_repository import FinanceAtomicRepository
from .repositories.gateway_state_repository import GatewayStateRepository
from .repositories.idempotency_repository import IdempotencyRepository
from .repositories.legacy_collection_repository import LegacyCollectionRepository
from .repositories.service_registry_repository import ServiceRegistryRepository


@dataclass(frozen=True)
class PostgresRepositorySet:
    provider: StorageRepositoryProvider
    finance_atomic: FinanceAtomicRepository
    legacy_collection: LegacyCollectionRepository
    audit: AuditLogRepository


def build_postgres_repository_set(
    db: DatabaseManager,
    *,
    quantize6: Callable[[Any], Any],
    balance_upsert_sql: str,
    balance_for_update_sql: str,
    audit_insert_sql: str,
    risk_restricted_statuses: Sequence[str],
) -> PostgresRepositorySet:
    fee_policy = FeePolicyRepository(db, quantize6)
    idempotency = IdempotencyRepository(db)
    audit = AuditLogRepository(db, audit_insert_sql)
    balance = BalanceRepository(db, quantize6, balance_upsert_sql)
    service_registry = ServiceRegistryRepository(db)
    credential_auth = CredentialAuthRepository(db, quantize6)
    gateway_state = GatewayStateRepository(db, quantize6)
    finance_atomic = FinanceAtomicRepository(
        db,
        quantize6,
        balance_upsert_sql,
        balance_for_update_sql,
        audit_insert_sql,
        tuple(risk_restricted_statuses),
    )
    legacy_collection = LegacyCollectionRepository(db, normalize_service_row, audit)

    provider = StorageRepositoryProvider(
        gateway_state=gateway_state,
        balance=balance,
        audit=audit,
        service_registry=service_registry,
        credential_auth=credential_auth,
        fee_policy=fee_policy,
        idempotency=idempotency,
    )
    return PostgresRepositorySet(
        provider=provider,
        finance_atomic=finance_atomic,
        legacy_collection=legacy_collection,
        audit=audit,
    )
