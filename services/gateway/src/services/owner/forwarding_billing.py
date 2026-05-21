from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional
from decimal import Decimal
import logging

import asyncio

from fastapi import HTTPException
from psycopg.errors import DeadlockDetected

from src.core.common import normalize_wallet
from src.core.config import settings
from src.domain.execution import InvocationRecord
from src.domain.finance import UsageLogRow
from src.domain.invocation_response import (
    ConsumerReceipt,
    ConsumerResponseData,
    ConsumerResponsePayload,
    ConsumerSuccessResponse,
)
from src.domain.identity import RuntimeCredentialRecord
from src.services.platform import credential_service
from src.storage import BaseStorage
from src.domain.finance import ChargeConsumerUsageCommand
from src.utils.money import MoneyCodec


RISK_RESTRICTED_STATUSES = {"restricted", "suspended", "blocked"}
_CREDENTIAL_USAGE_DEADLOCK_MAX_ATTEMPTS = 3
_CREDENTIAL_USAGE_DEADLOCK_BACKOFF_SEC = 0.05
_ROLLBACK_DEADLOCK_MAX_ATTEMPTS = 3
_ROLLBACK_DEADLOCK_BACKOFF_SEC = 0.05
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ChargeUsageAtomicContext:
    request_id: str = ""
    unit_price: Decimal = Decimal("0")
    protocol_fee: Decimal = Decimal("0")
    routing_tax: Decimal = Decimal("0")
    usage_row: Optional[UsageLogRow] = None
    invocation: Optional[InvocationRecord] = None


def _money_decimal(value: Decimal | str | int | float | None) -> Decimal:
    if isinstance(value, float):
        value = Decimal(str(value))
    return MoneyCodec.coerce_decimal(value)


def sanitize_fee_rate(raw: Any, fallback: Decimal | str | int) -> Decimal:
    """Clamp fee rates to [0,1] so malformed policy data cannot break settlement math."""
    try:
        value = Decimal(str(raw))
    except Exception:
        return _money_decimal(fallback)
    if value < Decimal("0"):
        return Decimal("0")
    if value > Decimal("1"):
        return Decimal("1")
    return value


def resolve_platform_fee_rate(storage: BaseStorage, provider_wallet: str) -> Decimal:
    """Resolve effective fee rate using owner override > runtime default > global config."""
    fallback = sanitize_fee_rate(settings.platform_fee_rate, Decimal("0.05"))
    policy = storage.get_data_manager().finance.fee_policy.get_platform_fee_policy()

    if (
        policy.updated_at is None
        and not policy.owner_rates
        and abs(Decimal(str(policy.default_rate))) < Decimal("0.000000000001")
    ):
        policy_default = fallback
    else:
        policy_default = sanitize_fee_rate(policy.default_rate, fallback)
    owner_key = normalize_wallet(str(provider_wallet or ""))
    if owner_key and owner_key in policy.owner_rates:
        return sanitize_fee_rate(policy.owner_rates.get(owner_key), policy_default)
    return policy_default


def resolve_gateway_routing_tax() -> Decimal:
    """Resolve fixed routing tax per request and normalize precision for ledger safety."""
    try:
        value = Decimal(str(settings.gateway_routing_tax))
    except Exception:
        return Decimal("0")
    if value < Decimal("0"):
        return Decimal("0")
    return MoneyCodec.quantize_usdc(value)


def build_consumer_receipt(
    request_id: str,
    quote_id: str,
    invocation_id: str,
    service_id: str,
    unit_price: Decimal | str | int,
    total_charge: Decimal | str | int,
    consumer_balance_after: Decimal | str | int,
) -> ConsumerReceipt:
    """Build consumer-visible receipt fields without leaking internal settlement splits."""
    return ConsumerReceipt(
        requestId=request_id,
        quoteId=quote_id,
        invocationId=invocation_id,
        serviceId=service_id,
        totalCharge=_money_decimal(total_charge),
        consumerAvailableBalanceAfter=_money_decimal(consumer_balance_after),
        serviceUnitPrice=_money_decimal(unit_price),
    )


def build_consumer_success_response(
    receipt: ConsumerReceipt, upstream_result: Any
) -> ConsumerSuccessResponse:
    """Build canonical consumer response payload while preserving upstream result envelope."""
    return ConsumerSuccessResponse(
        statusCode=200,
        ok=True,
        payload=ConsumerResponsePayload(
            status="success",
            code="DELIVERED",
            receipt=receipt,
            data=ConsumerResponseData(result=upstream_result),
        ),
    )


