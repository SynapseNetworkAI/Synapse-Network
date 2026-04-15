"""Shared helpers for the balance router sub-modules.

All helper functions and common imports are centralised here so that
balance_deposit.py, balance_withdraw.py, and balance_admin.py can import
from a single location without duplicating code.
"""
from typing import Any, Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request

from src.api.deps import get_balance_service, get_provider_analytics_service
from src.api.schemas.pydantic_models import (
    AdminProviderWithdrawReviewRequest,
    AdminProviderWithdrawCompleteRequest,
    AdminRefundReviewRequest,
    AdminRefundCompleteRequest,
    DepositIntentRequest,
    DepositAttemptRequest,
    DepositConfirmRequest,
    AdminDepositReplayRequest,
    RefundIntentRequest,
    RefundCompleteRequest,
    RefundFailRequest,
    OwnerSpendLimitUpdateRequest,
    VoucherRedeemRequest,
    ProviderWithdrawIntentRequest,
    ProviderWithdrawCompleteRequest,
    TX_HASH_FORMAT_ERROR,
    TX_HASH_PREFIX_ERROR,
)
from src.services.platform.balance_service import BalanceService
from src.services.provider.provider_analytics_service import ProviderAnalyticsService
from src.services.platform import credential_service
from src.services.platform.internal_auth import InternalServicePrincipal, require_internal_scope
from src.services.platform.tasks.deposit_indexer import (
    get_indexer_status,
    replay_deposit_tx,
)
from src.core.common import normalize_wallet
from src.core.config import settings
from src.domain.finance import UsageLogRow
from src.storage import get_storage, BaseStorage

AuthorizationHeader = Annotated[Optional[str], Header(alias="Authorization")]
UserAddressHeader = Annotated[Optional[str], Header(alias="X-User-Address")]


def get_owner_wallet(
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
) -> str:
    return credential_service.require_owner_wallet(authorization, x_user_address)


def _extract_request_meta(request: Request) -> dict[str, Any]:
    client_host = request.client.host if request.client else ""
    return {
        "requestId": request.headers.get("X-Request-Id") or "",
        "clientIp": client_host,
        "userAgent": request.headers.get("User-Agent") or "",
    }


def _normalize_tx_hash_or_400(value: str) -> str:
    normalized = str(value or "").strip().lower()
    if not normalized.startswith("0x"):
        raise HTTPException(
            status_code=400,
            detail={"code": "INVALID_TX_HASH", "message": TX_HASH_PREFIX_ERROR},
        )
    hex_part = normalized[2:]
    if len(hex_part) != 64 or any(ch not in "0123456789abcdef" for ch in hex_part):
        raise HTTPException(
            status_code=400,
            detail={"code": "INVALID_TX_HASH", "message": TX_HASH_FORMAT_ERROR},
        )
    return normalized


def _ensure_fee_policy_admin(owner_wallet: str) -> str:
    owner = normalize_wallet(owner_wallet)
    admins = settings.platform_fee_admin_wallets
    if admins:
        if owner not in admins:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "FORBIDDEN",
                    "message": "Only fee policy admins can access this endpoint",
                },
            )
        return owner

    # Developer fallback stays local-only. Shared staging and prod must
    # always configure an explicit allow-list.
    if str(settings.environment).lower() != "local":
        raise HTTPException(
            status_code=403,
            detail={
                "code": "FEE_ADMIN_NOT_CONFIGURED",
                "message": "PLATFORM_FEE_ADMIN_WALLETS must be configured in non-local environments",
            },
        )
    return owner


def _ensure_indexer_admin(owner_wallet: str) -> str:
    owner = normalize_wallet(owner_wallet)
    admins = set(settings.indexer_admin_wallets)
    if not admins:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "INDEXER_ADMIN_NOT_CONFIGURED",
                "message": "INDEXER_ADMIN_WALLETS (or PLATFORM_FEE_ADMIN_WALLETS) must be configured",
            },
        )
    if owner not in admins:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "FORBIDDEN",
                "message": "Only indexer admins can access this endpoint",
            },
        )
    return owner


def _clamp_rate(value: Any, fallback: Optional[float] = None) -> float:
    if value is None:
        if fallback is None:
            raise ValueError("rate is required")
        return float(fallback)
    try:
        rate = float(value)
    except Exception:
        raise ValueError("rate must be a number")
    if rate < 0 or rate > 1:
        raise ValueError("rate must be within [0,1]")
    return float(rate)


def _usage_log_sort_key(row: UsageLogRow) -> tuple[int, str]:
    return (int(row.ts or 0), str(row.id or ""))


def _usage_log_matches_query(row: UsageLogRow, query: str) -> bool:
    needle = str(query or "").strip().lower()
    if not needle:
        return True
    haystacks = [
        str(row.id or "").lower(),
        str(row.agent_id or "").lower(),
        str(row.request_id or "").lower(),
        str(row.origin_request_id or "").lower(),
        str(row.service_id or "").lower(),
        str(row.consumer_address or "").lower(),
        str(row.provider_address or "").lower(),
        str(row.status or "").lower(),
    ]
    return any(needle in value for value in haystacks if value)


def _normalize_usage_log_rows(raw_rows: Any) -> list[UsageLogRow]:
    rows: list[UsageLogRow] = []
    if not isinstance(raw_rows, list):
        return rows
    for row in raw_rows:
        if isinstance(row, UsageLogRow):
            rows.append(row)
        elif isinstance(row, dict):
            rows.append(UsageLogRow.model_validate(row))
    return rows


def _filter_owner_usage_logs(
    rows: list[UsageLogRow],
    owner_wallet: str,
    status: Optional[str],
    query: Optional[str],
) -> list[UsageLogRow]:
    owner = str(owner_wallet or "").lower()
    normalized_status = str(status or "").strip().lower()
    filtered: list[UsageLogRow] = []
    for row in rows:
        owner_address = str(row.consumer_address or "").lower()
        provider_address = str(row.provider_address or "").lower()
        if owner_address != owner and provider_address != owner:
            continue
        if normalized_status and str(row.status or "").strip().lower() != normalized_status:
            continue
        if not _usage_log_matches_query(row, str(query or "")):
            continue
        filtered.append(row)
    filtered.sort(key=_usage_log_sort_key, reverse=True)
    return filtered


def _build_usage_logs_response(
    rows: list[UsageLogRow],
    *,
    total: int,
    page: int,
    page_size: int,
    has_more: bool,
) -> dict[str, Any]:
    return {
        "status": "success",
        "logs": [row.model_dump(by_alias=True, mode="json") for row in rows],
        "count": len(rows),
        "total": total,
        "page": page,
        "pageSize": page_size,
        "hasMore": has_more,
    }


def _normalize_fee_policy_payload(
    payload: dict[str, Any], default_fallback: float
) -> dict[str, Any]:
    default_rate = _clamp_rate(payload.get("defaultRate"), default_fallback)
    owner_rates_raw = payload.get("ownerRates")
    if owner_rates_raw is None:
        owner_rates_raw = {}
    if not isinstance(owner_rates_raw, dict):
        raise ValueError("ownerRates must be an object")

    owner_rates: dict[str, float] = {}
    for key, value in owner_rates_raw.items():
        owner = normalize_wallet(str(key or ""))
        if not owner:
            raise ValueError("ownerRates contains invalid wallet key")
        owner_rates[owner] = _clamp_rate(value)

    return {
        "defaultRate": default_rate,
        "ownerRates": owner_rates,
    }
