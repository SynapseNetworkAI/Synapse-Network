from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.config import settings
from src.domain.execution import InvocationRecord
from src.domain.finance import UsageLogRow
from src.domain.identity import RuntimeCredentialRecord
from src.services.platform import credential_service
from src.storage import BaseStorage
from src.domain.finance import ChargeConsumerUsageCommand


RISK_RESTRICTED_STATUSES = {"restricted", "suspended", "blocked"}


@dataclass(frozen=True)
class ChargeUsageAtomicContext:
    request_id: str = ""
    unit_price: float = 0.0
    protocol_fee: float = 0.0
    routing_tax: float = 0.0
    usage_row: Optional[UsageLogRow] = None
    invocation: Optional[InvocationRecord] = None


def sanitize_fee_rate(raw: Any, fallback: float) -> float:
    """Clamp fee rates to [0,1] so malformed policy data cannot break settlement math."""
    try:
        value = float(raw)
    except Exception:
        return float(fallback)
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return value


def resolve_platform_fee_rate(storage: BaseStorage, provider_wallet: str) -> float:
    """Resolve effective fee rate using owner override > runtime default > global config."""
    fallback = sanitize_fee_rate(settings.platform_fee_rate, 0.10)
    policy = storage.get_data_manager().finance.fee_policy.get_platform_fee_policy()

    if (
        policy.updated_at is None
        and not policy.owner_rates
        and abs(float(policy.default_rate)) < 1e-12
    ):
        policy_default = fallback
    else:
        policy_default = sanitize_fee_rate(policy.default_rate, fallback)
    owner_key = normalize_wallet(str(provider_wallet or ""))
    if owner_key and owner_key in policy.owner_rates:
        return sanitize_fee_rate(policy.owner_rates.get(owner_key), policy_default)
    return policy_default


def resolve_gateway_routing_tax() -> float:
    """Resolve fixed routing tax per request and normalize precision for ledger safety."""
    try:
        value = float(settings.gateway_routing_tax)
    except Exception:
        return 0.0
    if value < 0:
        return 0.0
    return round(value, 6)


def build_consumer_receipt(
    request_id: str,
    quote_id: str,
    invocation_id: str,
    service_id: str,
    unit_price: float,
    total_charge: float,
    consumer_balance_after: float,
) -> dict[str, Any]:
    """Build consumer-visible receipt fields without leaking internal settlement splits."""
    return {
        "requestId": request_id,
        "quoteId": quote_id,
        "invocationId": invocation_id,
        "serviceId": service_id,
        "totalCharge": total_charge,
        "consumerAvailableBalanceAfter": consumer_balance_after,
        "serviceUnitPrice": unit_price,
    }


def build_consumer_success_response(
    receipt: dict[str, Any], upstream_result: Any
) -> dict[str, Any]:
    """Build canonical consumer response payload while preserving upstream result envelope."""
    return {
        "statusCode": 200,
        "ok": True,
        "payload": {
            "status": "success",
            "code": "DELIVERED",
            "receipt": receipt,
            "data": {"result": upstream_result},
        },
    }


