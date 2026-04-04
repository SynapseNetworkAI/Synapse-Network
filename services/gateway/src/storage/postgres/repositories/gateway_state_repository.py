"""Gateway state repository — thin composer class."""
from __future__ import annotations

from typing import Any, Callable

from ..database_manager import DatabaseManager
from .gateway_state_core_mixin import GatewayStateCoreMixin
from .gateway_state_refund_mixin import GatewayStateRefundMixin
from .gateway_state_withdrawal_mixin import GatewayStateWithdrawalMixin


class GatewayStateRepository(
    GatewayStateCoreMixin,
    GatewayStateRefundMixin,
    GatewayStateWithdrawalMixin,
):
    """Postgres-backed gateway state repository."""

    def __init__(self, db: DatabaseManager, quantize6: Callable[[Any], Any]):
        self._db = db
        self._q6 = quantize6
