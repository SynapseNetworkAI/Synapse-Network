"""E2E service fixture policy.

Local/staging Gateway E2E must consume the Synapse-Network-Provider catalog.
They must not create fallback providers, register temporary services, or start
an in-process mock provider as the business service under test.
"""
from __future__ import annotations

import os
import time

import httpx

CANONICAL_FREE_SERVICE_ID = "svc_synapse_echo"
CANONICAL_PAID_SERVICE_ID = "svc_synapse_mock_cost_1usdc"

CANONICAL_FIXED_SERVICE_IDS = (
    CANONICAL_FREE_SERVICE_ID,
    CANONICAL_PAID_SERVICE_ID,
    "svc_web3_sentiment_index",
    "svc_protocol_fundamental_brief",
    "svc_oss_security_healthcheck",
)
CANONICAL_LLM_SERVICE_ID = "svc_deepseek_chat"
CANONICAL_PROVIDER_SERVICE_IDS = (*CANONICAL_FIXED_SERVICE_IDS, CANONICAL_LLM_SERVICE_ID)
DEFAULT_E2E_SERVICE_ID = CANONICAL_PAID_SERVICE_ID

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
    """Service creation fallback is disabled for local/staging E2E."""
    return False


def canonical_provider_required() -> bool:
    return env_bool("GATEWAY_E2E_CANONICAL_PROVIDER_REQUIRED", default=True)


def is_test_service_id(service_id: str | None) -> bool:
    normalized = str(service_id or "").strip()
    if not normalized:
        return False
    if normalized in CANONICAL_PROVIDER_SERVICE_IDS:
        return False
    return normalized.startswith(TEST_SERVICE_PREFIXES)


def canonical_missing_message(service_id: str | None = None) -> str:
    wanted = str(service_id or configured_e2e_service_id()).strip()
    return (
        f"Canonical E2E provider service {wanted!r} is not discoverable. "
        "Gateway local/staging E2E does not create fallback services. "
        "Run Synapse-Network-Provider onboarding `check`/`ensure` for local or "
        "staging, then rerun the Gateway E2E."
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
    deadline = time.monotonic() + max(0.1, float(timeout))
    while time.monotonic() < deadline:
        for params in candidates:
            remaining = max(0.1, deadline - time.monotonic())
            response = httpx.get(
                f"{gateway_base}/api/v1/services/discover",
                headers=headers,
                params=params,
                timeout=remaining,
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
        time.sleep(0.5)
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


def canonical_invoke_payload(service_id: str | None) -> dict:
    """Return a schema-valid payload for canonical provider services."""
    normalized = str(service_id or "").strip()
    if normalized == CANONICAL_FREE_SERVICE_ID:
        return {
            "message": "synapse gateway e2e smoke",
            "source": "gateway-e2e",
        }
    if normalized == CANONICAL_PAID_SERVICE_ID:
        return {
            "message": "synapse gateway paid settlement e2e",
            "source": "gateway-e2e",
        }
    if normalized == "svc_oss_security_healthcheck":
        return {
            "repoUrl": "https://github.com/SynapseNetworkAI/Synapse-Network",
            "packageList": ["next", "react", "fumadocs-ui"],
            "ecosystem": "npm",
        }
    if normalized == "svc_web3_sentiment_index":
        return {
            "symbol": "ETH",
            "chain": "arbitrum",
            "lookback_hours": 24,
            "include_narrative": True,
        }
    if normalized == "svc_protocol_fundamental_brief":
        return {
            "protocol": "uniswap",
            "chain": "arbitrum",
            "peer_set": ["aave", "curve"],
            "lookback_days": 30,
        }
    if normalized == CANONICAL_LLM_SERVICE_ID:
        return {
            "messages": [
                {"role": "user", "content": "Reply with Synapse E2E ok."}
            ],
            "stream": False,
        }
    return {"prompt": "e2e automated test invocation"}