def pricing_breakdown(
    storage: BaseStorage, provider_wallet: str, unit_price: float
) -> tuple[float, float, float, float, float, float]:
    """Compute fee decomposition used by charging, logging, and audit records."""
    fee_rate = resolve_platform_fee_rate(storage, provider_wallet)
    protocol_fee = round(unit_price * fee_rate, 6)
    routing_tax = resolve_gateway_routing_tax()
    platform_fee_total = round(protocol_fee + routing_tax, 6)
    provider_net = round(unit_price - protocol_fee, 6)
    total_charge = round(unit_price + routing_tax, 6)
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
    except Exception:
        fallback_rows = [
            item.model_dump(by_alias=True, mode="json")
            if isinstance(item, UsageLogRow)
            else item
            for item in rows
        ]
        repo.write_invocation_billing_rows(fallback_rows)


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
    total_charge: float,
    platform_fee_total: float,
    provider_net: float,
    credential_id: str,
    request_id: str = "",
    unit_price: float = 0.0,
    protocol_fee: float = 0.0,
    routing_tax: float = 0.0,
    usage_row: Optional[UsageLogRow] = None,
    invocation: Optional[InvocationRecord] = None,
) -> tuple[float, Optional[RuntimeCredentialRecord]]:
    """Atomically charge consumer, credit provider/platform, and increment credential usage."""
    now = credential_service.now_ts()

    _assert_not_risk_restricted_for_charge(storage, owner_wallet, provider_wallet)

    if hasattr(storage, "charge_consumer_and_record_usage_atomic"):
        return _charge_and_mark_usage_atomic(
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
    total_charge: float,
    platform_fee_total: float,
    provider_net: float,
    credential_id: str,
    context: ChargeUsageAtomicContext,
    now: int,
) -> tuple[float, Optional[RuntimeCredentialRecord]]:
    consumer_after = 0.0
    updated_credential = None

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
        unitPrice=Decimal(str(context.unit_price)).quantize(
            Decimal("0.000001"), rounding=ROUND_HALF_UP
        ),
        protocolFee=Decimal(str(context.protocol_fee)).quantize(
            Decimal("0.000001"), rounding=ROUND_HALF_UP
        ),
        routingTax=Decimal(str(context.routing_tax)).quantize(
            Decimal("0.000001"), rounding=ROUND_HALF_UP
        ),
        totalCharge=Decimal(str(total_charge)).quantize(
            Decimal("0.000001"), rounding=ROUND_HALF_UP
        ),
    )
    try:
        result = storage.charge_consumer_and_record_usage_atomic(
            ChargeConsumerUsageCommand(
                owner_wallet=owner_wallet,
                provider_wallet=provider_wallet,
                total_charge=Decimal(str(total_charge)).quantize(
                    Decimal("0.000001"), rounding=ROUND_HALF_UP
                ),
                provider_net=Decimal(str(provider_net)).quantize(
                    Decimal("0.000001"), rounding=ROUND_HALF_UP
                ),
                platform_fee_total=Decimal(str(platform_fee_total)).quantize(
                    Decimal("0.000001"), rounding=ROUND_HALF_UP
                ),
                request_id=context.request_id,
                unit_price=Decimal(str(context.unit_price)).quantize(
                    Decimal("0.000001"), rounding=ROUND_HALF_UP
                ),
                protocol_fee=Decimal(str(context.protocol_fee)).quantize(
                    Decimal("0.000001"), rounding=ROUND_HALF_UP
                ),
                routing_tax=Decimal(str(context.routing_tax)).quantize(
                    Decimal("0.000001"), rounding=ROUND_HALF_UP
                ),
                invocation=context.invocation,
                usage_row=normalized_usage_row,
            )
        )
        if isinstance(result, dict):
            consumer_after = float(result.get("consumerAvailableBalanceAfter") or 0.0)
        else:
            consumer_after = float(
                getattr(result, "consumer_available_balance_after", 0.0)
            )
    except RuntimeError as exc:
        if str(exc) == "INSUFFICIENT_BALANCE":
            raise HTTPException(
                status_code=402,
                detail={
                    "code": "INSUFFICIENT_BALANCE",
                    "message": "consumer balance is insufficient, please deposit first",
                },
            )
        if str(exc) in {"CONSUMER_RESTRICTED_RISK_BLOCK", "PROVIDER_RESTRICTED_RISK_BLOCK"}:
            raise HTTPException(
                status_code=403,
                detail={"code": str(exc), "message": "Charge blocked by risk policy."},
            )
        raise

    rows = credential_service.load_credential_rows(storage)
    idx = credential_service.find_runtime_credential_index(rows, credential_id)
    if idx >= 0:
        updated_credential = credential_service.clone_runtime_credential(
            rows[idx],
            credential_service.CredentialPatch(
                calls_used=int(rows[idx].metadata.calls_used or 0) + 1,
            ),
        )
        rows[idx] = updated_credential
        credential_service.save_credential_rows(storage, rows)
    return consumer_after, updated_credential