def pricing_breakdown(
    storage: BaseStorage, provider_wallet: str, unit_price: Decimal | str | int
) -> tuple[Decimal, Decimal, Decimal, Decimal, Decimal, Decimal]:
    """Compute fee decomposition used by charging, logging, and audit records."""
    normalized_unit_price = _money_decimal(unit_price)
    fee_rate = resolve_platform_fee_rate(storage, provider_wallet)
    protocol_fee = MoneyCodec.quantize_usdc(normalized_unit_price * fee_rate)
    routing_tax = Decimal("0") if normalized_unit_price == Decimal("0") else resolve_gateway_routing_tax()
    platform_fee_total = _money_decimal(protocol_fee + routing_tax)
    provider_net = _money_decimal(normalized_unit_price - protocol_fee)
    total_charge = _money_decimal(normalized_unit_price + routing_tax)
    return (
        fee_rate,
        protocol_fee,
        routing_tax,
        platform_fee_total,
        provider_net,
        total_charge,
    )


def append_invocation_billing(storage: BaseStorage, row: UsageLogRow | dict[str, Any]) -> None:
    """Append one invocation billing event into the typed billing projection."""
    raw_rows = storage.get_data_manager().system.gateway_state.read_invocation_billing_rows()
    rows = list(raw_rows) if isinstance(raw_rows, list) else []
    typed_row = UsageLogRow.model_validate(row)
    rows.append(typed_row)
    repo = storage.get_data_manager().system.gateway_state
    try:
        repo.write_invocation_billing_rows(rows)
    except Exception as exc:
        fallback_rows = [
            item.model_dump(by_alias=True, mode="json")
            if isinstance(item, UsageLogRow)
            else item
            for item in rows
        ]
        try:
            repo.write_invocation_billing_rows(fallback_rows)
        except Exception:
            logger.warning(
                "INVOCATION_BILLING_APPEND_FAILED",
                extra={
                    "requestId": getattr(typed_row, "request_id", None),
                    "invocationId": getattr(typed_row, "id", None),
                    "status": getattr(typed_row, "status", None),
                    "initialError": str(exc),
                },
                exc_info=True,
            )


def append_usage_log(storage: BaseStorage, row: UsageLogRow | dict[str, Any]) -> None:
    append_invocation_billing(storage, row)


def _wallet_is_restricted(storage: BaseStorage, wallet: str) -> bool:
    manager = storage.get_data_manager().system.credential_auth
    session = manager.read_auth_session(normalize_wallet(wallet))
    if session is None:
        return False
    status = str(session.status or "").strip().lower()
    return status in RISK_RESTRICTED_STATUSES


def _assert_not_risk_restricted_for_charge(
    storage: BaseStorage, consumer_wallet: str, provider_wallet: str
) -> None:
    ledger = storage.get_data_manager().finance.balance.read_balance_ledger()

    consumer = normalize_wallet(consumer_wallet)
    provider = normalize_wallet(provider_wallet)
    consumer_frozen = ledger.consumer_frozen_balance(consumer)
    provider_frozen = ledger.provider_frozen_balance(provider)

    if consumer_frozen > 0 and _wallet_is_restricted(storage, consumer):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "CONSUMER_RESTRICTED_RISK_BLOCK",
                "message": "Consumer account is risk-restricted and cannot be charged.",
            },
        )
    if provider_frozen > 0 and _wallet_is_restricted(storage, provider):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "PROVIDER_RESTRICTED_RISK_BLOCK",
                "message": "Provider account is risk-restricted and cannot settle charges.",
            },
        )


async def charge_and_mark_usage(
    storage: BaseStorage,
    owner_wallet: str,
    provider_wallet: str,
    total_charge: Decimal | str | int,
    platform_fee_total: Decimal | str | int,
    provider_net: Decimal | str | int,
    credential_id: str,
    request_id: str = "",
    unit_price: Decimal | str | int = Decimal("0"),
    protocol_fee: Decimal | str | int = Decimal("0"),
    routing_tax: Decimal | str | int = Decimal("0"),
    usage_row: Optional[UsageLogRow] = None,
    invocation: Optional[InvocationRecord] = None,
) -> tuple[Decimal, Optional[RuntimeCredentialRecord]]:
    """Atomically charge consumer, credit provider/platform, and increment credential usage."""
    now = credential_service.now_ts()

    _assert_not_risk_restricted_for_charge(storage, owner_wallet, provider_wallet)

    if hasattr(storage, "charge_consumer_and_record_usage_atomic"):
        consumer_after, _ = _charge_and_mark_usage_atomic(
            storage=storage,
            owner_wallet=owner_wallet,
            provider_wallet=provider_wallet,
            total_charge=total_charge,
            platform_fee_total=platform_fee_total,
            provider_net=provider_net,
            credential_id=credential_id,
            context=ChargeUsageAtomicContext(
                request_id=request_id,
                unit_price=unit_price,
                protocol_fee=protocol_fee,
                routing_tax=routing_tax,
                usage_row=usage_row,
                invocation=invocation,
            ),
            now=now,
        )
        updated_credential = await _increment_credential_usage_with_retry(
            storage, credential_id
        )
        return consumer_after, updated_credential
    return await _charge_and_mark_usage_fallback(
        storage=storage,
        owner_wallet=owner_wallet,
        provider_wallet=provider_wallet,
        total_charge=total_charge,
        platform_fee_total=platform_fee_total,
        provider_net=provider_net,
        credential_id=credential_id,
    )


