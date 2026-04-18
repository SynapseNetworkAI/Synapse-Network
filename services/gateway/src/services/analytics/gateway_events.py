"""
Centralized gateway analytics event helpers.

Module-level emitter reference set during app startup. All gateway business
logic should emit analytics events through this module instead of directly
importing the emitter.

Usage:
    from src.services.analytics.gateway_events import emit_invoke_completed
    await emit_invoke_completed(wallet, service_id=..., ...)
"""
from __future__ import annotations

import logging
import os
from decimal import Decimal
from typing import Any, Optional

from src.services.analytics.emitter import AnalyticsEmitter
from src.services.analytics.privacy import sha256_hash
from src.utils.money import money_str

logger = logging.getLogger("synapse.analytics.gateway")

# Module-level emitter reference, set by app.py lifespan.
_emitter: Optional[AnalyticsEmitter] = None


def set_emitter(emitter: AnalyticsEmitter) -> None:
    """Called once during app startup to wire the emitter."""
    global _emitter
    _emitter = emitter


def get_emitter() -> Optional[AnalyticsEmitter]:
    return _emitter


def _money(value: Decimal | str | int | None) -> str:
    return money_str(value)


async def _emit(
    event_name: str,
    wallet_address: str,
    *,
    role: str = "consumer",
    surface: str = "gateway_api",
    source: str = "gateway",
    correlation_id: Optional[str] = None,
    extra: Optional[dict[str, Any]] = None,
) -> None:
    """Fire-and-forget emit. Silently no-ops if emitter not configured."""
    if _emitter is None:
        return
    props: dict[str, Any] = {
        "role": role,
        "surface": surface,
        "env": os.getenv("ENVIRONMENT", "local"),
        **(extra or {}),
    }
    try:
        await _emitter.emit(
            event_name=event_name,
            distinct_id=sha256_hash(wallet_address),
            properties=props,
            source=source,
            correlation_id=correlation_id,
        )
    except Exception:
        logger.debug("gateway analytics emit failed: %s", event_name, exc_info=True)


# ── Invoke lifecycle ────────────────────────────────────────────

async def emit_quote_generated(
    wallet_address: str,
    *,
    service_id: str,
    quote_id: str,
    price_usdc: Decimal | str | int,
    correlation_id: Optional[str] = None,
) -> None:
    await _emit(
        "quote_generated", wallet_address,
        correlation_id=correlation_id,
        extra={
            "service_id": service_id,
            "quote_id": quote_id,
            "price_usdc": _money(price_usdc),
        },
    )


async def emit_invoke_completed(
    wallet_address: str,
    *,
    service_id: str,
    provider_address: str,
    quote_id: str,
    price_usdc: Decimal | str | int,
    latency_ms: int,
    is_first_invoke: bool = False,
    correlation_id: Optional[str] = None,
) -> None:
    await _emit(
        "invoke_completed", wallet_address,
        correlation_id=correlation_id,
        extra={
            "service_id": service_id,
            "provider_id": sha256_hash(provider_address),
            "quote_id": quote_id,
            "price_usdc": _money(price_usdc),
            "latency_ms": latency_ms,
            "is_first_invoke": is_first_invoke,
        },
    )


async def emit_invoke_started(
    wallet_address: str,
    *,
    service_id: str,
    provider_address: str,
    quote_id: str,
    price_usdc: Decimal | str | int,
    correlation_id: Optional[str] = None,
) -> None:
    await _emit(
        "invoke_started", wallet_address,
        correlation_id=correlation_id,
        extra={
            "service_id": service_id,
            "provider_id": sha256_hash(provider_address),
            "quote_id": quote_id,
            "price_usdc": _money(price_usdc),
        },
    )


async def emit_invoke_failed(
    wallet_address: str,
    *,
    service_id: str,
    provider_address: str,
    quote_id: str,
    error_code: Optional[str] = None,
    failure_stage: str = "upstream",
    correlation_id: Optional[str] = None,
) -> None:
    await _emit(
        "invoke_failed", wallet_address,
        correlation_id=correlation_id,
        extra={
            "service_id": service_id,
            "provider_id": sha256_hash(provider_address),
            "quote_id": quote_id,
            "error_code": error_code or "UNKNOWN",
            "failure_stage": failure_stage,
        },
    )