async def _charge_and_mark_usage_fallback(
    *,
    storage: BaseStorage,
    owner_wallet: str,
    provider_wallet: str,
    total_charge: float,
    platform_fee_total: float,
    provider_net: float,
    credential_id: str,
) -> tuple[float, Optional[RuntimeCredentialRecord]]:
    consumer_after = 0.0
    updated_credential: Optional[RuntimeCredentialRecord] = None
    now = credential_service.now_ts()
    async with credential_service.write_lock:
        ledger = storage.get_data_manager().finance.balance.read_balance_ledger()

        consumer_balance = ledger.consumer_available_balance(owner_wallet)
        if consumer_balance < total_charge:
            raise HTTPException(
                status_code=402,
                detail={
                    "code": "INSUFFICIENT_BALANCE",
                    "message": "consumer balance is insufficient, please deposit first",
                },
            )

        consumer_after = round(consumer_balance - total_charge, 6)
        consumer_wallet = ledger.ensure_consumer_wallet(owner_wallet)
        provider_wallet_row = ledger.ensure_provider_wallet(provider_wallet)
        consumer_wallet.available_balance = consumer_after
        provider_wallet_row.available_balance = round(
            float(provider_wallet_row.available_balance or 0.0) + provider_net, 6
        )
        ledger.platform.fee_accrued = round(
            ledger.platform.fee_accrued + platform_fee_total, 6
        )
        ledger.updated_at = now
        storage.get_data_manager().finance.balance.write_balance_ledger(ledger)

        rows = credential_service.load_credential_rows(storage)
        idx = credential_service.find_runtime_credential_index(rows, credential_id)
        if idx >= 0:
            updated_credential = credential_service.clone_runtime_credential(
                rows[idx],
                credential_service.CredentialPatch(
                    calls_used=int(rows[idx].metadata.calls_used or 0) + 1,
                ),
            )
            rows[idx] = updated_credential
            credential_service.save_credential_rows(storage, rows)

    return consumer_after, updated_credential


async def rollback_charge(
    storage: BaseStorage,
    owner_wallet: str,
    provider_wallet: str,
    total_charge: float,
    platform_fee_total: float,
    provider_net: float,
    updated_credential: Optional[RuntimeCredentialRecord],
) -> None:
    """Rollback consumer/provider/platform ledger and credential usage when upstream fails."""
    async with credential_service.write_lock:
        ledger = storage.get_data_manager().finance.balance.read_balance_ledger()

        consumer_wallet = ledger.ensure_consumer_wallet(owner_wallet)
        provider_wallet_row = ledger.ensure_provider_wallet(provider_wallet)
        consumer_wallet.available_balance = round(
            float(consumer_wallet.available_balance or 0.0) + total_charge, 6
        )
        provider_wallet_row.available_balance = round(
            float(provider_wallet_row.available_balance or 0.0) - provider_net, 6
        )
        ledger.platform.fee_accrued = round(
            ledger.platform.fee_accrued - platform_fee_total, 6
        )
        ledger.updated_at = credential_service.now_ts()
        storage.get_data_manager().finance.balance.write_balance_ledger(ledger)

        if not updated_credential:
            return

        rows = credential_service.load_credential_rows(storage)
        idx = credential_service.find_runtime_credential_index(
            rows, updated_credential.credential.credential_id
        )
        if idx >= 0:
            rows[idx] = credential_service.clone_runtime_credential(
                rows[idx],
                credential_service.CredentialPatch(
                    calls_used=max(0, int(rows[idx].metadata.calls_used or 0) - 1),
                ),
            )
            credential_service.save_credential_rows(storage, rows)
