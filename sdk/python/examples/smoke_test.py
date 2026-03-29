#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import shlex
import sys
from uuid import uuid4

from synapse_client import SynapseClient
from synapse_client.exceptions import (
    AuthenticationError,
    BudgetExceededError,
    DiscoveryError,
    InsufficientFundsError,
    InvokeError,
    QuoteError,
    SynapseClientError,
)
from synapse_client.models import InvocationResponse, QuoteResponse


TERMINAL_STATUSES = {"SUCCEEDED", "FAILED_RETRYABLE", "FAILED_FINAL", "SETTLED"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Smoke test Synapse Python SDK against a live gateway.",
    )
    parser.add_argument(
        "--api-key",
        default=os.getenv("SYNAPSE_API_KEY", "").strip(),
        help="Agent credential. Defaults to SYNAPSE_API_KEY.",
    )
    parser.add_argument(
        "--gateway-url",
        default=os.getenv("SYNAPSE_GATEWAY", "http://127.0.0.1:8000").strip(),
        help="Gateway base URL. Defaults to SYNAPSE_GATEWAY or http://127.0.0.1:8000.",
    )
    parser.add_argument(
        "--query",
        default="名人名言",
        help="Discovery query used when --service-id is not provided.",
    )
    parser.add_argument(
        "--tags",
        nargs="*",
        default=[],
        help="Optional discovery tags.",
    )
    parser.add_argument(
        "--service-id",
        default="",
        help="Skip discovery and invoke a known service directly.",
    )
    parser.add_argument(
        "--text",
        default="想要放弃的时候，请给我一句关于坚持的名人名言",
        help="Default text payload for text-based services.",
    )
    parser.add_argument(
        "--payload-json",
        default="",
        help="Raw JSON object payload. If set, overrides --text.",
    )
    parser.add_argument(
        "--request-id",
        default="",
        help="Request id attached to quote/invoke requests. Auto-generated when omitted.",
    )
    parser.add_argument(
        "--idempotency-key",
        default="",
        help="Idempotency key used for invocation. Auto-generated when omitted.",
    )
    parser.add_argument(
        "--skip-invoke",
        action="store_true",
        help="Only perform discovery and exit without quote/invoke.",
    )
    parser.add_argument(
        "--print-curl",
        action="store_true",
        help="Print reproducible curl commands for discovery, quote, and invoke requests.",
    )
    return parser.parse_args()


def resolve_payload(args: argparse.Namespace) -> dict:
    if args.payload_json:
        payload = json.loads(args.payload_json)
        if not isinstance(payload, dict):
            raise ValueError("--payload-json must decode to a JSON object")
        return payload
    return {"text": args.text}


def resolve_request_identity(args: argparse.Namespace) -> tuple[str, str]:
    run_id = uuid4().hex[:12]
    request_id = args.request_id.strip() or f"sdk-smoke-{run_id}"
    idempotency_key = args.idempotency_key.strip() or f"{request_id}-invoke"
    return request_id, idempotency_key


def print_section(title: str) -> None:
    print(f"\n=== {title} ===")


def print_json(label: str, payload: object) -> None:
    print(f"{label}: {json.dumps(payload, ensure_ascii=False, indent=2)}")


def shell_join(parts: list[str]) -> str:
    return " ".join(shlex.quote(part) for part in parts)


def format_curl(
    *,
    gateway_url: str,
    path: str,
    request_id: str,
    body: dict,
) -> str:
    env_api_key = "${SYNAPSE_API_KEY:-REPLACE_ME}"
    return shell_join(
        [
            "curl",
            "-sS",
            "-X",
            "POST",
            f"{gateway_url}{path}",
            "-H",
            "Content-Type: application/json",
            "-H",
            f"X-Credential: {env_api_key}",
            "-H",
            f"X-Request-Id: {request_id}",
            "-d",
            json.dumps(body, ensure_ascii=False, separators=(",", ":")),
        ]
    )


def print_stage_curl(
    *,
    args: argparse.Namespace,
    request_id: str,
    discovery_body: dict | None,
    quote_body: dict | None,
    invoke_body: dict | None,
) -> None:
    if not args.print_curl:
        return

    print_section("replay with curl")
    print("export SYNAPSE_API_KEY='agt_xxx_your_real_key'")
    if discovery_body is not None:
        print("discovery:")
        print(format_curl(
            gateway_url=args.gateway_url,
            path="/api/v1/agent/discovery/search",
            request_id=request_id,
            body=discovery_body,
        ))
    if quote_body is not None:
        print("quote:")
        print(format_curl(
            gateway_url=args.gateway_url,
            path="/api/v1/agent/quotes",
            request_id=request_id,
            body=quote_body,
        ))
    if invoke_body is not None:
        print("invoke:")
        print(format_curl(
            gateway_url=args.gateway_url,
            path="/api/v1/agent/invocations",
            request_id=request_id,
            body=invoke_body,
        ))