# ── Budget ──────────────────────────────────────────────────────

async def emit_budget_blocked(
    wallet_address: str,
    *,
    service_id: str,
    required_usdc: Decimal | str | int,
    available_usdc: Optional[Decimal | str | int],
    error_code: str,
    correlation_id: Optional[str] = None,
) -> None:
    await _emit(
        "budget_blocked", wallet_address,
        correlation_id=correlation_id,
        extra={
            "service_id": service_id,
            "required_usdc": _money(required_usdc),
            "available_usdc": _money(available_usdc),
            "error_code": error_code,
        },
    )


# ── Deposit ─────────────────────────────────────────────────────

async def emit_deposit_completed(
    wallet_address: str,
    *,
    amount_usdc: Decimal | str | int,
    tx_hash: str,
    token_symbol: str = "USDC",
    time_to_confirm_ms: Optional[int] = None,
) -> None:
    extra: dict[str, Any] = {
        "amount_usdc": _money(amount_usdc),
        "token_symbol": token_symbol,
        "tx_hash": tx_hash,
        "time_to_confirm_ms": int(time_to_confirm_ms or 0),
    }
    await _emit("deposit_completed", wallet_address, extra=extra)


async def emit_deposit_failed(
    wallet_address: str,
    *,
    amount_usdc: Decimal | str | int,
    error_code: str,
) -> None:
    await _emit(
        "deposit_failed", wallet_address,
        extra={"amount_usdc": _money(amount_usdc), "error_code": error_code},
    )


# ── Provider revenue ───────────────────────────────────────────

async def emit_provider_first_revenue_received(
    provider_address: str,
    *,
    service_id: str,
    gross_usdc: Decimal | str | int,
    time_since_listing_ms: Optional[int] = None,
    correlation_id: Optional[str] = None,
) -> None:
    """Emit once when a provider receives their very first payment.

    This is a milestone activation event distinct from the recurring
    ``provider_revenue_received`` event. Callers are responsible for
    detecting the first-revenue condition (e.g., by checking whether the
    provider has any prior settled invoices before calling this helper).
    """
    extra: dict[str, Any] = {
        "provider_id": sha256_hash(provider_address),
        "service_id": service_id,
        "gross_usdc": _money(gross_usdc),
        "is_first_revenue": True,
    }
    if time_since_listing_ms is not None:
        extra["time_since_listing_ms"] = time_since_listing_ms
    await _emit(
        "provider_first_revenue_received", provider_address,
        role="provider",
        correlation_id=correlation_id,
        extra=extra,
    )


async def emit_provider_revenue_received(
    provider_address: str,
    *,
    service_id: str,
    gross_usdc: Decimal | str | int,
    platform_fee_usdc: Decimal | str | int,
    provider_net_usdc: Decimal | str | int,
    correlation_id: Optional[str] = None,
) -> None:
    await _emit(
        "provider_revenue_received", provider_address,
        role="provider",
        correlation_id=correlation_id,
        extra={
            "provider_id": sha256_hash(provider_address),
            "service_id": service_id,
            "gross_usdc": _money(gross_usdc),
            "platform_fee_usdc": _money(platform_fee_usdc),
            "provider_net_usdc": _money(provider_net_usdc),
        },
    )


# ── Withdrawal / settlement ────────────────────────────────────

async def emit_withdrawal_completed(
    wallet_address: str,
    *,
    amount_usdc: Decimal | str | int,
    tx_hash: str,
    role: str = "consumer",
    time_to_confirm_ms: Optional[int] = None,
) -> None:
    extra: dict[str, Any] = {
        "amount_usdc": _money(amount_usdc),
        "tx_hash": tx_hash,
    }
    if time_to_confirm_ms is not None:
        extra["time_to_confirm_ms"] = time_to_confirm_ms
    await _emit("withdrawal_completed", wallet_address, role=role, extra=extra)


async def emit_settlement_claim_requested(
    provider_address: str,
    *,
    claim_usdc: Decimal | str | int,
) -> None:
    await _emit(
        "settlement_claim_requested", provider_address,
        role="provider",
        extra={
            "provider_id": sha256_hash(provider_address),
            "claim_usdc": _money(claim_usdc),
        },
    )


