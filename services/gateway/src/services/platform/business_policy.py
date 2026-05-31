from __future__ import annotations

import time
from copy import deepcopy
from dataclasses import dataclass
from decimal import Decimal
from threading import Lock
from typing import Any

from src.core.config import settings
from src.storage import BaseStorage
from src.utils.money import MoneyCodec, parse_usdc


BUSINESS_POLICY_CACHE_TTL_SEC = 30.0


@dataclass(slots=True, frozen=True)
class BusinessPolicySnapshot:
    payload: dict[str, Any]
    source: str
    published_version: int
    updated_at: str | None
    updated_by: str | None


_CACHE_LOCK = Lock()
_CACHE_BY_STORAGE_ID: dict[int, tuple[float, BusinessPolicySnapshot]] = {}


def build_default_business_policy_payload() -> dict[str, Any]:
    return {
        "finance": {
            "platformFeeRate": MoneyCodec.quantize_usdc(Decimal(str(settings.platform_fee_rate))).to_eng_string(),
            "gatewayRoutingTaxUsdc": MoneyCodec.quantize_usdc(Decimal(str(settings.gateway_routing_tax))).to_eng_string(),
            "consumerWithdrawFeeUsdc": parse_usdc(
                Decimal("0.50")
            ).to_eng_string(),
            "consumerDepositMinUsdc": parse_usdc(Decimal("5.0")).to_eng_string(),
        },
        "consumerWithdraw": {
            "minUsdc": parse_usdc(
                Decimal("10.0")
            ).to_eng_string(),
            "manualReviewThresholdUsdc": parse_usdc(
                Decimal("500.0")
            ).to_eng_string(),
            "maxDailyCount": 3,
            "maturitySeconds": int(settings.consumer_withdraw_maturity_seconds),
        },
        "risk": {
            "withdrawalAutoSingleLimitUsdc": parse_usdc(
                Decimal(str(settings.withdrawal_auto_single_limit_usdc))
            ).to_eng_string(),
            "withdrawalAuto24hLimitUsdc": parse_usdc(
                Decimal(str(settings.withdrawal_auto_24h_limit_usdc))
            ).to_eng_string(),
            "withdrawalWindowHours": int(settings.withdrawal_window_hours),
        },
        "reconciliation": {
            "alertDeltaUsdc": parse_usdc(
                Decimal(str(settings.v2_reconciliation_alert_delta_usdc))
            ).to_eng_string(),
        },
    }


def _normalize_money(value: Any, fallback: str) -> str:
    try:
        return parse_usdc(Decimal(str(value))).to_eng_string()
    except Exception:
        return fallback


def _normalize_non_negative_int(value: Any, fallback: int, *, minimum: int = 0) -> int:
    try:
        resolved = int(value)
    except Exception:
        return fallback
    return max(minimum, resolved)


def normalize_business_policy_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    default_payload = build_default_business_policy_payload()
    source = payload if isinstance(payload, dict) else {}
    finance = source.get("finance") if isinstance(source.get("finance"), dict) else {}
    consumer_withdraw = (
        source.get("consumerWithdraw")
        if isinstance(source.get("consumerWithdraw"), dict)
        else {}
    )
    risk = source.get("risk") if isinstance(source.get("risk"), dict) else {}
    reconciliation = (
        source.get("reconciliation")
        if isinstance(source.get("reconciliation"), dict)
        else {}
    )

    return {
        "finance": {
            "platformFeeRate": _normalize_money(
                finance.get("platformFeeRate"),
                default_payload["finance"]["platformFeeRate"],
            ),
            "gatewayRoutingTaxUsdc": _normalize_money(
                finance.get("gatewayRoutingTaxUsdc"),
                default_payload["finance"]["gatewayRoutingTaxUsdc"],
            ),
            "consumerWithdrawFeeUsdc": _normalize_money(
                finance.get("consumerWithdrawFeeUsdc"),
                default_payload["finance"]["consumerWithdrawFeeUsdc"],
            ),
            "consumerDepositMinUsdc": _normalize_money(
                finance.get("consumerDepositMinUsdc"),
                default_payload["finance"]["consumerDepositMinUsdc"],
            ),
        },
        "consumerWithdraw": {
            "minUsdc": _normalize_money(
                consumer_withdraw.get("minUsdc"),
                default_payload["consumerWithdraw"]["minUsdc"],
            ),
            "manualReviewThresholdUsdc": _normalize_money(
                consumer_withdraw.get("manualReviewThresholdUsdc"),
                default_payload["consumerWithdraw"]["manualReviewThresholdUsdc"],
            ),
            "maxDailyCount": _normalize_non_negative_int(
                consumer_withdraw.get("maxDailyCount"),
                int(default_payload["consumerWithdraw"]["maxDailyCount"]),
                minimum=1,
            ),
            "maturitySeconds": _normalize_non_negative_int(
                consumer_withdraw.get("maturitySeconds"),
                int(default_payload["consumerWithdraw"]["maturitySeconds"]),
            ),
        },
        "risk": {
            "withdrawalAutoSingleLimitUsdc": _normalize_money(
                risk.get("withdrawalAutoSingleLimitUsdc"),
                default_payload["risk"]["withdrawalAutoSingleLimitUsdc"],
            ),
            "withdrawalAuto24hLimitUsdc": _normalize_money(
                risk.get("withdrawalAuto24hLimitUsdc"),
                default_payload["risk"]["withdrawalAuto24hLimitUsdc"],
            ),
            "withdrawalWindowHours": _normalize_non_negative_int(
                risk.get("withdrawalWindowHours"),
                int(default_payload["risk"]["withdrawalWindowHours"]),
                minimum=1,
            ),
        },
        "reconciliation": {
            "alertDeltaUsdc": _normalize_money(
                reconciliation.get("alertDeltaUsdc"),
                default_payload["reconciliation"]["alertDeltaUsdc"],
            ),
        },
    }


