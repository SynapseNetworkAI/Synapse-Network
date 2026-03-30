import json
import os
from typing import Any

import requests

CONTENT_TYPE_JSON = "application/json"


def require_env(name: str) -> str:
    value = str(os.getenv(name, "")).strip()
    if not value:
        raise ValueError(f"Missing required environment variable: {name}")
    return value


def env_bool(name: str, default: bool = False) -> bool:
    value = str(os.getenv(name, "")).strip().lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "on"}


def provider_service_url(base_url: str, slug: str) -> str:
    return f"{base_url.rstrip('/')}/provider-services/{slug}/invoke"


def common_response_schema() -> dict[str, Any]:
    return {
        "body": {
            "type": "object",
            "required": ["service", "freshness", "result", "errors"],
            "properties": {
                "service": {"type": "object"},
                "freshness": {"type": "object"},
                "result": {"type": "object"},
                "errors": {"type": "array"},
            },
        }
    }


def common_registration_fields(
    *,
    display_name: str,
    payout_address: str,
    payout_chain_id: int,
) -> dict[str, Any]:
    return {
        "role": "Provider",
        "status": "active",
        "isActive": True,
        "auth": {"type": "gateway_signed"},
        "providerProfile": {"displayName": display_name},
        "payoutAccount": {
            "payoutAddress": payout_address,
            "chainId": payout_chain_id,
            "settlementCurrency": "USDC",
        },
        "governance": {
            "termsAccepted": True,
            "riskAcknowledged": True,
            "note": "Seeded from gateway/examples/register_provider_shelf_services.py",
        },
        "healthCheck": {
            "path": "/health",
            "method": "GET",
            "timeoutMs": 3000,
            "successCodes": [200],
            "healthyThreshold": 2,
            "unhealthyThreshold": 3,
        },
    }


def build_registration_payloads(
    *,
    provider_base_url: str,
    display_name: str,
    payout_address: str,
    payout_chain_id: int,
) -> list[dict[str, Any]]:
    shared = common_registration_fields(
        display_name=display_name,
        payout_address=payout_address,
        payout_chain_id=payout_chain_id,
    )
    return [
        {
            **shared,
            "agentToolName": "svc_web3_sentiment_index",
            "serviceName": "Web3 Sentiment Index",
            "pricing": {"amount": "0.01", "currency": "USDC"},
            "summary": "Return a structured crypto market sentiment score with trend, volatility, and concise reasoning.",
            "tags": ["web3", "sentiment", "market-intelligence"],
            "constraints": {
                "timeoutMs": 8000,
                "maxResponseBytes": 131072,
                "maxRequestBytes": 65536,
                "maxQps": 20,
            },
            "invoke": {
                "method": "POST",
                "targets": [
                    {
                        "url": provider_service_url(
                            provider_base_url, "web3-sentiment-index"
                        ),
                        "weight": 100,
                    }
                ],
                "timeoutMs": 8000,
                "request": {
                    "contentType": CONTENT_TYPE_JSON,
                    "schema": {
                        "body": {
                            "type": "object",
                            "required": ["symbol"],
                            "properties": {
                                "symbol": {"type": "string"},
                                "chain": {"type": "string"},
                                "lookback_hours": {"type": "integer"},
                                "include_narrative": {"type": "boolean"},
                            },
                        }
                    },
                },
                "response": {
                    "contentType": CONTENT_TYPE_JSON,
                    "schema": common_response_schema(),
                },
                "examples": [
                    {
                        "input": {
                            "symbol": "ETH",
                            "chain": "ethereum",
                            "lookback_hours": 24,
                            "include_narrative": True,
                        }
                    }
                ],
            },
        },
        {
            **shared,
            "agentToolName": "svc_smart_contract_audit",
            "serviceName": "Smart Contract Audit Model",
            "pricing": {"amount": "0.50", "currency": "USDC"},
            "summary": "Analyze a Solidity contract address or source bundle and return structured findings, risk score, and fix suggestions.",
            "tags": ["security", "smart-contract", "audit"],
            "constraints": {
                "timeoutMs": 30000,
                "maxResponseBytes": 524288,
                "maxRequestBytes": 5242880,
                "maxQps": 10,
            },
            "invoke": {
                "method": "POST",
                "targets": [
                    {
                        "url": provider_service_url(
                            provider_base_url, "smart-contract-audit"
                        ),
                        "weight": 100,
                    }
                ],
                "timeoutMs": 30000,
                "request": {
                    "contentType": CONTENT_TYPE_JSON,
                    "schema": {
                        "body": {
                            "type": "object",
                            "properties": {
                                "contract_address": {"type": "string"},
                                "chain": {"type": "string"},
                                "source_bundle": {"type": "string"},
                                "analysis_depth": {"type": "string"},
                                "include_evidence": {"type": "boolean"},
                            },
                        }
                    },
                },
                "response": {
                    "contentType": CONTENT_TYPE_JSON,
                    "schema": common_response_schema(),
                },
                "examples": [
                    {
                        "input": {
                            "source_bundle": "pragma solidity ^0.8.20; contract Demo { function exec(address target, bytes calldata data) external { (bool ok, ) = target.delegatecall(data); require(ok); } }",
                            "analysis_depth": "standard",
                            "include_evidence": True,
                        }
                    }
                ],
            },
        },
        {
            **shared,
            "agentToolName": "svc_whale_flow_monitor",
            "serviceName": "Whale Flow Monitor",
            "pricing": {"amount": "0.10", "currency": "USDC"},
            "summary": "Monitor large on-chain token movements and return structured whale events, wallet tags, and estimated market impact.",
            "tags": ["web3", "onchain", "flow-monitoring"],
            "constraints": {
                "timeoutMs": 12000,
                "maxResponseBytes": 262144,
                "maxRequestBytes": 131072,
                "maxQps": 20,
            },
            "invoke": {
                "method": "POST",
                "targets": [
                    {
                        "url": provider_service_url(
                            provider_base_url, "whale-flow-monitor"
                        ),
                        "weight": 100,
                    }
                ],
                "timeoutMs": 12000,
                "request": {
                    "contentType": CONTENT_TYPE_JSON,
                    "schema": {
                        "body": {
                            "type": "object",
                            "required": ["token", "chain"],
                            "properties": {
                                "token": {"type": "string"},
                                "chain": {"type": "string"},
                                "window_minutes": {"type": "integer"},
                                "min_usd_value": {"type": "number"},
                                "limit": {"type": "integer"},
                            },
                        }
                    },
                },
                "response": {
                    "contentType": CONTENT_TYPE_JSON,
                    "schema": common_response_schema(),
                },
                "examples": [
                    {
                        "input": {
                            "token": "ETH",
                            "chain": "ethereum",
                            "window_minutes": 60,
                            "min_usd_value": 100000,
                            "limit": 10,
                        }
                    }
                ],
            },
        },
    ]


