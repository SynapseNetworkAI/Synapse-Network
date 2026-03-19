#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import sys

from synapse_client import SynapseClient
from synapse_client.exceptions import SynapseClientError


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
        default="sdk-smoke-test",
        help="Request id attached to quote/invoke requests.",
    )
    parser.add_argument(
        "--idempotency-key",
        default="sdk-smoke-test",
        help="Idempotency key used for invocation.",
    )
    parser.add_argument(
        "--skip-invoke",
        action="store_true",
        help="Only perform discovery and exit without quote/invoke.",
    )
    return parser.parse_args()


def resolve_payload(args: argparse.Namespace) -> dict:
    if args.payload_json:
        payload = json.loads(args.payload_json)
        if not isinstance(payload, dict):
            raise ValueError("--payload-json must decode to a JSON object")
        return payload
    return {"text": args.text}


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

    client = SynapseClient(api_key=args.api_key, gateway_url=args.gateway_url)

    service_id = args.service_id.strip()
    try:
        if not service_id:
            discovery = client.discover_services(
                intent=args.query,
                tags=args.tags,
                request_id=args.request_id,
            )
            print(f"Discovery count: {discovery.count}")
            for service in discovery.results:
                print(
                    f"- {service.service_id} | {service.service_name} | {service.pricing.amount} {service.pricing.currency}"
                )

            if not discovery.results:
                print("No discoverable services matched the current query.", file=sys.stderr)
                return 1

            service_id = discovery.results[0].service_id
            print(f"Selected service: {service_id}")

        if args.skip_invoke:
            return 0

        response = client.call_service(
            service_id=service_id,
            payload=payload,
            request_id=args.request_id,
            idempotency_key=args.idempotency_key,
        )
    except SynapseClientError as exc:
        print(f"Synapse SDK smoke test failed: {exc}", file=sys.stderr)
        return 1

    print("Invocation succeeded")
    print(json.dumps(response.raw_response, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())