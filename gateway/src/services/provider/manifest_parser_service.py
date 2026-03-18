import json
import os
import re
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import httpx

from src.core.config import settings


DEFAULT_PRICE_USDC = "0.01"
DEFAULT_TIMEOUT_MS = 15000
DEFAULT_HEALTH_TIMEOUT_MS = 3000
DEFAULT_HEALTH_INTERVAL_SEC = 10
DEFAULT_MAX_QPS = 50
DEFAULT_MAX_REQUEST_BYTES = 4096
DEFAULT_MAX_RESPONSE_BYTES = 4096
DEFAULT_REQUEST_ID_HEADER = "X-Synapse-Request-Id"
DEFAULT_HEALTH_PATH = "/health"


def _contains_chinese(value: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", value))


def _service_manifest_template() -> Dict[str, Any]:
    return {
        "service_id": "",
        "service_name": "",
        "service_slug": "",
        "manifest_version": "1.0.0",
        "model_usage": {
            "description_for_model": "",
            "task_category": "",
            "capabilities": [],
            "limitations": [],
            "supported_languages": ["en"],
            "examples": [],
        },
        "io_schema": {
            "input_schema": {},
            "output_schema": {},
        },
        "billing": {
            "price_model": "fixed",
            "base_price_usdc": DEFAULT_PRICE_USDC,
            "settlement_currency": "USDC",
        },
        "runtime": {
            "endpoint_url": "",
            "auth_mode": "gateway_forward",
            "timeout_ms": DEFAULT_TIMEOUT_MS,
            "max_payload_bytes": DEFAULT_MAX_REQUEST_BYTES,
        },
        "gateway_extensions": {
            "health_check": {
                "method": "GET",
                "path": DEFAULT_HEALTH_PATH,
                "interval_sec": DEFAULT_HEALTH_INTERVAL_SEC,
                "timeout_ms": DEFAULT_HEALTH_TIMEOUT_MS,
                "success_codes": [200],
            },
            "routing_targets": [],
            "forwarding_policy": {
                "request_id_header": DEFAULT_REQUEST_ID_HEADER,
            },
            "rate_limit_policy": {
                "max_qps": DEFAULT_MAX_QPS,
            },
        },
    }


def _deep_merge_manifest(base: Dict[str, Any], override: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    merged = dict(base)
    if not isinstance(override, dict):
        return merged

    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge_manifest(merged[key], value)
            continue
        merged[key] = value
    return merged


def _load_manifest_parser_doc() -> str:
    candidate_paths = [
        os.path.abspath(
            os.path.join(
                os.path.dirname(__file__),
                "..",
                "..",
                "..",
                "..",
                "docs",
                "agent",
                "03_Service_Manifest_Field_Standard.md",
            )
        ),
        os.path.abspath(
            os.path.join(
                os.path.dirname(__file__),
                "..",
                "..",
                "..",
                "..",
                "doc",
                "04_Synapse_Network",
                "Service_Manifest_Registration.md",
            )
        ),
    ]

    for doc_path in candidate_paths:
        if not os.path.exists(doc_path):
            continue
        try:
            with open(doc_path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            continue
    return ""


def _extract_json_from_text(content: str) -> Optional[Dict[str, Any]]:
    stripped = content.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?", "", stripped, flags=re.IGNORECASE).strip()
        stripped = re.sub(r"```$", "", stripped).strip()

    decoder = json.JSONDecoder()
    for idx, ch in enumerate(stripped):
        if ch != "{":
            continue
        try:
            parsed, _ = decoder.raw_decode(stripped[idx:])
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            continue
    return None


def _extract_json_objects_with_positions(content: str) -> list[tuple[int, Dict[str, Any]]]:
    decoder = json.JSONDecoder()
    matches: list[tuple[int, Dict[str, Any]]] = []
    for idx, ch in enumerate(content):
        if ch != "{":
            continue
        try:
            parsed, _ = decoder.raw_decode(content[idx:])
        except Exception:
            continue
        if isinstance(parsed, dict):
            matches.append((idx, parsed))
    return matches


def _infer_schema_from_json_payload(payload: Any) -> Dict[str, Any]:
    if isinstance(payload, dict):
        properties: Dict[str, Any] = {}
        required = []
        for key, value in payload.items():
            properties[key] = _infer_schema_from_json_payload(value)
            required.append(key)
        return {
            "type": "object",
            "required": required,
            "properties": properties,
        }
    if isinstance(payload, list):
        item_schema = (
            _infer_schema_from_json_payload(payload[0])
            if payload
            else {"type": "string"}
        )
        return {"type": "array", "items": item_schema}
    if isinstance(payload, bool):
        return {"type": "boolean"}
    if isinstance(payload, int):
        return {"type": "integer"}
    if isinstance(payload, float):
        return {"type": "number"}
    return {"type": "string"}


def _normalize_path_to_health(path: str) -> str:
    if not path or path == "/":
        return DEFAULT_HEALTH_PATH
    if path.endswith("/health"):
        return path
    return DEFAULT_HEALTH_PATH


def _guess_task_category(path_segments: list[str]) -> str:
    lowered = [segment.lower() for segment in path_segments]
    if "quotes" in lowered:
        return "text.quotes"
    if "ocr" in lowered:
        return "ocr.document"
    if lowered:
        return f"api.{lowered[-1]}"
    return "api.invoke"


def _guess_capabilities(path_segments: list[str], response_body: Any) -> list[str]:
    capabilities: list[str] = []
    lowered = [segment.lower() for segment in path_segments]
    if "quotes" in lowered:
        capabilities.append("quote_generation")
    if any(segment in lowered for segment in ["top3", "top-3", "top"]):
        capabilities.append("top_n_results")
    if isinstance(response_body, dict):
        for key in response_body.keys():
            normalized = re.sub(r"[^a-z0-9]+", "_", str(key).lower()).strip("_")
            if normalized:
                capabilities.append(normalized)
    deduped: list[str] = []
    for item in capabilities:
        if item and item not in deduped:
            deduped.append(item)
    return deduped or ["api_invoke"]


def _guess_supported_language(request_body: Any, response_body: Any) -> list[str]:
    samples = [json.dumps(request_body, ensure_ascii=False), json.dumps(response_body, ensure_ascii=False)]
    return ["cn"] if any(_contains_chinese(sample) for sample in samples) else ["en"]


def _slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9_-]+", "-", value.strip().lower()).strip("-_")


def _extract_response_payload(raw_text: str, request_payload: Any) -> Optional[Dict[str, Any]]:
    matches = _extract_json_objects_with_positions(raw_text)
    if not matches:
        return None

    for _, payload in reversed(matches):
        if request_payload is not None and payload == request_payload:
            continue
        return payload
    return None


def _derive_service_identity(endpoint: str) -> tuple[str, str, str, list[str], str]:
    service_name = "Imported API Service"
    service_id = "svc_imported_api_service"
    description = "Generated from API call example. Review and refine before deployment."
    path_segments: list[str] = []
    health_path = DEFAULT_HEALTH_PATH

    if not endpoint:
        return service_id, service_name, description, path_segments, health_path

    parsed = urlparse(endpoint)
    path_segments = [seg for seg in parsed.path.split("/") if seg]
    if path_segments:
        service_name = " ".join(
            segment.replace("-", " ") for segment in path_segments[-2:]
        ).title()
        service_id = f"svc_{_slugify('_'.join(path_segments[-3:]))}"[:64]
        description = f"Call {parsed.path} and return structured JSON results for the caller."
        health_path = _normalize_path_to_health(parsed.path)

    return service_id, service_name, description, path_segments, health_path


def _build_examples(request_body: Any, response_body: Any) -> list[Dict[str, Any]]:
    if request_body is None and response_body is None:
        return []

    example: Dict[str, Any] = {}
    if request_body is not None:
        example["input"] = request_body
    if response_body is not None:
        example["output"] = response_body
    return [example] if example else []


def _build_model_usage_payload(
    description: str,
    path_segments: list[str],
    request_body: Any,
    response_body: Any,
    examples: list[Dict[str, Any]],
) -> Dict[str, Any]:
    return {
        "description_for_model": description,
        "task_category": _guess_task_category(path_segments),
        "capabilities": _guess_capabilities(path_segments, response_body),
        "limitations": [],
        "supported_languages": _guess_supported_language(request_body, response_body),
        "examples": examples,
    }


def _build_gateway_extensions_payload(endpoint: str, health_path: str) -> Dict[str, Any]:
    return {
        "health_check": {
            "method": "GET",
            "path": health_path,
            "interval_sec": DEFAULT_HEALTH_INTERVAL_SEC,
            "timeout_ms": DEFAULT_HEALTH_TIMEOUT_MS,
            "success_codes": [200],
        },
        "routing_targets": [{"url": endpoint, "weight": 100}] if endpoint else [],
        "forwarding_policy": {
            "request_id_header": DEFAULT_REQUEST_ID_HEADER,
        },
        "rate_limit_policy": {
            "max_qps": DEFAULT_MAX_QPS,
        },
    }


def _apply_required_defaults(base: Dict[str, Any], endpoint: str, health_path: str, input_schema: Dict[str, Any], output_schema: Dict[str, Any], examples: list[Dict[str, Any]]) -> None:
    if not base["model_usage"].get("examples") and examples:
        base["model_usage"]["examples"] = examples

    if not base["io_schema"].get("input_schema"):
        base["io_schema"]["input_schema"] = input_schema
    if not base["io_schema"].get("output_schema"):
        base["io_schema"]["output_schema"] = output_schema

    if endpoint and not base["gateway_extensions"].get("routing_targets"):
        base["gateway_extensions"]["routing_targets"] = [{"url": endpoint, "weight": 100}]

    if not base["gateway_extensions"].get("health_check"):
        base["gateway_extensions"]["health_check"] = {
            "method": "GET",
            "path": health_path,
            "interval_sec": DEFAULT_HEALTH_INTERVAL_SEC,
            "timeout_ms": DEFAULT_HEALTH_TIMEOUT_MS,
            "success_codes": [200],
        }


def _extract_curl_parts(curl_command: str) -> Dict[str, Any]:
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
    curl_command: str, current_manifest: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
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
            "auth_mode": "gateway_forward",
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
    curl_command: str, current_manifest: Optional[Dict[str, Any]], parser_doc: str
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
        "Rules: billing.price_model must be fixed; runtime.auth_mode must be gateway_forward; "
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
    current_manifest: Optional[Dict[str, Any]],
    model_override: Optional[str] = None,
) -> Dict[str, Any]:
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