def registration_headers(owner_address: str, bearer_token: str) -> dict[str, str]:
    return {
        "Content-Type": CONTENT_TYPE_JSON,
        "Authorization": f"Bearer {bearer_token}",
        "X-User-Address": owner_address,
    }


def register_service(
    api_base: str, headers: dict[str, str], payload: dict[str, Any]
) -> dict[str, Any]:
    response = requests.post(
        f"{api_base.rstrip('/')}/api/v1/services",
        headers=headers,
        json=payload,
        timeout=30,
    )
    try:
        body = response.json()
    except Exception:
        body = {"raw": response.text}
    return {
        "ok": response.ok,
        "statusCode": response.status_code,
        "body": body,
    }


def main() -> None:
    api_base = require_env("SYNAPSE_GATEWAY_API_BASE")
    owner_address = require_env("SYNAPSE_OWNER_ADDRESS")
    bearer_token = require_env("SYNAPSE_OWNER_BEARER_TOKEN")
    provider_base_url = str(
        os.getenv("SYNAPSE_PROVIDER_BASE_URL", "http://127.0.0.1:8100")
    ).strip()
    display_name = str(
        os.getenv("SYNAPSE_PROVIDER_DISPLAY_NAME", "Synapse Labs")
    ).strip() or "Synapse Labs"
    payout_address = str(
        os.getenv("SYNAPSE_PAYOUT_ADDRESS", owner_address)
    ).strip() or owner_address
    payout_chain_id = int(os.getenv("SYNAPSE_PAYOUT_CHAIN_ID", "421614"))
    dry_run = env_bool("SYNAPSE_REGISTER_DRY_RUN", default=False)

    payloads = build_registration_payloads(
        provider_base_url=provider_base_url,
        display_name=display_name,
        payout_address=payout_address,
        payout_chain_id=payout_chain_id,
    )

    print(f"Prepared {len(payloads)} provider shelf services.")
    print(
        json.dumps(
            {
                "gatewayApiBase": api_base,
                "providerBaseUrl": provider_base_url,
                "providerDisplayName": display_name,
                "payoutAddress": payout_address,
                "payoutChainId": payout_chain_id,
                "dryRun": dry_run,
            },
            ensure_ascii=False,
            indent=2,
        )
    )

    if dry_run:
        print(json.dumps(payloads, ensure_ascii=False, indent=2))
        return

    headers = registration_headers(owner_address, bearer_token)
    failures = 0
    for payload in payloads:
        service_id = str(payload["agentToolName"])
        result = register_service(api_base, headers, payload)
        print(
            json.dumps(
                {
                    "serviceId": service_id,
                    "statusCode": result["statusCode"],
                    "ok": result["ok"],
                    "body": result["body"],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        if not bool(result["ok"]):
            failures += 1

    if failures:
        raise SystemExit(f"Registration failed for {failures} service(s).")


if __name__ == "__main__":
    main()
