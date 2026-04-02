import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

import requests

CONFIG_PATH = Path(__file__).with_name("agent_sdk_discover_invoke.config.json")
CONTENT_TYPE_JSON = "application/json"


def load_config() -> Dict[str, Any]:
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(f"Config file not found: {CONFIG_PATH}")

    with CONFIG_PATH.open("r", encoding="utf-8") as file:
        config = json.load(file)

    required = ["api_base", "agent_credential_token", "intent", "prompt"]
    missing = [key for key in required if not str(config.get(key, "")).strip()]
    if missing:
        raise ValueError(f"Missing required config fields: {', '.join(missing)}")

    return config


def discover_services(api_base: str, intent: str) -> List[Dict[str, Any]]:
    url = f"{api_base.rstrip('/')}/api/v1/services/discover"
    response = requests.get(url, params={"intent": intent}, timeout=30)
    response.raise_for_status()

    payload = response.json()
    if payload.get("status") != "success":
        raise RuntimeError(f"Discover failed: {json.dumps(payload, ensure_ascii=False)}")

    services = payload.get("services", [])
    if not isinstance(services, list):
        raise RuntimeError(f"Invalid discover response format: {json.dumps(payload, ensure_ascii=False)}")

    return services


def pick_service(services: List[Dict[str, Any]]) -> Tuple[str, Dict[str, Any]]:
    if not services:
        raise RuntimeError("No services found from discover response")

    target = services[0]
    service_id = str(target.get("serviceId") or "").strip()
    if not service_id:
        raise RuntimeError(f"serviceId missing in discover service row: {json.dumps(target, ensure_ascii=False)}")

    return service_id, target


def call_gateway(api_base: str, service_id: str, credential_token: str, prompt: str) -> Dict[str, Any]:
    url = f"{api_base.rstrip('/')}/api/v1/gateway/generate"
    response = requests.post(
        url,
        headers={
            "Content-Type": CONTENT_TYPE_JSON,
            "X-Credential": credential_token,
        },
        json={
            "prompt": prompt,
            "serviceId": service_id,
        },
        timeout=60,
    )
    try:
        payload = response.json()
    except Exception:
        payload = {"raw": response.text}

    return {
        "statusCode": response.status_code,
        "ok": response.ok,
        "payload": payload,
    }


def main() -> None:
    config = load_config()
    api_base = str(config["api_base"]).strip()
    credential_token = str(config["agent_credential_token"]).strip()
    intent = str(config["intent"]).strip()
    prompt = str(config["prompt"]).strip()

    print("=== 1) Discover Services ===")
    print(f"request: GET {api_base}/api/v1/services/discover?intent={intent}")
    services = discover_services(api_base, intent)
    print(f"found services: {len(services)}")

    service_id, service_row = pick_service(services)
    print("selected service:")
    print(json.dumps({
        "serviceId": service_id,
        "serviceName": service_row.get("serviceName"),
        "pricing": service_row.get("pricing"),
        "summary": service_row.get("summary"),
        "tags": service_row.get("tags"),
    }, ensure_ascii=False, indent=2))

    print("\n=== 2) Invoke Through Platform Gateway ===")
    print(f"request: POST {api_base}/api/v1/gateway/generate")
    result = call_gateway(api_base, service_id, credential_token, prompt)

    print("\n=== 3) Request Result ===")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}")
        raise
