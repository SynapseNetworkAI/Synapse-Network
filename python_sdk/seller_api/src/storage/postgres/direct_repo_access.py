from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from src.storage.base import BaseStorage
from src.storage.postgres_impl import PostgresStorage
from src.storage.repository_provider import (
    FeePolicyRepositoryProtocol,
    GatewayStateRepositoryProtocol,
    fee_policy_repo,
    gateway_state_repo,
)

from .repositories.fee_policy_repository import FeePolicyRepository
from .repositories.gateway_state_repository import GatewayStateRepository


def _q6(value: Any) -> Decimal:
    try:
        return Decimal(str(value)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    except Exception:
        return Decimal("0")


def direct_fee_policy_repo(storage: BaseStorage) -> FeePolicyRepositoryProtocol:
    # Step-2 punch-through: in postgres runtime build concrete repository directly.
    if isinstance(storage, PostgresStorage):
        return FeePolicyRepository(storage.get_database_manager(), _q6)
    # Fallback for tests/non-postgres backends.
    return fee_policy_repo(storage)


def direct_gateway_state_repo(storage: BaseStorage) -> GatewayStateRepositoryProtocol:
    # Step-2 punch-through: in postgres runtime build concrete repository directly.
    if isinstance(storage, PostgresStorage):
        return GatewayStateRepository(storage.get_database_manager(), _q6)
    # Fallback for tests/non-postgres backends.
    return gateway_state_repo(storage)