async def emit_settlement_claim_completed(
    provider_address: str,
    *,
    claim_usdc: Decimal | str | int,
    tx_hash: str,
) -> None:
    await _emit(
        "settlement_claim_completed", provider_address,
        role="provider",
        extra={
            "provider_id": sha256_hash(provider_address),
            "claim_usdc": _money(claim_usdc),
            "tx_hash": tx_hash,
        },
    )


# ── Refund ──────────────────────────────────────────────────────

async def emit_refund_completed(
    wallet_address: str,
    *,
    amount_usdc: Decimal | str | int,
    reason_code: str = "",
    service_id: str = "",
    tx_hash: str = "",
) -> None:
    await _emit(
        "refund_completed", wallet_address,
        extra={
            "amount_usdc": _money(amount_usdc),
            "reason_code": reason_code,
            "service_id": service_id,
            "tx_hash": tx_hash,
        },
    )


# ── Service registration ────────────────────────────────────────

async def emit_service_registered(
    provider_address: str,
    *,
    service_id: str,
    service_name: str = "",
    correlation_id: Optional[str] = None,
) -> None:
    """Emit when a provider successfully registers a new service."""
    await _emit(
        "service_registered", provider_address,
        role="provider",
        correlation_id=correlation_id,
        extra={
            "provider_id": sha256_hash(provider_address),
            "service_id": service_id,
            "service_name": service_name,
        },
    )


async def emit_service_register_failed(
    provider_address: str,
    *,
    error_code: str,
    service_name: str = "",
    reason: str = "",
    correlation_id: Optional[str] = None,
) -> None:
    """Emit when a provider's service registration attempt fails."""
    extra: dict[str, Any] = {
        "provider_id": sha256_hash(provider_address),
        "error_code": error_code,
        "service_name": service_name,
    }
    if reason:
        extra["reason"] = reason
    await _emit(
        "service_register_failed", provider_address,
        role="provider",
        correlation_id=correlation_id,
        extra=extra,
    )


# ── Provider health ─────────────────────────────────────────────

async def emit_provider_health_degraded(
    provider_address: str,
    *,
    service_id: str,
    healthy_targets: int,
    total_targets: int,
    overall_status: str = "degraded",
    correlation_id: Optional[str] = None,
) -> None:
    """Emit when a provider service's health drops below fully-healthy."""
    await _emit(
        "provider_health_degraded", provider_address,
        role="provider",
        correlation_id=correlation_id,
        extra={
            "provider_id": sha256_hash(provider_address),
            "service_id": service_id,
            "healthy_targets": healthy_targets,
            "total_targets": total_targets,
            "overall_status": overall_status,
        },
    )


async def emit_provider_health_recovered(
    provider_address: str,
    *,
    service_id: str,
    healthy_targets: int,
    total_targets: int,
    correlation_id: Optional[str] = None,
) -> None:
    """Emit when a provider service returns to a healthy runtime state."""
    await _emit(
        "provider_health_recovered", provider_address,
        role="provider",
        correlation_id=correlation_id,
        extra={
            "provider_id": sha256_hash(provider_address),
            "service_id": service_id,
            "healthy_targets": healthy_targets,
            "total_targets": total_targets,
            "overall_status": "healthy",
        },
    )


async def emit_provider_health_outage(
    provider_address: str,
    *,
    service_id: str,
    healthy_targets: int,
    total_targets: int,
    outage_age_ms: int,
    correlation_id: Optional[str] = None,
) -> None:
    """Emit when a provider service stays unhealthy past the outage window."""
    await _emit(
        "provider_health_outage", provider_address,
        role="provider",
        correlation_id=correlation_id,
        extra={
            "provider_id": sha256_hash(provider_address),
            "service_id": service_id,
            "healthy_targets": healthy_targets,
            "total_targets": total_targets,
            "overall_status": "unhealthy",
            "outage_age_ms": outage_age_ms,
        },
    )


# ── Risk ────────────────────────────────────────────────────────

async def emit_risk_rule_triggered(
    wallet_address: str,
    *,
    rule_code: str,
    surface: str = "gateway_api",
    severity: str = "warning",
) -> None:
    await _emit(
        "risk_rule_triggered", wallet_address,
        extra={
            "rule_code": rule_code,
            "surface": surface,
            "severity": severity,
        },
    )
