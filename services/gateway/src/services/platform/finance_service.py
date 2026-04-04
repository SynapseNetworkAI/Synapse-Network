from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, timezone
import hashlib
from typing import Any, List, Optional
import asyncio
import time
from uuid import uuid4

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.redis_lock import RedisLockManager
from src.domain.gateway import OwnerSpendLimitRow
from src.domain.voucher import VoucherRedeemCommand, VoucherRedemptionResult
from src.services.balance_mixins import BalanceAuditMixin, BalanceRedisGuardMixin
from src.storage.base import BaseStorage
from src.utils.datetime_utils import now_dt_str


class PlatformFinanceService(BalanceAuditMixin, BalanceRedisGuardMixin):
    """Platform-side balance read and router config domain service."""

    def __init__(
        self,
        storage: BaseStorage,
        mutation_lock: RedisLockManager,
        guard_delegate: Optional[BalanceRedisGuardMixin] = None,
    ):
        self.storage = storage
        self._mutation_lock = mutation_lock
        self._guard_delegate = guard_delegate

    async def _get_redis_client(self):
        if self._guard_delegate is not None:
            return await self._guard_delegate._get_redis_client()  # type: ignore[attr-defined]
        return await super()._get_redis_client()

    def _normalize_rows(self, raw: Any) -> List[dict[str, Any]]:
        if isinstance(raw, list):
            return [item for item in raw if isinstance(item, dict)]
        if isinstance(raw, dict) and isinstance(raw.get("rows"), list):
            return [item for item in raw["rows"] if isinstance(item, dict)]
        return []

    @staticmethod
    def _q6(value: Decimal | str | int | float) -> Decimal:
        return Decimal(str(value)).quantize(
            Decimal("0.000001"), rounding=ROUND_HALF_UP
        )

    @staticmethod
    def _normalize_voucher_code(value: str) -> str:
        compact = "".join(ch for ch in str(value or "").strip().upper() if ch.isalnum())
        if len(compact) != 12 or not compact.isalnum():
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_VOUCHER_CODE",
                    "message": "voucherCode must contain exactly 12 alphanumeric characters.",
                },
            )
        return compact

    @staticmethod
    def _hash_voucher_code(normalized_code: str) -> str:
        return hashlib.sha256(normalized_code.encode("utf-8")).hexdigest()

    @staticmethod
    def _voucher_error(code: str) -> tuple[int, str]:
        mapping = {
            "INVALID_VOUCHER_CODE": (404, "Voucher code not found."),
            "VOUCHER_ALREADY_REDEEMED": (409, "This voucher has already been redeemed."),
            "VOUCHER_EXPIRED": (409, "This voucher has expired."),
            "VOUCHER_CAMPAIGN_INACTIVE": (409, "This voucher campaign is not currently active."),
            "VOUCHER_CAMPAIGN_BUDGET_UNDEFINED": (409, "This voucher campaign is not ready for redemption."),
            "VOUCHER_CAMPAIGN_EXHAUSTED": (409, "This voucher campaign has no credits remaining."),
            "OWNER_NOT_ELIGIBLE": (403, "This wallet is not eligible to redeem this voucher."),
            "OWNER_REDEMPTION_LIMIT_EXCEEDED": (
                409,
                "This wallet has already reached the redemption limit for this voucher campaign.",
            ),
            "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD": (
                409,
                "Idempotency key payload mismatch.",
            ),
        }
        return mapping.get(
            code,
            (500, "Voucher redemption failed due to an unexpected gateway error."),
        )

    @staticmethod
    def _billing_cycle_start(now_ts: Optional[int] = None) -> int:
        now_dt = datetime.fromtimestamp(now_ts or int(time.time()), tz=timezone.utc)
        cycle_start = datetime(
            year=now_dt.year,
            month=now_dt.month,
            day=1,
            tzinfo=timezone.utc,
        )
        return int(cycle_start.timestamp())

    @staticmethod
    def _is_billable_usage_status(status: Any) -> bool:
        normalized = str(status or "").strip().lower()
        return normalized in {"accepted", "succeeded"}

    def _current_cycle_spend_usdc(self, owner_wallet: str) -> Decimal:
        owner = normalize_wallet(owner_wallet)
        cycle_start = self._billing_cycle_start()
        rows = self.storage.get_data_manager().system.gateway_state.read_invocation_billing_rows()
        current_spend = Decimal("0")
        for row in rows:
            row_owner = normalize_wallet(str(row.consumer_address or ""))
            if row_owner != owner:
                continue
            if int(row.ts or 0) < cycle_start:
                continue
            if not self._is_billable_usage_status(row.status):
                continue
            charge = row.total_charge if row.total_charge is not None else row.unit_price
            if charge is None:
                continue
            current_spend += Decimal(str(charge))
        return self._q6(current_spend)

    def _find_owner_spend_limit_row(
        self, owner_wallet: str
    ) -> Optional[OwnerSpendLimitRow]:
        owner = normalize_wallet(owner_wallet)
        rows = self.storage.get_data_manager().system.gateway_state.read_owner_spend_limit_rows()
        return next(
            (
                row
                for row in rows
                if normalize_wallet(row.owner_address or "") == owner
            ),
            None,
        )

    async def get_balance(self, owner_wallet: str) -> dict[str, Any]:
        """Only return current authenticated owner's balance summary."""
        await asyncio.sleep(0)
        normalized_owner = normalize_wallet(owner_wallet)
        balance_data = (
            self.storage.get_data_manager().finance.balance.read_balance_ledger()
        )

        return {
            "ownerAddress": normalized_owner,
            "ownerBalance": balance_data.consumer_available_balance(normalized_owner),
            "consumerAvailableBalance": balance_data.consumer_available_balance(normalized_owner),
            "consumerPendingBalance": balance_data.consumer_pending_balance(normalized_owner),
            "consumerFrozenBalance": balance_data.consumer_frozen_balance(normalized_owner),
            "providerReceivable": balance_data.provider_receivable_balance(normalized_owner),
            "providerReceivableBalance": balance_data.provider_receivable_balance(normalized_owner),
            "providerLockedBalance": balance_data.provider_locked_balance(normalized_owner),
            "platformFeeAccrued": round(balance_data.platform.fee_accrued, 6),
            "updatedAt": balance_data.updated_at,
        }

    async def get_owner_spending_limit(self, owner_wallet: str) -> dict[str, Any]:
        await asyncio.sleep(0)
        owner = normalize_wallet(owner_wallet)
        found = self._find_owner_spend_limit_row(owner)
        spending_limit = (
            self._q6(found.spending_limit_usdc)
            if found is not None and found.spending_limit_usdc is not None
            else None
        )
        current_cycle_spend = self._current_cycle_spend_usdc(owner)
        remaining = (
            self._q6(max(Decimal("0"), spending_limit - current_cycle_spend))
            if spending_limit is not None
            else None
        )

        return {
            "ownerAddress": owner,
            "spendingLimitUsdc": float(spending_limit) if spending_limit is not None else None,
            "allowUnlimited": spending_limit is None,
            "cycleInterval": "monthly",
            "currentCycleSpendUsdc": float(current_cycle_spend),
            "remainingSpendUsdc": float(remaining) if remaining is not None else None,
            "updatedAt": found.updated_at if found is not None else None,
        }

    async def set_owner_spending_limit(
        self,
        owner_wallet: str,
        *,
        spending_limit_usdc: Optional[Decimal],
        allow_unlimited: bool,
        request_meta: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:owner_spend_limit"):
            await self._enforce_owner_write_rate_limit(owner, "owner_spend_limit")

            normalized_limit = None
            if not allow_unlimited:
                if spending_limit_usdc is None:
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "code": "INVALID_SPENDING_LIMIT",
                            "message": "spendingLimitUsdc is required unless allowUnlimited is true.",
                        },
                    )
                normalized_limit = self._q6(spending_limit_usdc)
                if normalized_limit <= Decimal("0"):
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "code": "INVALID_SPENDING_LIMIT",
                            "message": "spendingLimitUsdc must be positive.",
                        },
                    )

            now_text = now_dt_str()
            rows = self.storage.get_data_manager().system.gateway_state.read_owner_spend_limit_rows()
            existing = next(
                (
                    row
                    for row in rows
                    if normalize_wallet(row.owner_address or "") == owner
                ),
                None,
            )
            if existing is None:
                existing = OwnerSpendLimitRow(
                    id=str(uuid4()),
                    ownerAddress=owner,
                    spendingLimitUsdc=normalized_limit,
                    cycleInterval="monthly",
                    createdAt=now_text,
                    updatedAt=now_text,
                )
                rows.append(existing)
            else:
                existing.spending_limit_usdc = normalized_limit
                existing.cycle_interval = "monthly"
                existing.updated_at = now_text

            self.storage.get_data_manager().system.gateway_state.write_owner_spend_limit_rows(
                rows,
                now_text,
            )
            self._append_financial_audit(
                "OWNER_SPEND_LIMIT_UPDATED",
                owner,
                {
                    "allowUnlimited": allow_unlimited,
                    "spendingLimitUsdc": float(normalized_limit) if normalized_limit is not None else None,
                    "cycleInterval": "monthly",
                    "requestMeta": request_meta or {},
                },
            )
            return await self.get_owner_spending_limit(owner)

    async def redeem_credit_voucher(
        self,
        *,
        owner_wallet: str,
        voucher_code: str,
        idempotency_key: str,
        request_meta: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        owner = normalize_wallet(owner_wallet)
        normalized_code = self._normalize_voucher_code(voucher_code)
        request_id = str((request_meta or {}).get("requestId") or "").strip() or None
        client_ip = str((request_meta or {}).get("clientIp") or "").strip() or None
        user_agent = str((request_meta or {}).get("userAgent") or "").strip() or None
        validated_idempotency_key = self._validate_idempotency_key(idempotency_key)
        request_hash = self._request_hash(
            {
                "ownerAddress": owner,
                "voucherCode": normalized_code,
            }
        )

        redis_client = await self._get_redis_client()
        if redis_client is not None:
            retry = await self._check_idempotency_redis(
                scope="voucher_redeem",
                owner_wallet=owner,
                idempotency_key=validated_idempotency_key,
                request_hash=request_hash,
            )
            if retry is not None:
                return retry
            claimed = await self._start_idempotency_redis(
                scope="voucher_redeem",
                owner_wallet=owner,
                idempotency_key=validated_idempotency_key,
                request_hash=request_hash,
            )
            if not claimed:
                retry = await self._check_idempotency_redis(
                    scope="voucher_redeem",
                    owner_wallet=owner,
                    idempotency_key=validated_idempotency_key,
                    request_hash=request_hash,
                )
                if retry is not None:
                    return retry
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "IDEMPOTENCY_REQUEST_IN_PROGRESS",
                        "message": "A request with this idempotency key is already processing.",
                    },
                )

        async with self._mutation_lock.lock(f"{owner}:voucher_redeem"):
            await self._enforce_owner_write_rate_limit(owner, "voucher_redeem")

            if not hasattr(self.storage, "redeem_credit_voucher_atomic"):
                raise HTTPException(
                    status_code=503,
                    detail={
                        "code": "VOUCHER_REDEEM_STORAGE_UNAVAILABLE",
                        "message": "Voucher redemption requires PostgreSQL storage support.",
                    },
                )

            try:
                redemption = getattr(self.storage, "redeem_credit_voucher_atomic")(
                    VoucherRedeemCommand(
                        ownerAddress=owner,
                        voucherCode=voucher_code,
                        normalizedCode=normalized_code,
                        codeHash=self._hash_voucher_code(normalized_code),
                        idempotencyKey=validated_idempotency_key,
                        requestHash=request_hash,
                        requestId=request_id,
                        clientIp=client_ip,
                        userAgent=user_agent,
                    )
                )
            except RuntimeError as exc:
                code = str(exc)
                status_code, message = self._voucher_error(code)
                self._append_financial_audit(
                    "VOUCHER_REDEEM_FAILED",
                    owner,
                    {
                        "businessType": "deposit",
                        "code": code,
                        "message": message,
                        "requestId": request_id,
                        "voucherCodeLast4": normalized_code[-4:],
                        "requestMeta": request_meta or {},
                    },
                )
                raise HTTPException(
                    status_code=status_code,
                    detail={"code": code, "message": message},
                ) from exc

            if not isinstance(redemption, VoucherRedemptionResult):
                raise RuntimeError("VOUCHER_REDEEM_RESULT_INVALID")

            balance = await self.get_balance(owner)
            response = {
                "redemption": redemption.model_dump(by_alias=True, mode="json"),
                "balance": balance,
            }
            if redis_client is not None:
                await self._complete_idempotency_redis(
                    scope="voucher_redeem",
                    owner_wallet=owner,
                    idempotency_key=validated_idempotency_key,
                    request_hash=request_hash,
                    response=response,
                )
            return response