def _charge_and_mark_usage_atomic(
    *,
    storage: BaseStorage,
    owner_wallet: str,
    provider_wallet: str,
    total_charge: Decimal | str | int,
    platform_fee_total: Decimal | str | int,
    provider_net: Decimal | str | int,
    credential_id: str,
    context: ChargeUsageAtomicContext,
    now: int,
) -> tuple[Decimal, Optional[RuntimeCredentialRecord]]:
    consumer_after = Decimal("0")
    normalized_total_charge = _money_decimal(total_charge)
    normalized_provider_net = _money_decimal(provider_net)
    normalized_platform_fee_total = _money_decimal(platform_fee_total)

    normalized_usage_row = context.usage_row or UsageLogRow(
        id=(
            context.invocation.invocation_id
            if context.invocation is not None
            else f"usage-{now}-{credential_id}"
        ),
        ts=now,
        requestId=context.request_id or None,
        consumerAddress=owner_wallet,
        providerAddress=provider_wallet,
        status="accepted",
        unitPrice=_money_decimal(context.unit_price),
        protocolFee=_money_decimal(context.protocol_fee),
        routingTax=_money_decimal(context.routing_tax),
        totalCharge=normalized_total_charge,
    )
    try:
        result = storage.charge_consumer_and_record_usage_atomic(
            ChargeConsumerUsageCommand(
                owner_wallet=owner_wallet,
                provider_wallet=provider_wallet,
                total_charge=normalized_total_charge,
                provider_net=normalized_provider_net,
                platform_fee_total=normalized_platform_fee_total,
                request_id=context.request_id,
                unit_price=_money_decimal(context.unit_price),
                protocol_fee=_money_decimal(context.protocol_fee),
                routing_tax=_money_decimal(context.routing_tax),
                invocation=context.invocation,
                usage_row=normalized_usage_row,
            )
        )
        if isinstance(result, dict):
            consumer_after = _money_decimal(result.get("consumerAvailableBalanceAfter"))
        else:
            consumer_after = _money_decimal(getattr(result, "consumer_available_balance_after", 0))
    except RuntimeError as exc:
        if str(exc) == "INSUFFICIENT_BALANCE":
            raise HTTPException(
                status_code=402,
                detail={
                    "code": "INSUFFICIENT_BALANCE",
                    "message": "consumer balance is insufficient, please deposit first",
                },
            ) from exc
        if str(exc) in {"CONSUMER_RESTRICTED_RISK_BLOCK", "PROVIDER_RESTRICTED_RISK_BLOCK"}:
            raise HTTPException(
                status_code=403,
                detail={"code": str(exc), "message": "Charge blocked by risk policy."},
            ) from exc
        raise

    return consumer_after, None


def _increment_credential_usage_once(
    storage: BaseStorage, credential_id: str
) -> Optional[RuntimeCredentialRecord]:
    return credential_service.increment_credential_usage(storage, credential_id, 1)


async def _increment_credential_usage_with_retry(
    storage: BaseStorage, credential_id: str
) -> Optional[RuntimeCredentialRecord]:
    """Increment credential usage outside the ledger charge transaction with deadlock retry."""
    last_error: Optional[BaseException] = None
    for attempt in range(1, _CREDENTIAL_USAGE_DEADLOCK_MAX_ATTEMPTS + 1):
        try:
            async with credential_service.write_lock:
                return _increment_credential_usage_once(storage, credential_id)
        except DeadlockDetected as exc:
            last_error = exc
            if attempt >= _CREDENTIAL_USAGE_DEADLOCK_MAX_ATTEMPTS:
                break
            await asyncio.sleep(_CREDENTIAL_USAGE_DEADLOCK_BACKOFF_SEC * attempt)
    if last_error is not None:
        raise last_error
    return None


