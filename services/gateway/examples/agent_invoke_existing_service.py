#!/usr/bin/env python3
"""Invoke an existing Synapse provider service with an existing agent credential.

This is the shortest local/staging smoke path after creating an Agent
Credential in the console:

    SYNAPSE_AGENT_KEY=agt_xxx \
    SERVICE_ID=svc_oss_security_healthcheck \
    API_BASE=http://127.0.0.1:8000 \
    python services/gateway/examples/agent_invoke_existing_service.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from decimal import Decimal, InvalidOperation
from typing import Any

import requests

CONTENT_TYPE_JSON = "application/json"
DEFAULT_API_BASE = "http://127.0.0.1:8000"
DEFAULT_SERVICE_ID = "svc_oss_security_healthcheck"

CANONICAL_PAYLOADS: dict[str, dict[str, Any]] = {
    "svc_oss_security_healthcheck": {
        "repoUrl": "https://github.com/SynapseNetworkAI/Synapse-Network",
        "packageList": ["next", "react", "fumadocs-ui"],
        "ecosystem": "npm",
    },
    "svc_web3_sentiment_index": {
        "symbol": "ETH",
        "chain": "arbitrum",
        "lookback_hours": 24,
        "include_narrative": True,
    },
    "svc_protocol_fundamental_brief": {
        "protocol": "uniswap",
        "chain": "arbitrum",
        "peer_set": ["aave", "curve"],
        "lookback_days": 30,
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Discover and invoke an existing Synapse provider service."
    )
    parser.add_argument("--api-base", default=os.getenv("API_BASE", DEFAULT_API_BASE))
    parser.add_argument(
        "--credential",
        default=os.getenv("SYNAPSE_AGENT_KEY") or os.getenv("SYNAPSE_AGENT_TOKEN"),
        help="Full agent credential token, e.g. agt_xxx.",
    )
    parser.add_argument(
        "--service-id",
        default=os.getenv("SERVICE_ID", DEFAULT_SERVICE_ID),
        help="Existing serviceId to invoke.",
    )
    parser.add_argument(
        "--query",
        default=os.getenv("DISCOVERY_QUERY"),
        help="Optional discovery query. Defaults to serviceId for exact matching.",
    )
    parser.add_argument(
        "--payload-json",
        default=os.getenv("INVOKE_PAYLOAD_JSON"),
        help="JSON object for payload.body. Required for non-canonical services.",
    )
    parser.add_argument(
        "--max-cost-usdc",
        default=os.getenv("MAX_COST_USDC"),
        help="Optional LLM/token-metered budget cap. Fixed-price services use discovery costUsdc.",
    )
    return parser.parse_args()


def require_non_empty(value: str | None, name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise RuntimeError(f"Missing {name}")
    return normalized


def post_json(
    api_base: str,
    path: str,
    credential: str,
    body: dict[str, Any],
    *,
    expect_ok: bool = True,
) -> dict[str, Any]:
    response = requests.post(
        f"{api_base.rstrip('/')}{path}",
        headers={
            "Content-Type": CONTENT_TYPE_JSON,
            "X-Credential": credential,
        },
        json=body,
        timeout=60,
    )
    payload = response.json() if response.content else {}
    if expect_ok and not response.ok:
        raise RuntimeError(
            f"POST {path} failed ({response.status_code}): "
            f"{json.dumps(payload, ensure_ascii=False)}"
        )
    return {"statusCode": response.status_code, "ok": response.ok, "payload": payload}


def get_json(api_base: str, path: str, credential: str) -> dict[str, Any]:
    response = requests.get(
        f"{api_base.rstrip('/')}{path}",
        headers={"X-Credential": credential},
        timeout=30,
    )
    payload = response.json() if response.content else {}
    if not response.ok:
        raise RuntimeError(
            f"GET {path} failed ({response.status_code}): "
            f"{json.dumps(payload, ensure_ascii=False)}"
        )
    return payload


def discovery_results(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows = payload.get("results") or payload.get("services") or payload.get("data") or []
    return [row for row in rows if isinstance(row, dict)]


def find_service(rows: list[dict[str, Any]], service_id: str) -> dict[str, Any]:
    identifiers = ("serviceId", "service_id", "id", "agentToolName")
    for row in rows:
        if service_id in {str(row.get(key) or "") for key in identifiers}:
            return row
    raise RuntimeError(f"Service {service_id!r} was not returned by discovery/search")


def price_model(row: dict[str, Any]) -> str:
    return str(row.get("priceModel") or row.get("price_model") or "").strip().lower()


def live_price_usdc(row: dict[str, Any]) -> str:
    pricing = row.get("pricing") if isinstance(row.get("pricing"), dict) else {}
    candidates = [
        row.get("basePriceUsdc"),
        row.get("priceUsdc"),
        row.get("unitPrice"),
        pricing.get("amount"),
    ]
    for candidate in candidates:
        if candidate is None:
            continue
        value = str(candidate).strip()
        if not value:
            continue
        try:
            price = Decimal(value)
        except InvalidOperation:
            continue
        if price >= Decimal("0"):
            return format(price, "f")
    raise RuntimeError(f"Discovery row does not include a usable price: {row}")


def load_payload(service_id: str, payload_json: str | None) -> dict[str, Any]:
    if payload_json:
        payload = json.loads(payload_json)
        if not isinstance(payload, dict):
            raise RuntimeError("--payload-json must decode to a JSON object")
        return payload
    if service_id in CANONICAL_PAYLOADS:
        return CANONICAL_PAYLOADS[service_id]
    raise RuntimeError(
        f"No built-in payload for service {service_id!r}. "
        "Pass --payload-json or set INVOKE_PAYLOAD_JSON."
    )


def main() -> int:
    args = parse_args()
    api_base = require_non_empty(args.api_base, "API_BASE").rstrip("/")
    credential = require_non_empty(args.credential, "SYNAPSE_AGENT_KEY")
    service_id = require_non_empty(args.service_id, "SERVICE_ID")
    query = str(args.query or service_id).strip()

    discover = post_json(
        api_base,
        "/api/v1/agent/discovery/search",
        credential,
        {"query": query, "pageSize": 10},
    )["payload"]
    service = find_service(discovery_results(discover), service_id)
    payload_body = load_payload(service_id, args.payload_json)

    invoke_body: dict[str, Any] = {
        "serviceId": service_id,
        "idempotencyKey": f"agent-invoke-existing-{int(time.time())}",
        "payload": {"body": payload_body},
        "responseMode": "sync",
    }

    model = price_model(service)
    if args.max_cost_usdc:
        invoke_body["maxCostUsdc"] = str(args.max_cost_usdc)
    elif model == "token_metered":
        raise RuntimeError("Token-metered service requires --max-cost-usdc")
    else:
        invoke_body["costUsdc"] = live_price_usdc(service)

    invoke = post_json(
        api_base,
        "/api/v1/agent/invoke",
        credential,
        invoke_body,
        expect_ok=False,
    )
    if not invoke["ok"]:
        detail = invoke["payload"].get("detail", invoke["payload"])
        if isinstance(detail, dict) and detail.get("code") == "PRICE_MISMATCH":
            raise RuntimeError(
                "PRICE_MISMATCH: re-run discovery/search and invoke with the live "
                "costUsdc returned by Gateway. Do not retry with documentation examples."
            )
        raise RuntimeError(
            f"Invoke failed ({invoke['statusCode']}): "
            f"{json.dumps(invoke['payload'], ensure_ascii=False)}"
        )

    result = invoke["payload"]
    invocation_id = (
        result.get("invocationId") or result.get("invocation_id") or result.get("id")
    )
    receipt = (
        get_json(api_base, f"/api/v1/agent/invocations/{invocation_id}", credential)
        if invocation_id
        else {}
    )

    evidence = {
        "apiBase": api_base,
        "serviceId": service_id,
        "discoveredPriceUsdc": invoke_body.get("costUsdc"),
        "maxCostUsdc": invoke_body.get("maxCostUsdc"),
        "invocationId": invocation_id,
        "invoke": result,
        "receipt": receipt,
    }
    print(json.dumps(evidence, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
