from typing import Any, Dict, Optional, Tuple
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.config import settings
from src.domain.finance import UsageLogRow
from src.domain.identity import RuntimeCredentialRecord
from src.services.platform import credential_service
from src.storage import BaseStorage
from src.domain.finance import ChargeBuyerUsageCommand


RISK_RESTRICTED_STATUSES = {"restricted", "suspended", "blocked"}


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


def resolve_platform_fee_rate(storage: BaseStorage, seller_wallet: str) -> float:
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
    owner_key = normalize_wallet(str(seller_wallet or ""))
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


def build_buyer_receipt(
    request_id: str,
    service_id: str,
    unit_price: float,
    total_charge: float,
    buyer_balance_after: float,
) -> Dict[str, Any]:
    """Build buyer-visible receipt fields without leaking internal settlement splits."""
    return {
        "requestId": request_id,
        "serviceId": service_id,
        "totalCharge": total_charge,
        "buyerBalanceAfter": buyer_balance_after,
        "serviceUnitPrice": unit_price,
    }


def build_buyer_success_response(
    receipt: Dict[str, Any], upstream_result: Any
) -> Dict[str, Any]:
    """Build canonical buyer response payload while preserving upstream result envelope."""
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
    storage: BaseStorage, seller_wallet: str, unit_price: float
) -> Tuple[float, float, float, float, float, float]:
    """Compute fee decomposition used by charging, logging, and audit records."""
    fee_rate = resolve_platform_fee_rate(storage, seller_wallet)
    protocol_fee = round(unit_price * fee_rate, 6)
    routing_tax = resolve_gateway_routing_tax()
    platform_fee_total = round(protocol_fee + routing_tax, 6)
    seller_net = round(unit_price - protocol_fee, 6)
    total_charge = round(unit_price + routing_tax, 6)
    return (
        fee_rate,
        protocol_fee,
        routing_tax,
        platform_fee_total,
        seller_net,
        total_charge,
    )


def append_usage_log(storage: BaseStorage, row: Dict[str, Any]) -> None:
    """Append one usage event into usage_log collection with safe list normalization."""
    raw_rows = storage.get_data_manager().system.gateway_state.read_usage_log_rows()
    rows = list(raw_rows) if isinstance(raw_rows, list) else []
    typed_row = UsageLogRow.model_validate(row)
    rows.append(typed_row)
    repo = storage.get_data_manager().system.gateway_state
    try:
        repo.write_usage_log_rows(rows)
    except Exception:
        fallback_rows = [
            item.model_dump(by_alias=True, mode="json")
            if isinstance(item, UsageLogRow)
            else item
            for item in rows
        ]
        repo.write_usage_log_rows(fallback_rows)


def _wallet_is_restricted(storage: BaseStorage, wallet: str) -> bool:
    manager = storage.get_data_manager().system.credential_auth
    session = manager.read_auth_session(normalize_wallet(wallet))
    if session is None:
        return False
    status = str(session.status or "").strip().lower()
    return status in RISK_RESTRICTED_STATUSES


def _assert_not_risk_restricted_for_charge(
    storage: BaseStorage, buyer_wallet: str, seller_wallet: str
) -> None:
    ledger = storage.get_data_manager().finance.balance.read_balance_ledger()

    buyer = normalize_wallet(buyer_wallet)
    seller = normalize_wallet(seller_wallet)
    buyer_frozen = round(float(ledger.buyers_frozen.get(buyer, 0.0)), 6)
    seller_frozen = round(float(ledger.sellers_frozen.get(seller, 0.0)), 6)

    if buyer_frozen > 0 and _wallet_is_restricted(storage, buyer):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "BUYER_RESTRICTED_RISK_BLOCK",
                "message": "Buyer account is risk-restricted and cannot be charged.",
            },
        )
    if seller_frozen > 0 and _wallet_is_restricted(storage, seller):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "SELLER_RESTRICTED_RISK_BLOCK",
                "message": "Seller account is risk-restricted and cannot settle charges.",
            },
        )


async def charge_and_mark_usage(
    storage: BaseStorage,
    owner_wallet: str,
    seller_wallet: str,
    total_charge: float,
    platform_fee_total: float,
    seller_net: float,
    credential_id: str,
) -> Tuple[float, Optional[RuntimeCredentialRecord]]:
    """Atomically charge buyer, credit seller/platform, and increment credential usage."""
    now = credential_service.now_ts()

    _assert_not_risk_restricted_for_charge(storage, owner_wallet, seller_wallet)

    if hasattr(storage, "charge_buyer_and_record_usage_atomic"):
        return _charge_and_mark_usage_atomic(
            storage=storage,
            owner_wallet=owner_wallet,
            seller_wallet=seller_wallet,
            total_charge=total_charge,
            platform_fee_total=platform_fee_total,
            seller_net=seller_net,
            credential_id=credential_id,
            now=now,
        )
    return await _charge_and_mark_usage_fallback(
        storage=storage,
        owner_wallet=owner_wallet,
        seller_wallet=seller_wallet,
        total_charge=total_charge,
        platform_fee_total=platform_fee_total,
        seller_net=seller_net,
        credential_id=credential_id,
    )


