import json
import os
import re
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import httpx

from src.core.config import settings


def _service_manifest_template() -> Dict[str, Any]:
    return {
        "service_name": "",
        "agent_tool_name": "",
        "description": "",
        "intent": [],
        "endpoint": "",
        "health_check": "",
        "pricing": {
            "currency": "USDC",
            "amount": "0.01",
            "type": "per_call",
        },
        "constraints": {
            "max_response_bytes": 2048,
            "max_request_bytes": 4096,
            "timeout_ms": 3000,
            "max_qps": 50,
        },
        "input_schema": {},
        "output_schema": {},
    }


def _merge_manifest(
    default_manifest: Dict[str, Any], current_manifest: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    merged = {**default_manifest}
    if isinstance(current_manifest, dict):
        merged.update(current_manifest)
        pricing = current_manifest.get("pricing")
        constraints = current_manifest.get("constraints")
        if isinstance(pricing, dict):
            merged["pricing"] = {**default_manifest["pricing"], **pricing}
        if isinstance(constraints, dict):
            merged["constraints"] = {**default_manifest["constraints"], **constraints}
    return merged


def _load_manifest_parser_doc() -> str:
    doc_path = os.path.abspath(
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
    )
    if not os.path.exists(doc_path):
        return ""
    try:
        with open(doc_path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
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

    service_name = "Imported API Service"
    health_check = ""
    intent = ["api", "imported"]

    if endpoint:
        parsed = urlparse(endpoint)
        path_segments = [seg for seg in parsed.path.split("/") if seg]
        if path_segments:
            service_name = " ".join(
                segment.replace("-", " ") for segment in path_segments[-2:]
            ).title()
            intent = list(dict.fromkeys(path_segments[-3:] + ["api"]))
        if parsed.scheme and parsed.netloc:
            health_check = f"{parsed.scheme}://{parsed.netloc}/health"

    base = _merge_manifest(_service_manifest_template(), current_manifest)
    base["service_name"] = (
        current_manifest.get("service_name")
        if isinstance(current_manifest, dict) and current_manifest.get("service_name")
        else service_name
    )
    base["agent_tool_name"] = (
        current_manifest.get("agent_tool_name")
        if isinstance(current_manifest, dict)
        and current_manifest.get("agent_tool_name")
        else _to_agent_tool_name(base["service_name"])
    )
    base["description"] = (
        current_manifest.get("description")
        if isinstance(current_manifest, dict) and current_manifest.get("description")
        else "Generated from cURL command. Review and refine before deployment."
    )
    base["intent"] = (
        current_manifest.get("intent")
        if isinstance(current_manifest, dict) and current_manifest.get("intent")
        else intent
    )
    base["endpoint"] = endpoint or (
        current_manifest.get("endpoint") if isinstance(current_manifest, dict) else ""
    )
    base["health_check"] = health_check or (
        current_manifest.get("health_check")
        if isinstance(current_manifest, dict)
        else ""
    )

    body = parts.get("body")
    if body is not None:
        base["input_schema"] = _infer_schema_from_json_payload(body)

    if not base.get("output_schema"):
        base["output_schema"] = {
            "type": "object",
            "properties": {},
        }

    return base


def _build_messages(
    curl_command: str, current_manifest: Optional[Dict[str, Any]], parser_doc: str
) -> list[dict[str, str]]:
    current_manifest_payload = (
        current_manifest if isinstance(current_manifest, dict) else {}
    )
    default_manifest = _merge_manifest(
        _service_manifest_template(), current_manifest_payload
    )

    system_prompt = (
        "You are a strict API contract parser for Synapse Network. "
        "Read the Service Manifest Registration guide, parse the given cURL command, and return only a JSON object. "
        "Do not include markdown, explanation, or code fences.\n"
        "Output keys must exactly be: "
        "service_name, agent_tool_name, description, intent, endpoint, health_check, pricing, constraints, input_schema, output_schema.\n"
        "Rules: intent must be string array; pricing fields are currency/amount/type; constraints fields are max_response_bytes/timeout_ms/max_qps; "
        "agent_tool_name uses lowercase letters, numbers, underscore or hyphen only."
    )

    user_payload = {
        "documentation": parser_doc,
        "default_manifest": default_manifest,
        "current_manifest": current_manifest_payload,
        "curl_command": curl_command,
        "instruction": "Return a complete manifest JSON object for the frontend Expected / Generated JSON Response panel.",
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

        merged = _merge_manifest(fallback_manifest, parsed)
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
