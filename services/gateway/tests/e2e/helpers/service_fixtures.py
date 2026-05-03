"""E2E service fixture policy.

Ordinary E2E paths should reuse canonical provider services. Tests that verify
provider registration may still create temporary services, but those IDs must
match the prefixes below so local cleanup can archive them.
"""
from __future__ import annotations

import os

import httpx

CANONICAL_FIXED_SERVICE_IDS = (
    "svc_web3_sentiment_index",
    "svc_protocol_fundamental_brief",
    "svc_oss_security_healthcheck",
)
CANONICAL_LLM_SERVICE_ID = "svc_deepseek_chat"
DEFAULT_E2E_SERVICE_ID = "svc_oss_security_healthcheck"

TEST_SERVICE_PREFIXES = (
    "api_ref_",
    "apiref_test_",
    "provider_onboard_",
    "llm_",
    "gateway_pull_health_",
    "svc_e2e_",
    "svc_verify_",
    "svc_buyer_",
    "ufc_",
)


def env_bool(name: str, default: bool = False) -> bool:
    value = str(os.getenv(name, "")).strip().lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "on"}


def configured_e2e_service_id() -> str:
    return str(os.getenv("GATEWAY_E2E_SERVICE_ID", DEFAULT_E2E_SERVICE_ID)).strip() or DEFAULT_E2E_SERVICE_ID


def allow_service_creation() -> bool:
    return env_bool("GATEWAY_E2E_ALLOW_SERVICE_CREATION", default=False)


def canonical_provider_required() -> bool:
    return env_bool("GATEWAY_E2E_CANONICAL_PROVIDER_REQUIRED", default=True)


def is_test_service_id(service_id: str | None) -> bool:
    normalized = str(service_id or "").strip()
    if not normalized:
        return False
    if normalized in (*CANONICAL_FIXED_SERVICE_IDS, CANONICAL_LLM_SERVICE_ID):
        return False
    return normalized.startswith(TEST_SERVICE_PREFIXES)


def canonical_missing_message(service_id: str | None = None) -> str:
    wanted = str(service_id or configured_e2e_service_id()).strip()
    return (
        f"Canonical E2E provider service {wanted!r} is not discoverable. "
        "Ordinary E2E no longer creates random provider services by default. "
        "Seed local canonical provider services first with "
        "`services/gateway/examples/register_provider_shelf_services.py` or run the "
        "gateway pull-health local fixture. Set GATEWAY_E2E_ALLOW_SERVICE_CREATION=true "
        "only for a registration-specific fallback."
    )


def discover_service(
    gateway_base: str,
    service_id: str | None = None,
    *,
    token: str | None = None,
    timeout: float = 15.0,
) -> dict | None:
    wanted = str(service_id or configured_e2e_service_id()).strip()
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    candidates = (
        {"q": wanted, "limit": 10},
        {"search_query": wanted, "limit": 10},
        {"limit": 20},
    )
    for params in candidates:
        response = httpx.get(
            f"{gateway_base}/api/v1/services/discover",
            headers=headers,
            params=params,
            timeout=timeout,
        )
        if response.status_code != 200:
            continue
        payload = response.json()
        rows = payload if isinstance(payload, list) else payload.get("services") or payload.get("data") or []
        match = next(
            (
                row
                for row in rows
                if isinstance(row, dict)
                and wanted
                in {
                    str(row.get("serviceId") or ""),
                    str(row.get("service_id") or ""),
                    str(row.get("id") or ""),
                    str(row.get("agentToolName") or ""),
                }
            ),
            None,
        )
        if match:
            return match
    return None


def service_price_usdc(row: dict, default: str = "0.001") -> str:
    pricing = row.get("pricing") if isinstance(row.get("pricing"), dict) else {}
    return str(
        row.get("basePriceUsdc")
        or row.get("priceUsdc")
        or row.get("unitPrice")
        or pricing.get("amount")
        or default
    )
