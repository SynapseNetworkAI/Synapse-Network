from typing import Any, Dict, Optional, Tuple
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.config import settings
from src.services.platform import credential_service
from src.storage import BaseStorage


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
    policy = getattr(storage, "get_platform_fee_policy")() or {}
    if not isinstance(policy, dict):
        return fallback

    policy_default = sanitize_fee_rate(policy.get("defaultRate"), fallback)
    owner_rates = policy.get("ownerRates") if isinstance(policy.get("ownerRates"), dict) else {}
    owner_key = normalize_wallet(str(seller_wallet or ""))
    if owner_key and owner_key in owner_rates:
        return sanitize_fee_rate(owner_rates.get(owner_key), policy_default)
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


def build_buyer_success_response(receipt: Dict[str, Any], upstream_result: Any) -> Dict[str, Any]:
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


def pricing_breakdown(storage: BaseStorage, seller_wallet: str, unit_price: float) -> Tuple[float, float, float, float, float, float]:
    """Compute fee decomposition used by charging, logging, and audit records."""
    fee_rate = resolve_platform_fee_rate(storage, seller_wallet)
    protocol_fee = round(unit_price * fee_rate, 6)
    routing_tax = resolve_gateway_routing_tax()
    platform_fee_total = round(protocol_fee + routing_tax, 6)
    seller_net = round(unit_price - protocol_fee, 6)
    total_charge = round(unit_price + routing_tax, 6)
    return fee_rate, protocol_fee, routing_tax, platform_fee_total, seller_net, total_charge


def append_usage_log(storage: BaseStorage, row: Dict[str, Any]) -> None:
    """Append one usage event into usage_log collection with safe list normalization."""
    raw_rows = getattr(storage, "read_usage_log_rows")()
    rows = [item for item in raw_rows if isinstance(item, dict)] if isinstance(raw_rows, list) else []
    rows.append(row)
    getattr(storage, "write_usage_log_rows")(rows)


def _wallet_is_restricted(storage: BaseStorage, wallet: str) -> bool:
    sessions = storage.get_collection("auth_sessions")
    if not isinstance(sessions, dict):
        return False
    payload = sessions.get(normalize_wallet(wallet))
    if not isinstance(payload, dict):
        return False
    status = str(payload.get("status") or "").strip().lower()
    return status in RISK_RESTRICTED_STATUSES


def _assert_not_risk_restricted_for_charge(storage: BaseStorage, buyer_wallet: str, seller_wallet: str) -> None:
    ledger = getattr(storage, "read_balance_ledger")() or {}
    if not isinstance(ledger, dict):
        ledger = {}
    buyers_frozen = ledger.get("buyersFrozen") if isinstance(ledger.get("buyersFrozen"), dict) else {}
    sellers_frozen = ledger.get("sellersFrozen") if isinstance(ledger.get("sellersFrozen"), dict) else {}

    buyer = normalize_wallet(buyer_wallet)
    seller = normalize_wallet(seller_wallet)
    buyer_frozen = round(float(buyers_frozen.get(buyer, 0.0)), 6)
    seller_frozen = round(float(sellers_frozen.get(seller, 0.0)), 6)

    if buyer_frozen > 0 and _wallet_is_restricted(storage, buyer):
        raise HTTPException(
            status_code=403,
            detail={"code": "BUYER_RESTRICTED_RISK_BLOCK", "message": "Buyer account is risk-restricted and cannot be charged."},
        )
    if seller_frozen > 0 and _wallet_is_restricted(storage, seller):
        raise HTTPException(
            status_code=403,
            detail={"code": "SELLER_RESTRICTED_RISK_BLOCK", "message": "Seller account is risk-restricted and cannot settle charges."},
        )