def print_failure_diagnosis(
    *,
    stage: str,
    exc: Exception,
    request_id: str,
    idempotency_key: str,
    service_id: str,
) -> None:
    print_section("failure diagnosis")
    print(f"stage: {stage}", file=sys.stderr)
    print(f"request_id: {request_id}", file=sys.stderr)
    print(f"idempotency_key: {idempotency_key}", file=sys.stderr)
    if service_id:
        print(f"service_id: {service_id}", file=sys.stderr)

    if isinstance(exc, AuthenticationError):
        print("hint: verify SYNAPSE_API_KEY is valid, not revoked, and accepted by the target gateway.", file=sys.stderr)
        return
    if isinstance(exc, InsufficientFundsError):
        print("hint: owner treasury or credential credit limit is exhausted; top up balance or widen budget policy.", file=sys.stderr)
        return
    if isinstance(exc, BudgetExceededError):
        print("hint: quote or invocation is blocked by runtime budget policy, daily cap, or credential credit guard.", file=sys.stderr)
        return
    if isinstance(exc, DiscoveryError):
        print("hint: check gateway health, discovery index readiness, and whether any service is published and healthy.", file=sys.stderr)
        return
    if isinstance(exc, QuoteError):
        print("hint: check service availability, payload preview shape, and gateway quote validation logs.", file=sys.stderr)
        return
    if isinstance(exc, InvokeError):
        print("hint: keep request_id/idempotency_key and correlate them with gateway logs or invocation receipts.", file=sys.stderr)
        return
    print("hint: unexpected local failure; re-run with --print-curl and replay the failing stage directly against the gateway.", file=sys.stderr)


def build_discovery_body(args: argparse.Namespace) -> dict:
    body: dict[str, object] = {
        "tags": args.tags,
        "page": 1,
        "pageSize": 10,
        "sort": "best_match",
    }
    if args.query:
        body["query"] = args.query
    return body


def build_quote_body(service_id: str, payload: dict) -> dict:
    return {
        "serviceId": service_id,
        "inputPreview": {
            "sample": {"body": payload},
            "payloadSchema": {"body": {}},
        },
        "responseMode": "sync",
    }


def build_invoke_body(quote_id: str, idempotency_key: str, payload: dict) -> dict:
    return {
        "quoteId": quote_id,
        "idempotencyKey": idempotency_key,
        "payload": {"body": payload},
        "responseMode": "sync",
    }


def build_quote_summary(quote: object) -> dict:
    return {
        "quoteId": getattr(quote, "quote_id", ""),
        "serviceId": getattr(quote, "service_id", ""),
        "priceUsdc": getattr(quote, "price_usdc", 0.0),
        "priceModel": getattr(quote, "price_model", ""),
        "expiresAt": getattr(quote, "expires_at", ""),
        "budgetCheck": getattr(getattr(quote, "budget_check", None), "model_dump", lambda **_: {}) (by_alias=True, exclude_none=True),
        "invokeConstraints": getattr(getattr(quote, "invoke_constraints", None), "model_dump", lambda **_: {}) (by_alias=True, exclude_none=True),
    }


def determine_failure_stage(quote_body: dict | None, invoke_body: dict | None) -> str:
    if quote_body is None and invoke_body is None:
        return "discovery"
    if invoke_body is None:
        return "quote"
    return "invoke"


def resolve_service_id(
    *,
    client: SynapseClient,
    args: argparse.Namespace,
    service_id: str,
    request_id: str,
    discovery_body: dict | None,
) -> tuple[str, int]:
    if service_id:
        return service_id, 0

    print_section("discovery")
    print_json("Discovery request", discovery_body)
    discovery = client.discover_services(
        intent=args.query,
        tags=args.tags,
        request_id=request_id,
    )
    print(f"Discovery count: {discovery.count}")
    for service in discovery.results:
        print(
            f"- {service.service_id} | {service.service_name} | {service.pricing.amount} {service.pricing.currency}"
        )

    if not discovery.results:
        print("No discoverable services matched the current query.", file=sys.stderr)
        return "", 1

    resolved_service_id = discovery.results[0].service_id
    print(f"Selected service: {resolved_service_id}")
    return resolved_service_id, 0


def handle_discovery_miss(
    *,
    args: argparse.Namespace,
    request_id: str,
    idempotency_key: str,
    discovery_body: dict | None,
) -> int:
    print_section("failure diagnosis")
    print("stage: discovery", file=sys.stderr)
    print(f"request_id: {request_id}", file=sys.stderr)
    print(f"idempotency_key: {idempotency_key}", file=sys.stderr)
    print(
        "hint: discovery returned zero services. Check provider health, service publication state, query terms, and whether the current credential can see this catalog.",
        file=sys.stderr,
    )
    print_stage_curl(
        args=args,
        request_id=request_id,
        discovery_body=discovery_body,
        quote_body=None,
        invoke_body=None,
    )
    return 1


