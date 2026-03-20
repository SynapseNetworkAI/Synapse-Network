from typing import Dict, Any, List, Optional

from src.storage.base import BaseStorage
from src.core.redis_lock import RedisLockManager
from src.services.balance_mixins import (
    BalanceAuditMixin,
    BalanceRedisGuardMixin,
    BalanceWithdrawSigningMixin,
)
from src.services.owner.finance_service import OwnerFinanceService
from src.services.platform.finance_service import PlatformFinanceService
from src.services.provider.withdraw_service import ProviderWithdrawService


class BalanceService(
    BalanceAuditMixin, BalanceRedisGuardMixin, BalanceWithdrawSigningMixin
):
    """Financial safety service orchestrator with Redis-first idempotency/rate-limit/locks."""

    def __init__(self, storage: BaseStorage):
        self.storage = storage
        self._mutation_lock = RedisLockManager(
            redis_getter=self._get_redis_client,
            key_prefix="finance:mutation-lock",
            acquire_timeout_sec=5.0,
            poll_interval_sec=0.03,
        )
        self.owner_finance_service = OwnerFinanceService(
            storage=storage,
            mutation_lock=self._mutation_lock,
            guard_delegate=self,
        )
        self.platform_finance_service = PlatformFinanceService(
            storage=storage,
            mutation_lock=self._mutation_lock,
            guard_delegate=self,
        )
        self.provider_withdraw_service = ProviderWithdrawService(
            storage=storage,
            mutation_lock=self._mutation_lock,
            signing_delegate=self,
            guard_delegate=self,
        )

    def _normalize_rows(self, raw: Any) -> List[Dict[str, Any]]:
        if isinstance(raw, list):
            return [item for item in raw if isinstance(item, dict)]
        if isinstance(raw, dict) and isinstance(raw.get("rows"), list):
            return [item for item in raw["rows"] if isinstance(item, dict)]
        return []

    async def get_balance(self, owner_wallet: str) -> Dict[str, Any]:
        return await self.platform_finance_service.get_balance(owner_wallet)

    async def register_deposit_intent(
        self,
        intent: Dict[str, Any],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self.owner_finance_service.register_deposit_intent(
            intent=intent,
            owner_wallet=owner_wallet,
            idempotency_key=idempotency_key,
            request_meta=request_meta,
        )

    async def record_deposit_attempt(
        self,
        payload: Dict[str, Any],
        owner_wallet: str,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self.owner_finance_service.record_deposit_attempt(
            payload=payload,
            owner_wallet=owner_wallet,
            request_meta=request_meta,
        )

    async def list_deposit_intents(self, owner_wallet: str) -> list:
        return await self.owner_finance_service.list_deposit_intents(owner_wallet)

    async def get_deposit_sync_status(
        self, owner_wallet: str, tx_hash: str
    ) -> Dict[str, Any]:
        return await self.owner_finance_service.get_deposit_sync_status(
            owner_wallet, tx_hash
        )

    async def confirm_deposit_intent(
        self,
        *,
        owner_wallet: str,
        deposit_intent_id: str,
        event_key: str,
        confirmations: int,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self.owner_finance_service.confirm_deposit_intent(
            owner_wallet=owner_wallet,
            deposit_intent_id=deposit_intent_id,
            event_key=event_key,
            confirmations=confirmations,
            request_meta=request_meta,
        )

    async def process_refund_intent(
        self,
        payload: Dict[str, Any],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self.owner_finance_service.process_refund_intent(
            payload=payload,
            owner_wallet=owner_wallet,
            idempotency_key=idempotency_key,
            request_meta=request_meta,
        )

    async def list_refunds(self, owner_wallet: str) -> List[Dict[str, Any]]:
        return await self.owner_finance_service.list_refunds(owner_wallet)

    async def complete_refund_intent(
        self,
        owner_wallet: str,
        refund_id: str,
        tx_hash: str,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self.owner_finance_service.complete_refund_intent(
            owner_wallet=owner_wallet,
            refund_id=refund_id,
            tx_hash=tx_hash,
            request_meta=request_meta,
        )

    async def create_provider_withdraw_intent(
        self,
        payload: Dict[str, Any],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self.provider_withdraw_service.create_provider_withdraw_intent(
            payload=payload,
            owner_wallet=owner_wallet,
            idempotency_key=idempotency_key,
            request_meta=request_meta,
        )

    async def list_provider_withdrawals(
        self, owner_wallet: str
    ) -> List[Dict[str, Any]]:
        return await self.provider_withdraw_service.list_provider_withdrawals(
            owner_wallet
        )

    async def complete_provider_withdrawal(
        self,
        owner_wallet: str,
        withdrawal_id: str,
        tx_hash: str,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self.provider_withdraw_service.complete_provider_withdrawal(
            owner_wallet=owner_wallet,
            withdrawal_id=withdrawal_id,
            tx_hash=tx_hash,
            request_meta=request_meta,
        )

    async def review_provider_withdrawal(
        self,
        owner_wallet: str,
        withdrawal_id: str,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self.provider_withdraw_service.review_provider_withdrawal(
            owner_wallet=owner_wallet,
            withdrawal_id=withdrawal_id,
            request_meta=request_meta,
        )

    async def get_provider_withdraw_capability(
        self, owner_wallet: str
    ) -> Dict[str, Any]:
        _ = owner_wallet
        return self.provider_withdraw_capability()

    async def expire_stale_provider_withdrawals(self) -> int:
        return await self.provider_withdraw_service.expire_stale_provider_withdrawals()

    async def get_router_config(self, owner_wallet: str) -> Dict[str, Any]:
        return await self.platform_finance_service.get_router_config(owner_wallet)

    async def set_router_config(
        self,
        owner_wallet: str,
        daily_limit_usdc: float,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self.platform_finance_service.set_router_config(
            owner_wallet=owner_wallet,
            daily_limit_usdc=daily_limit_usdc,
            request_meta=request_meta,
        )