def validate_business_policy_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    normalized = normalize_business_policy_payload(payload)
    platform_fee_rate = Decimal(normalized["finance"]["platformFeeRate"])
    if platform_fee_rate < Decimal("0") or platform_fee_rate > Decimal("1"):
        raise ValueError("platformFeeRate must be within [0, 1]")
    if Decimal(normalized["finance"]["consumerWithdrawFeeUsdc"]) >= Decimal(
        normalized["consumerWithdraw"]["manualReviewThresholdUsdc"]
    ):
        raise ValueError(
            "consumerWithdrawFeeUsdc must be lower than manualReviewThresholdUsdc"
        )
    if (
        str(settings.environment).lower() == "prod"
        and int(normalized["consumerWithdraw"]["maturitySeconds"]) <= 0
    ):
        raise ValueError("consumer withdraw maturitySeconds must remain enabled in prod")
    return normalized


def _build_fallback_snapshot() -> BusinessPolicySnapshot:
    return BusinessPolicySnapshot(
        payload=build_default_business_policy_payload(),
        source="default",
        published_version=1,
        updated_at=None,
        updated_by=None,
    )


def load_business_policy_snapshot(storage: BaseStorage) -> BusinessPolicySnapshot:
    repo = getattr(storage.get_data_manager().finance, "business_policy", None)
    if repo is None:
        return _build_fallback_snapshot()
    try:
        row = repo.get_business_policy_config()
    except Exception:
        return _build_fallback_snapshot()
    if row is None:
        return _build_fallback_snapshot()
    try:
        payload = validate_business_policy_payload(dict(row.payload or {}))
    except Exception:
        return BusinessPolicySnapshot(
            payload=build_default_business_policy_payload(),
            source="default",
            published_version=max(1, int(row.published_version or 1)),
            updated_at=row.updated_at,
            updated_by=row.updated_by,
        )
    return BusinessPolicySnapshot(
        payload=payload,
        source="database_published",
        published_version=max(1, int(row.published_version or 1)),
        updated_at=row.updated_at,
        updated_by=row.updated_by,
    )


def get_business_policy_snapshot(storage: BaseStorage) -> BusinessPolicySnapshot:
    storage_id = id(storage)
    now = time.monotonic()
    with _CACHE_LOCK:
        cached = _CACHE_BY_STORAGE_ID.get(storage_id)
        if cached and now - cached[0] < BUSINESS_POLICY_CACHE_TTL_SEC:
            return cached[1]
    snapshot = load_business_policy_snapshot(storage)
    with _CACHE_LOCK:
        _CACHE_BY_STORAGE_ID[storage_id] = (now, snapshot)
    return snapshot


def clear_business_policy_cache(storage: BaseStorage | None = None) -> None:
    with _CACHE_LOCK:
        if storage is None:
            _CACHE_BY_STORAGE_ID.clear()
            return
        _CACHE_BY_STORAGE_ID.pop(id(storage), None)