def run_quote_and_invoke(
    *,
    client: SynapseClient,
    service_id: str,
    payload: dict,
    request_id: str,
    idempotency_key: str,
    stage_context: dict[str, dict | None],
) -> tuple[dict, dict, InvocationResponse]:
    quote_body = build_quote_body(service_id, payload)
    stage_context["quote_body"] = quote_body
    print_section("quote")
    print_json("Quote request", quote_body)
    quote: QuoteResponse = client.create_quote(
        service_id=service_id,
        input_preview=quote_body["inputPreview"],
        request_id=request_id,
    )
    print(f"Quote id: {quote.quote_id}")
    print(f"Quote expiry: {quote.expires_at}")
    print(f"Budget allowed: {quote.budget_check.allowed}")
    print_json("Quote summary", build_quote_summary(quote))

    invoke_body = build_invoke_body(quote.quote_id, idempotency_key, payload)
    stage_context["invoke_body"] = invoke_body
    print_section("invoke")
    print_json("Invoke request", invoke_body)
    invocation: InvocationResponse = client.create_invocation(
        quote_id=quote.quote_id,
        payload=payload,
        request_id=request_id,
        idempotency_key=idempotency_key,
    )
    print(f"Invocation id: {invocation.invocation_id}")
    print(f"Invocation status: {invocation.status}")

    if invocation.status not in TERMINAL_STATUSES:
        print_section("poll receipt")
        print(f"Polling receipt for invocation {invocation.invocation_id} ...")
        invocation = client.wait_for_invocation(invocation.invocation_id)
        print(f"Final invocation status: {invocation.status}")

    return quote_body, invoke_body, invocation


def main() -> int:
    args = parse_args()
    if not args.api_key:
        print("SYNAPSE_API_KEY or --api-key is required", file=sys.stderr)
        return 2

    try:
        payload = resolve_payload(args)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    request_id, idempotency_key = resolve_request_identity(args)

    client = SynapseClient(api_key=args.api_key, gateway_url=args.gateway_url)

    service_id = args.service_id.strip()
    discovery_body = build_discovery_body(args) if not service_id else None
    quote_body: dict | None = None
    invoke_body: dict | None = None
    stage_context: dict[str, dict | None] = {"quote_body": None, "invoke_body": None}

    print_section("smoke test context")
    print(f"Gateway: {args.gateway_url}")
    print(f"Request id: {request_id}")
    print(f"Idempotency key: {idempotency_key}")
    print(f"Service id override: {service_id or '<discover>'}")
    print_json("Payload", payload)
    try:
        service_id, discovery_exit_code = resolve_service_id(
            client=client,
            args=args,
            service_id=service_id,
            request_id=request_id,
            discovery_body=discovery_body,
        )
        if discovery_exit_code != 0:
            return handle_discovery_miss(
                args=args,
                request_id=request_id,
                idempotency_key=idempotency_key,
                discovery_body=discovery_body,
            )

        if args.skip_invoke:
            print_stage_curl(
                args=args,
                request_id=request_id,
                discovery_body=discovery_body,
                quote_body=None,
                invoke_body=None,
            )
            return 0

        quote_body, invoke_body, invocation = run_quote_and_invoke(
            client=client,
            service_id=service_id,
            payload=payload,
            request_id=request_id,
            idempotency_key=idempotency_key,
            stage_context=stage_context,
        )
    except SynapseClientError as exc:
        quote_body = stage_context.get("quote_body")
        invoke_body = stage_context.get("invoke_body")
        print(f"Synapse SDK smoke test failed: {exc}", file=sys.stderr)
        print_failure_diagnosis(
            stage=determine_failure_stage(quote_body, invoke_body),
            exc=exc,
            request_id=request_id,
            idempotency_key=idempotency_key,
            service_id=service_id,
        )
        print_stage_curl(
            args=args,
            request_id=request_id,
            discovery_body=discovery_body,
            quote_body=quote_body,
            invoke_body=invoke_body,
        )
        return 1
    except Exception as exc:
        print(f"Unexpected smoke test failure: {exc}", file=sys.stderr)
        print_failure_diagnosis(
            stage="local-script",
            exc=exc,
            request_id=request_id,
            idempotency_key=idempotency_key,
            service_id=service_id,
        )
        print_stage_curl(
            args=args,
            request_id=request_id,
            discovery_body=discovery_body,
            quote_body=quote_body,
            invoke_body=invoke_body,
        )
        return 1

    print_stage_curl(
        args=args,
        request_id=request_id,
        discovery_body=discovery_body,
        quote_body=quote_body,
        invoke_body=invoke_body,
    )

    print("Invocation succeeded")
    print(json.dumps(invocation.model_dump(by_alias=True, exclude_none=True), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())