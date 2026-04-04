"""Low-level helper functions for manifest parsing and construction.

Extracted from manifest_parser_service to keep each module under 500 lines.
All symbols here are private implementation details; only manifest_parser_service
should import from this module.
"""
import json
import os
import re
from typing import Any, Optional
from urllib.parse import urlparse

from src.services.provider.runtime_auth import auth_mode_for_endpoint_path


DEFAULT_PRICE_USDC = "0.01"
DEFAULT_TIMEOUT_MS = 15000
DEFAULT_HEALTH_TIMEOUT_MS = 3000
DEFAULT_HEALTH_INTERVAL_SEC = 10
DEFAULT_MAX_QPS = 50
DEFAULT_MAX_REQUEST_BYTES = 4096
DEFAULT_MAX_RESPONSE_BYTES = 4096
DEFAULT_REQUEST_ID_HEADER = "X-Synapse-Request-Id"
DEFAULT_HEALTH_PATH = "/health"
GENERIC_PATH_SEGMENTS = {"api", "v1", "provider-services", "provider_service", "services"}
GENERIC_ACTION_SEGMENTS = {"invoke", "generate", "run"}


def _contains_chinese(value: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", value))


def _service_manifest_template() -> dict[str, Any]:
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


def _deep_merge_manifest(base: dict[str, Any], override: Optional[dict[str, Any]]) -> dict[str, Any]:
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


def _extract_json_from_text(content: str) -> Optional[dict[str, Any]]:
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


def _extract_json_objects_with_positions(content: str) -> list[tuple[int, dict[str, Any]]]:
    decoder = json.JSONDecoder()
    matches: list[tuple[int, dict[str, Any]]] = []
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


def _infer_schema_from_json_payload(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict):
        properties: dict[str, Any] = {}
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


def _meaningful_path_segments(path_segments: list[str]) -> list[str]:
    meaningful = [segment for segment in path_segments if segment]
    while meaningful and meaningful[0].lower() in GENERIC_PATH_SEGMENTS:
        meaningful = meaningful[1:]
    while meaningful and meaningful[-1].lower() in GENERIC_ACTION_SEGMENTS:
        meaningful = meaningful[:-1]
    return meaningful or path_segments


def _guess_task_category(path_segments: list[str]) -> str:
    lowered = [segment.lower() for segment in _meaningful_path_segments(path_segments)]
    if "quotes" in lowered:
        return "text.quotes"
    if any("sentiment" in segment for segment in lowered):
        return "web3.market.sentiment"
    if "ocr" in lowered:
        return "ocr.document"
    if lowered:
        return f"api.{lowered[-1]}"
    return "api.invoke"


def _guess_capabilities(path_segments: list[str], response_body: Any) -> list[str]:
    capabilities: list[str] = []
    lowered = [segment.lower() for segment in _meaningful_path_segments(path_segments)]
    if "quotes" in lowered:
        capabilities.append("quote_generation")
    if any(segment in lowered for segment in ["top3", "top-3", "top"]):
        capabilities.append("top_n_results")
    if any("sentiment" in segment for segment in lowered):
        capabilities.extend(
            [
                "market_sentiment_scoring",
                "trend_summary",
                "volatility_signal",
            ]
        )
    if isinstance(response_body, dict):
        if "reasoning_bullets" in response_body:
            capabilities.append("multi_source_reasoning")
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


def _service_id_from_segments(path_segments: list[str]) -> str:
    joined = "_".join(path_segments)
    normalized = re.sub(r"[^a-z0-9_]+", "_", joined.strip().lower()).strip("_")
    return f"svc_{normalized}"[:64] if normalized else "svc_imported_api_service"


def _extract_response_payload(raw_text: str, request_payload: Any) -> Optional[dict[str, Any]]:
    matches = _extract_json_objects_with_positions(raw_text)
    if not matches:
        return None

    candidates = [
        payload
        for _, payload in matches
        if request_payload is None or payload != request_payload
    ]
    if not candidates:
        return None

    for payload in candidates:
        if {"service", "result", "errors"}.issubset(payload.keys()):
            return payload

    return max(candidates, key=lambda payload: len(json.dumps(payload, ensure_ascii=False)))


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
    meaningful_segments = _meaningful_path_segments(path_segments)
    if meaningful_segments:
        service_name = " ".join(
            segment.replace("-", " ") for segment in meaningful_segments[-2:]
        ).title()
        service_id = _service_id_from_segments(meaningful_segments[-3:])
        description = f"Call {parsed.path} and return structured JSON results for the caller."
        if any("sentiment" in segment.lower() for segment in meaningful_segments):
            description = (
                "Return a structured crypto market sentiment score with trend "
                "direction, volatility signal, and concise reasoning for a token "
                "or market segment."
            )
        health_path = _normalize_path_to_health(parsed.path)

    return service_id, service_name, description, path_segments, health_path


def _build_examples(request_body: Any, response_body: Any) -> list[dict[str, Any]]:
    if request_body is None and response_body is None:
        return []

    example: dict[str, Any] = {}
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
    examples: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "description_for_model": description,
        "task_category": _guess_task_category(path_segments),
        "capabilities": _guess_capabilities(path_segments, response_body),
        "limitations": [],
        "supported_languages": _guess_supported_language(request_body, response_body),
        "examples": examples,
    }


def _build_gateway_extensions_payload(endpoint: str, health_path: str) -> dict[str, Any]:
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


def _apply_required_defaults(
    base: dict[str, Any],
    endpoint: str,
    health_path: str,
    input_schema: dict[str, Any],
    output_schema: dict[str, Any],
    examples: list[dict[str, Any]],
) -> None:
    if not base["model_usage"].get("examples") and examples:
        base["model_usage"]["examples"] = examples

    if not base["io_schema"].get("input_schema"):
        base["io_schema"]["input_schema"] = input_schema
    if not base["io_schema"].get("output_schema"):
        base["io_schema"]["output_schema"] = output_schema
    if endpoint:
        runtime_auth_mode = str(base["runtime"].get("auth_mode") or "").strip()
        expected_auth_mode = auth_mode_for_endpoint_path(urlparse(endpoint).path)
        if not runtime_auth_mode or (
            expected_auth_mode == "gateway_signed"
            and runtime_auth_mode == "gateway_forward"
        ):
            base["runtime"]["auth_mode"] = expected_auth_mode

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
