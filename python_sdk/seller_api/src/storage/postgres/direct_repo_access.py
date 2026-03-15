from __future__ import annotations

from typing import Any

from src.storage.base import BaseStorage
def direct_fee_policy_repo(storage: BaseStorage) -> Any:
    return storage.get_data_manager().finance.fee_policy


def direct_gateway_state_repo(storage: BaseStorage) -> Any:
    return storage.get_data_manager().system.gateway_state