async def _charge_and_mark_usage_fallback(
    *,
    storage: BaseStorage,
    owner_wallet: str,
    provider_wallet: str,
    total_charge: Decimal | str | int,
    platform_fee_total: Decimal | str | int,
    provider_net: Decimal | str | int,
    credential_id: str,
) -> tuple[Decimal, Optional[RuntimeCredentialRecord]]:
    total_charge_decimal = _money_decimal(total_charge)
    platform_fee_total_decimal = _money_decimal(platform_fee_total)
    provider_net_decimal = _money_decimal(provider_net)
    consumer_after = Decimal("0")
    updated_credential: Optional[RuntimeCredentialRecord] = None
    now = credential_service.now_ts()
    async with credential_service.write_lock:
        ledger = storage.get_data_manager().finance.balance.read_balance_ledger()

        consumer_balance = ledger.consumer_available_balance(owner_wallet)
        if consumer_balance < total_charge_decimal:
            raise HTTPException(
                status_code=402,
                detail={
                    "code": "INSUFFICIENT_BALANCE",
                    "message": "consumer balance is insufficient, please deposit first",
                },
            )

        consumer_after = _money_decimal(consumer_balance - total_charge_decimal)
        consumer_wallet = ledger.ensure_consumer_wallet(owner_wallet)
        provider_wallet_row = ledger.ensure_provider_wallet(provider_wallet)
        consumer_wallet.available_balance = consumer_after
        provider_wallet_row.available_balance = _money_decimal(
            provider_wallet_row.available_balance + provider_net_decimal
        )
        ledger.platform.fee_accrued = _money_decimal(
            ledger.platform.fee_accrued + platform_fee_total_decimal
        )
        ledger.updated_at = now
        storage.get_data_manager().finance.balance.write_balance_ledger(ledger)

        updated_credential = credential_service.increment_credential_usage(
            storage, credential_id, 1
        )

    return consumer_after, updated_credential


async def rollback_charge(
    storage: BaseStorage,
    owner_wallet: str,
    provider_wallet: str,
    total_charge: Decimal | str | int,
    platform_fee_total: Decimal | str | int,
    provider_net: Decimal | str | int,
    updated_credential: Optional[RuntimeCredentialRecord],
) -> None:
    """Rollback consumer/provider/platform ledger and credential usage when upstream fails."""
    last_error: Optional[BaseException] = None
    for attempt in range(1, _ROLLBACK_DEADLOCK_MAX_ATTEMPTS + 1):
        try:
            async with credential_service.write_lock:
                _rollback_charge_once(
                    storage=storage,
                    owner_wallet=owner_wallet,
                    provider_wallet=provider_wallet,
                    total_charge=total_charge,
                    platform_fee_total=platform_fee_total,
                    provider_net=provider_net,
                    updated_credential=updated_credential,
                )
        except DeadlockDetected as exc:
            last_error = exc
            if attempt >= _ROLLBACK_DEADLOCK_MAX_ATTEMPTS:
                break
            await asyncio.sleep(_ROLLBACK_DEADLOCK_BACKOFF_SEC * attempt)
        else:
            return
    if last_error is not None:
        raise last_error


def _rollback_charge_once(
    *,
    storage: BaseStorage,
    owner_wallet: str,
    provider_wallet: str,
    total_charge: Decimal | str | int,
    platform_fee_total: Decimal | str | int,
    provider_net: Decimal | str | int,
    updated_credential: Optional[RuntimeCredentialRecord],
) -> None:
    total_charge_decimal = _money_decimal(total_charge)
    platform_fee_total_decimal = _money_decimal(platform_fee_total)
    provider_net_decimal = _money_decimal(provider_net)

    ledger = storage.get_data_manager().finance.balance.read_balance_ledger()
    consumer_wallet = ledger.ensure_consumer_wallet(owner_wallet)
    provider_wallet_row = ledger.ensure_provider_wallet(provider_wallet)
    consumer_wallet.available_balance = _money_decimal(
        consumer_wallet.available_balance + total_charge_decimal
    )
    provider_wallet_row.available_balance = _money_decimal(
        provider_wallet_row.available_balance - provider_net_decimal
    )
    ledger.platform.fee_accrued = _money_decimal(
        ledger.platform.fee_accrued - platform_fee_total_decimal
    )
    ledger.updated_at = credential_service.now_ts()
    storage.get_data_manager().finance.balance.write_balance_ledger(ledger)

    if not updated_credential:
        return

    credential_service.decrement_credential_usage(
        storage,
        updated_credential.credential.credential_id,
        1,
    )