async def charge_and_mark_usage(
    storage: BaseStorage,
    owner_wallet: str,
    seller_wallet: str,
    total_charge: float,
    platform_fee_total: float,
    seller_net: float,
    credential_id: str,
) -> Tuple[float, Optional[Dict[str, Any]]]:
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
) -> Tuple[float, Optional[Dict[str, Any]]]:
    buyer_after = 0.0
    updated_credential = None

    usage_row = {
        "id": f"usage-{now}-{credential_id}",
        "timestamp": now,
        "buyer": owner_wallet,
        "seller": seller_wallet,
        "status": "accepted",
        "totalCharge": float(Decimal(str(total_charge)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)),
    }
    try:
        result = getattr(storage, "charge_buyer_and_record_usage_atomic")(
            owner_wallet=owner_wallet,
            seller_wallet=seller_wallet,
            total_charge=Decimal(str(total_charge)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP),
            seller_net=Decimal(str(seller_net)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP),
            platform_fee_total=Decimal(str(platform_fee_total)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP),
            usage_row=usage_row,
        )
        buyer_after = float(result.get("buyerBalanceAfter") or 0.0)
    except RuntimeError as exc:
        if str(exc) == "INSUFFICIENT_BALANCE":
            raise HTTPException(status_code=402, detail={"code": "INSUFFICIENT_BALANCE", "message": "buyer balance is insufficient, please deposit first"})
        if str(exc) in {"BUYER_RESTRICTED_RISK_BLOCK", "SELLER_RESTRICTED_RISK_BLOCK"}:
            raise HTTPException(status_code=403, detail={"code": str(exc), "message": "Charge blocked by risk policy."})
        raise

    rows, extras = credential_service.load_credential_rows(storage)
    idx = next((i for i, row in enumerate(rows) if str(row.get("id")) == credential_id), -1)
    if idx >= 0:
        rows[idx]["callsUsed"] = int(rows[idx].get("callsUsed") or 0) + 1
        rows[idx]["updatedAt"] = now
        updated_credential = rows[idx]
        credential_service.save_credential_rows(storage, rows, extras)
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
) -> Tuple[float, Optional[Dict[str, Any]]]:
    buyer_after = 0.0
    updated_credential = None
    now = credential_service.now_ts()
    async with credential_service.write_lock:
        ledger = getattr(storage, "read_balance_ledger")() or {}
        if not isinstance(ledger, dict):
            ledger = {}
        buyers = ledger.setdefault("buyers", {})
        sellers = ledger.setdefault("sellers", {})
        platform = ledger.setdefault("platform", {"feeAccrued": 0.0})

        buyer_balance = float(buyers.get(owner_wallet, 0.0))
        if buyer_balance < total_charge:
            raise HTTPException(status_code=402, detail={"code": "INSUFFICIENT_BALANCE", "message": "buyer balance is insufficient, please deposit first"})

        buyer_after = round(buyer_balance - total_charge, 6)
        buyers[owner_wallet] = buyer_after
        sellers[seller_wallet] = round(float(sellers.get(seller_wallet, 0.0)) + seller_net, 6)
        platform["feeAccrued"] = round(float(platform.get("feeAccrued", 0.0)) + platform_fee_total, 6)
        ledger["updatedAt"] = now
        getattr(storage, "write_balance_ledger")(ledger)

        rows, extras = credential_service.load_credential_rows(storage)
        idx = next((i for i, row in enumerate(rows) if str(row.get("id")) == credential_id), -1)
        if idx >= 0:
            rows[idx]["callsUsed"] = int(rows[idx].get("callsUsed") or 0) + 1
            rows[idx]["updatedAt"] = now
            updated_credential = rows[idx]
            credential_service.save_credential_rows(storage, rows, extras)

    return buyer_after, updated_credential


async def rollback_charge(
    storage: BaseStorage,
    owner_wallet: str,
    seller_wallet: str,
    total_charge: float,
    platform_fee_total: float,
    seller_net: float,
    updated_credential: Optional[Dict[str, Any]],
) -> None:
    """Rollback buyer/seller/platform ledger and credential usage when upstream fails."""
    async with credential_service.write_lock:
        ledger = getattr(storage, "read_balance_ledger")() or {}
        if not isinstance(ledger, dict):
            ledger = {}
        buyers = ledger.setdefault("buyers", {})
        sellers = ledger.setdefault("sellers", {})
        platform = ledger.setdefault("platform", {"feeAccrued": 0.0})

        buyers[owner_wallet] = round(float(buyers.get(owner_wallet, 0.0)) + total_charge, 6)
        sellers[seller_wallet] = round(float(sellers.get(seller_wallet, 0.0)) - seller_net, 6)
        platform["feeAccrued"] = round(float(platform.get("feeAccrued", 0.0)) - platform_fee_total, 6)
        ledger["updatedAt"] = credential_service.now_ts()
        getattr(storage, "write_balance_ledger")(ledger)

        if not updated_credential:
            return

        rows, extras = credential_service.load_credential_rows(storage)
        idx = next((i for i, row in enumerate(rows) if str(row.get("id")) == str(updated_credential.get("id"))), -1)
        if idx >= 0:
            rows[idx]["callsUsed"] = max(0, int(rows[idx].get("callsUsed") or 0) - 1)
            rows[idx]["updatedAt"] = credential_service.now_ts()
            credential_service.save_credential_rows(storage, rows, extras)