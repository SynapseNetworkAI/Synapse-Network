"""Manifest parser service: curl → service manifest.

Low-level helpers (JSON extraction, schema inference, path analysis, manifest
building) are in ``manifest_helpers``.  This module only contains the
higher-level curl parsing, message building, and the public async entry point.
"""
import json
import re
from typing import Any, Optional
from urllib.parse import urlparse

import httpx

from src.core.config import settings
from src.services.provider.manifest_helpers import (
    DEFAULT_MAX_REQUEST_BYTES,
    DEFAULT_PRICE_USDC,
    DEFAULT_TIMEOUT_MS,
    _apply_required_defaults,
    _build_examples,
    _build_gateway_extensions_payload,
    _build_model_usage_payload,
    _deep_merge_manifest,
    _derive_service_identity,
    _extract_json_from_text,
    _extract_response_payload,
    _infer_schema_from_json_payload,
    _load_manifest_parser_doc,
    _service_manifest_template,
    _slugify,
)
from src.services.provider.runtime_auth import auth_mode_for_endpoint_path


def _extract_curl_parts(curl_command: str) -> dict[str, Any]:
    method_match = re.search(r"(?:^|\s)-X\s+([A-Za-z]+)", curl_command)
    method = method_match.group(1).upper() if method_match else ""

    url_match = re.search(r"https?://[^\s'\"\\]+", curl_command)
    endpoint = url_match.group(0) if url_match else ""

    data_match = re.search(
        r"(?:^|\s)(?:--data-raw|--data|--data-binary|-d)\s+('([^']*)'|\"([^\"]*)\")",
        curl_command,
    )
    body_str = ""
    if data_match:
        body_str = data_match.group(2) or data_match.group(3) or ""

    if not method:
        method = "POST" if body_str else "GET"

    parsed_body: Any = None
    if body_str:
        try:
            parsed_body = json.loads(body_str)
        except Exception:
            parsed_body = None

    return {
        "method": method,
        "endpoint": endpoint,
        "body": parsed_body,
    }


def _to_agent_tool_name(name: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_-]+", "_", name.strip().lower()).strip("_")
    return normalized[:64] if normalized else "invoke_service"


def _build_fallback_manifest(
    curl_command: str, current_manifest: Optional[dict[str, Any]]
) -> dict[str, Any]:
    parts = _extract_curl_parts(curl_command)
    endpoint = parts.get("endpoint", "")
    request_body = parts.get("body")
    response_body = _extract_response_payload(curl_command, request_body)
    service_id, service_name, description, path_segments, endpoint_path = _derive_service_identity(endpoint)
    input_schema = _infer_schema_from_json_payload(request_body) if request_body is not None else {"type": "object", "properties": {}}
    output_schema = _infer_schema_from_json_payload(response_body) if response_body is not None else {"type": "object", "properties": {}}
    examples = _build_examples(request_body, response_body)

    base = _deep_merge_manifest(_service_manifest_template(), current_manifest)
    base["service_id"] = current_manifest.get("service_id") if isinstance(current_manifest, dict) and current_manifest.get("service_id") else service_id
    base["service_name"] = current_manifest.get("service_name") if isinstance(current_manifest, dict) and current_manifest.get("service_name") else service_name
    base["service_slug"] = current_manifest.get("service_slug") if isinstance(current_manifest, dict) and current_manifest.get("service_slug") else _slugify(base["service_name"])
    base["manifest_version"] = current_manifest.get("manifest_version") if isinstance(current_manifest, dict) and current_manifest.get("manifest_version") else "1.0.0"
    base["model_usage"] = _deep_merge_manifest(
        base.get("model_usage", {}),
        _build_model_usage_payload(description, path_segments, request_body, response_body, examples),
    )
    base["io_schema"] = _deep_merge_manifest(
        base.get("io_schema", {}),
        {
            "input_schema": input_schema,
            "output_schema": output_schema,
        },
    )
    base["billing"] = _deep_merge_manifest(
        base.get("billing", {}),
        {
            "price_model": "fixed",
            "base_price_usdc": DEFAULT_PRICE_USDC,
            "settlement_currency": "USDC",
        },
    )
    base["runtime"] = _deep_merge_manifest(
        base.get("runtime", {}),
        {
            "endpoint_url": endpoint,
            "auth_mode": auth_mode_for_endpoint_path(endpoint_path),
            "timeout_ms": DEFAULT_TIMEOUT_MS,
            "max_payload_bytes": DEFAULT_MAX_REQUEST_BYTES,
        },
    )
    base["gateway_extensions"] = _deep_merge_manifest(
        base.get("gateway_extensions", {}),
        _build_gateway_extensions_payload(endpoint, endpoint_path),
    )

    _apply_required_defaults(base, endpoint, endpoint_path, input_schema, output_schema, examples)

    return base