def _charge_and_mark_usage_atomic(
    *,
    storage: BaseStorage,
    owner_wallet: str,
    seller_wallet: str,
    total_charge: float,
    platform_fee_total: float,
    seller_net: float,
    credential_id: str,
    now: int,
) -> Tuple[float, Optional[RuntimeCredentialRecord]]:
    buyer_after = 0.0
    updated_credential = None

    usage_row = UsageLogRow(
        id=f"usage-{now}-{credential_id}",
        ts=now,
        buyerAddress=owner_wallet,
        sellerAddress=seller_wallet,
        status="accepted",
        totalCharge=Decimal(str(total_charge)).quantize(
            Decimal("0.000001"), rounding=ROUND_HALF_UP
        ),
    )
    try:
        result = getattr(storage, "charge_buyer_and_record_usage_atomic")(
            ChargeBuyerUsageCommand(
                owner_wallet=owner_wallet,
                seller_wallet=seller_wallet,
                total_charge=Decimal(str(total_charge)).quantize(
                    Decimal("0.000001"), rounding=ROUND_HALF_UP
                ),
                seller_net=Decimal(str(seller_net)).quantize(
                    Decimal("0.000001"), rounding=ROUND_HALF_UP
                ),
                platform_fee_total=Decimal(str(platform_fee_total)).quantize(
                    Decimal("0.000001"), rounding=ROUND_HALF_UP
                ),
                usage_row=usage_row,
            )
        )
        if isinstance(result, dict):
            buyer_after = float(result.get("buyerBalanceAfter") or 0.0)
        else:
            buyer_after = float(result.buyer_balance_after)
    except RuntimeError as exc:
        if str(exc) == "INSUFFICIENT_BALANCE":
            raise HTTPException(
                status_code=402,
                detail={
                    "code": "INSUFFICIENT_BALANCE",
                    "message": "buyer balance is insufficient, please deposit first",
                },
            )
        if str(exc) in {"BUYER_RESTRICTED_RISK_BLOCK", "SELLER_RESTRICTED_RISK_BLOCK"}:
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
            calls_used=int(rows[idx].metadata.calls_used or 0) + 1,
            updated_at=now,
        )
        rows[idx] = updated_credential
        credential_service.save_credential_rows(storage, rows)
    return buyer_after, updated_credential


async def _charge_and_mark_usage_fallback(
    *,
    storage: BaseStorage,
    owner_wallet: str,
    seller_wallet: str,
    total_charge: float,
    platform_fee_total: float,
    seller_net: float,
    credential_id: str,
) -> Tuple[float, Optional[RuntimeCredentialRecord]]:
    buyer_after = 0.0
    updated_credential: Optional[RuntimeCredentialRecord] = None
    now = credential_service.now_ts()
    async with credential_service.write_lock:
        ledger = storage.get_data_manager().finance.balance.read_balance_ledger()

        buyer_balance = float(ledger.buyers.get(owner_wallet, 0.0))
        if buyer_balance < total_charge:
            raise HTTPException(
                status_code=402,
                detail={
                    "code": "INSUFFICIENT_BALANCE",
                    "message": "buyer balance is insufficient, please deposit first",
                },
            )

        buyer_after = round(buyer_balance - total_charge, 6)
        ledger.buyers[owner_wallet] = buyer_after
        ledger.sellers[seller_wallet] = round(
            float(ledger.sellers.get(seller_wallet, 0.0)) + seller_net, 6
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
                calls_used=int(rows[idx].metadata.calls_used or 0) + 1,
                updated_at=now,
            )
            rows[idx] = updated_credential
            credential_service.save_credential_rows(storage, rows)

    return buyer_after, updated_credential


async def rollback_charge(
    storage: BaseStorage,
    owner_wallet: str,
    seller_wallet: str,
    total_charge: float,
    platform_fee_total: float,
    seller_net: float,
    updated_credential: Optional[RuntimeCredentialRecord],
) -> None:
    """Rollback buyer/seller/platform ledger and credential usage when upstream fails."""
    async with credential_service.write_lock:
        ledger = storage.get_data_manager().finance.balance.read_balance_ledger()

        ledger.buyers[owner_wallet] = round(
            float(ledger.buyers.get(owner_wallet, 0.0)) + total_charge, 6
        )
        ledger.sellers[seller_wallet] = round(
            float(ledger.sellers.get(seller_wallet, 0.0)) - seller_net, 6
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
                calls_used=max(0, int(rows[idx].metadata.calls_used or 0) - 1),
                updated_at=credential_service.now_ts(),
            )
            credential_service.save_credential_rows(storage, rows)
