from datetime import datetime
from decimal import Decimal
import json
from typing import Any

from src.storage.analytics.admin_operations_models import (
    ConsumerDepositRecord,
    OwnerAccountRecord,
    Pagination,
    ProviderWithdrawalRecord,
)


def to_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat().replace("+00:00", "Z")


def decimal_value(value: Any) -> Decimal:
    return Decimal(str(value or "0"))


def optional_decimal_value(value: Any) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


def int_value(value: Any) -> int:
    return int(value or 0)


def pagination(page: int, page_size: int, total: int) -> Pagination:
    total_pages = max(1, (total + page_size - 1) // page_size)
    return Pagination(page=page, page_size=page_size, total=total, total_pages=total_pages)


def owner_filters(
    *,
    q: str | None,
    wallet: str | None,
    email: str | None,
    status: str | None,
) -> tuple[list[str], list[Any]]:
    filters: list[str] = []
    params: list[Any] = []
    if q:
        filters.append("(oa.owner_wallet ILIKE %s OR oa.display_name ILIKE %s OR oa.email ILIKE %s)")
        like = f"%{q.strip()}%"
        params.extend([like, like, like])
    if wallet:
        filters.append("oa.owner_wallet ILIKE %s")
        params.append(f"%{wallet.strip()}%")
    if email:
        filters.append("oa.email ILIKE %s")
        params.append(f"%{email.strip()}%")
    if status:
        filters.append("oa.status = %s")
        params.append(status.strip())
    return filters, params


def deposit_filters(
    wallet: str | None,
    tx_hash: str | None,
    status: str | None,
    date_from: str | None,
    date_to: str | None,
) -> tuple[list[str], list[Any]]:
    filters: list[str] = []
    params: list[Any] = []
    if wallet:
        filters.append("vd.owner_address ILIKE %s")
        params.append(f"%{wallet.strip()}%")
    if tx_hash:
        filters.append("vd.tx_hash ILIKE %s")
        params.append(f"%{tx_hash.strip()}%")
    if status:
        filters.append("vd.status = %s")
        params.append(status.strip())
    if date_from:
        filters.append("vd.created_at >= %s")
        params.append(date_from)
    if date_to:
        filters.append("vd.created_at <= %s")
        params.append(date_to)
    return filters, params


def withdrawal_filters(
    wallet: str | None,
    tx_hash: str | None,
    status: str | None,
    date_from: str | None,
    date_to: str | None,
) -> tuple[list[str], list[Any]]:
    filters: list[str] = []
    params: list[Any] = []
    if wallet:
        filters.append("oa.owner_wallet ILIKE %s")
        params.append(f"%{wallet.strip()}%")
    if tx_hash:
        filters.append("vw.tx_hash ILIKE %s")
        params.append(f"%{tx_hash.strip()}%")
    if status:
        filters.append("vw.status = %s")
        params.append(status.strip())
    if date_from:
        filters.append("vw.created_at >= %s")
        params.append(date_from)
    if date_to:
        filters.append("vw.created_at <= %s")
        params.append(date_to)
    return filters, params


def owner_record(row: dict[str, Any]) -> OwnerAccountRecord:
    roles = ["consumer"]
    if row.get("is_provider"):
        roles.append("provider")
    return OwnerAccountRecord(
        owner_id=str(row.get("owner_id") or ""),
        owner_wallet=str(row.get("owner_wallet") or ""),
        account_name=str(row.get("display_name")) if row.get("display_name") else None,
        email=str(row.get("email")) if row.get("email") else None,
        email_verified=bool(row.get("email_verified")),
        pending_email=str(row.get("pending_email")) if row.get("pending_email") else None,
        status=str(row.get("status") or "active"),
        roles=tuple(roles),
        agent_count=int_value(row.get("agent_count")),
        provider_service_count=int_value(row.get("service_count")),
        support_case_count=int_value(row.get("support_case_count")),
        created_at=to_iso(row.get("created_at")),
        updated_at=to_iso(row.get("updated_at")),
        last_active_at=to_iso(row.get("last_active_at")),
    )


def deposit_record(row: dict[str, Any]) -> ConsumerDepositRecord:
    payload = _payload_object(row.get("meta_payload"))
    credited_at = row.get("updated_at") if row.get("status") == "CONFIRMED" else None
    return ConsumerDepositRecord(
        deposit_id=str(row.get("deposit_id") or ""),
        owner_id=str(row.get("owner_id") or ""),
        owner_wallet=str(row.get("owner_wallet") or row.get("owner_address") or ""),
        owner_email=str(row.get("owner_email")) if row.get("owner_email") else None,
        tx_hash=str(row.get("tx_hash") or ""),
        amount_usdc=decimal_value(row.get("amount_usdc")),
        network=str(payload.get("network")) if payload.get("network") else None,
        status=str(row.get("status") or "PENDING_CONFIRMATION"),
        confirmations=int(payload["confirmations"]) if isinstance(payload.get("confirmations"), int) else None,
        credited_at=to_iso(credited_at),
        created_at=to_iso(row.get("created_at")),
        updated_at=to_iso(row.get("updated_at")),
    )


def withdrawal_record(row: dict[str, Any]) -> ProviderWithdrawalRecord:
    payload = _payload_object(row.get("meta_payload"))
    status = str(row.get("status") or "REQUESTED")
    funds_state = _withdrawal_funds_state(status)
    return ProviderWithdrawalRecord(
        withdrawal_id=str(row.get("withdrawal_id") or ""),
        provider_id=str(row.get("provider_id")) if row.get("provider_id") else None,
        provider_name=str(row.get("provider_name")) if row.get("provider_name") else None,
        owner_id=str(row.get("owner_id") or ""),
        owner_wallet=str(row.get("owner_wallet") or ""),
        owner_email=str(row.get("owner_email")) if row.get("owner_email") else None,
        amount_usdc=decimal_value(row.get("amount_usdc")),
        fee_usdc=optional_decimal_value(payload.get("platformFeeUsdc")),
        status=status,
        tx_hash=str(row.get("tx_hash")) if row.get("tx_hash") else None,
        ticket_id=str(row.get("ticket_id")) if row.get("ticket_id") else None,
        request_id=str(row.get("request_id")) if row.get("request_id") else None,
        review_decision=str(payload.get("reviewDecision")) if payload.get("reviewDecision") else None,
        funds_state=funds_state,
        created_at=to_iso(row.get("created_at")),
        updated_at=to_iso(row.get("updated_at")),
    )


def _payload_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, memoryview):
        value = value.tobytes().decode("utf-8")
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _withdrawal_funds_state(status: str) -> str:
    if status in {"FAILED_EXPIRED", "REJECTED", "CANCELLED"}:
        return "returned"
    if status == "COMPLETED":
        return "claimed"
    return "locked"