def publish_business_policy_snapshot(
    storage: BaseStorage,
    *,
    payload: dict[str, Any],
    published_version: int,
    updated_by: str,
    updated_at: str | int,
) -> BusinessPolicySnapshot:
    normalized = validate_business_policy_payload(payload)
    repo = getattr(storage.get_data_manager().finance, "business_policy", None)
    if repo is None:
        raise RuntimeError("BUSINESS_POLICY_REPOSITORY_UNAVAILABLE")
    row = repo.set_business_policy_config(
        payload=normalized,
        published_version=published_version,
        updated_by=updated_by,
        updated_at=updated_at,
    )
    clear_business_policy_cache(storage)
    return BusinessPolicySnapshot(
        payload=deepcopy(normalized),
        source="database_published",
        published_version=max(1, int(row.published_version or published_version)),
        updated_at=row.updated_at,
        updated_by=row.updated_by,
    )


def _money_from_snapshot(snapshot: BusinessPolicySnapshot, *keys: str) -> Decimal:
    value: Any = snapshot.payload
    for key in keys:
        if not isinstance(value, dict):
            return Decimal("0")
        value = value.get(key)
    return parse_usdc(Decimal(str(value or "0")))


def consumer_withdraw_fee_amount(storage: BaseStorage) -> Decimal:
    return _money_from_snapshot(get_business_policy_snapshot(storage), "finance", "consumerWithdrawFeeUsdc")


def consumer_withdraw_min_amount(storage: BaseStorage) -> Decimal:
    return _money_from_snapshot(get_business_policy_snapshot(storage), "consumerWithdraw", "minUsdc")


def consumer_withdraw_manual_review_threshold(storage: BaseStorage) -> Decimal:
    return _money_from_snapshot(
        get_business_policy_snapshot(storage),
        "consumerWithdraw",
        "manualReviewThresholdUsdc",
    )


def consumer_withdraw_max_daily_count(storage: BaseStorage) -> int:
    snapshot = get_business_policy_snapshot(storage)
    return int(snapshot.payload["consumerWithdraw"]["maxDailyCount"])


def consumer_withdraw_maturity_seconds(storage: BaseStorage) -> int:
    snapshot = get_business_policy_snapshot(storage)
    return int(snapshot.payload["consumerWithdraw"]["maturitySeconds"])


def withdrawal_auto_single_limit(storage: BaseStorage) -> Decimal:
    return _money_from_snapshot(
        get_business_policy_snapshot(storage), "risk", "withdrawalAutoSingleLimitUsdc"
    )


def withdrawal_auto_24h_limit(storage: BaseStorage) -> Decimal:
    return _money_from_snapshot(
        get_business_policy_snapshot(storage), "risk", "withdrawalAuto24hLimitUsdc"
    )


def withdrawal_window_hours(storage: BaseStorage) -> int:
    snapshot = get_business_policy_snapshot(storage)
    return int(snapshot.payload["risk"]["withdrawalWindowHours"])


def platform_fee_rate_decimal(storage: BaseStorage) -> Decimal:
    return _money_from_snapshot(get_business_policy_snapshot(storage), "finance", "platformFeeRate")


def gateway_routing_tax_decimal(storage: BaseStorage) -> Decimal:
    return _money_from_snapshot(get_business_policy_snapshot(storage), "finance", "gatewayRoutingTaxUsdc")


def reconciliation_alert_delta(storage: BaseStorage) -> Decimal:
    return _money_from_snapshot(get_business_policy_snapshot(storage), "reconciliation", "alertDeltaUsdc")


def build_env_config_summary() -> dict[str, dict[str, object]]:
    return {
        "infra": {
            "rpcUrl": {"source": "env", "configured": bool(settings.rpc_url)},
            "postgresDsn": {"source": "env", "configured": bool(settings.postgres_dsn)},
            "withdrawSignerMode": {
                "source": "env",
                "value": str(settings.withdraw_signer_mode or ""),
            },
            "withdrawSignerGcpKmsKeyName": {
                "source": "env",
                "configured": bool(settings.withdraw_signer_gcp_kms_key_name),
            },
            "alchemyDepositWebhookEnabled": {
                "source": "env",
                "value": bool(settings.alchemy_deposit_webhook_enabled),
            },
            "alchemyDepositWebhookSigningKey": {
                "source": "secret_manager_env",
                "configured": bool(settings.alchemy_deposit_webhook_signing_key),
            },
            "depositIndexerTriggerUrl": {
                "source": "env",
                "configured": bool(settings.deposit_indexer_trigger_url),
            },
        }
    }