def _build_messages(
    curl_command: str, current_manifest: Optional[dict[str, Any]], parser_doc: str
) -> list[dict[str, str]]:
    current_manifest_payload = (
        current_manifest if isinstance(current_manifest, dict) else {}
    )
    default_manifest = _deep_merge_manifest(
        _service_manifest_template(), current_manifest_payload
    )

    system_prompt = (
        "You are a strict API contract parser for Synapse Network. "
        "Read the Service Manifest Registration guide, parse the given API example block, and return only a JSON object. "
        "Do not include markdown, explanation, or code fences.\n"
        "Output keys must exactly be: "
        "service_id, service_name, service_slug, manifest_version, model_usage, io_schema, billing, runtime, gateway_extensions.\n"
        "Rules: billing.price_model must be fixed; runtime.auth_mode must be gateway_forward unless the endpoint path starts with /provider-services/, in which case runtime.auth_mode must be gateway_signed; "
        "gateway_extensions.health_check.method must be GET; gateway_extensions.health_check.interval_sec must be 10; "
        "gateway_extensions.health_check.success_codes must be [200]; do not output quality, quote_required, pass_through_headers, or platform-internal settlement fields."
    )

    user_payload = {
        "documentation": parser_doc,
        "default_manifest": default_manifest,
        "current_manifest": current_manifest_payload,
        "api_example": curl_command,
        "instruction": "Parse the curl request and the returned JSON sample together. Infer request schema, response schema, examples, a concise description_for_model, and a reasonable task_category/capabilities set for the current V1 frontend manifest.",
    }

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
    ]


async def parse_manifest_from_curl(
    curl_command: str,
    current_manifest: Optional[dict[str, Any]],
    model_override: Optional[str] = None,
) -> dict[str, Any]:
    fallback_manifest = _build_fallback_manifest(curl_command, current_manifest)

    if not settings.deepseek_api_key:
        return {
            "manifest": fallback_manifest,
            "fallback": True,
            "reason": "DEEPSEEK_API_KEY is not configured",
        }

    parser_doc = _load_manifest_parser_doc()
    messages = _build_messages(curl_command, current_manifest, parser_doc)

    payload = {
        "model": model_override or settings.deepseek_model,
        "messages": messages,
        "temperature": 0.1,
    }
    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
    }

    try:
        timeout = httpx.Timeout(settings.deepseek_timeout_s)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                f"{settings.deepseek_base_url.rstrip('/')}/chat/completions",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            result = response.json()

        content = str(result["choices"][0]["message"]["content"]).strip()
        parsed = _extract_json_from_text(content)
        if not isinstance(parsed, dict):
            return {
                "manifest": fallback_manifest,
                "fallback": True,
                "reason": "DeepSeek returned non-JSON payload",
                "raw": content,
            }

        merged = _deep_merge_manifest(fallback_manifest, parsed)
        return {
            "manifest": merged,
            "fallback": False,
            "raw": content,
        }
    except Exception as exc:
        return {
            "manifest": fallback_manifest,
            "fallback": True,
            "reason": str(exc),
        }
