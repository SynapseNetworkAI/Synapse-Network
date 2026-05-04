"""Agent SDK 服务发现 + 调用示例

演示 Consumer 通过 Synapse Gateway 执行完整的「发现服务 → 选择最优 → 调用」链路。
需要配置文件: agent_sdk_discover_invoke.config.json（同目录）。

使用方式:
    python agent_sdk_discover_invoke.py
"""

import json
import uuid
from pathlib import Path
from typing import Any, Dict, List, Tuple

import requests

# ── 配置文件路径：与本脚本同目录下的 .config.json ──
CONFIG_PATH = Path(__file__).with_name("agent_sdk_discover_invoke.config.json")
CONTENT_TYPE_JSON = "application/json"


def load_config() -> Dict[str, Any]:
    """加载配置文件并校验必填字段。

    配置字段说明:
        api_base              - Gateway API 地址，如 http://127.0.0.1:8000
        agent_credential_token - Agent 凭据令牌（从 /credentials/agent/issue 获取）
        intent                - 语义搜索意图，用于服务发现（如 "名人名言"）
        prompt                - 调用服务时发送的提示词
    """
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
    """根据语义意图（intent）发现可用服务列表。

    调用 GET /api/v1/services/discover?intent=xxx
    返回按相关度排序的服务列表。
    """
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
    """从发现结果中选取第一个服务（相关度最高）。"""
    if not services:
        raise RuntimeError("No services found from discover response")

    target = services[0]
    service_id = str(target.get("serviceId") or "").strip()
    if not service_id:
        raise RuntimeError(f"serviceId missing in discover service row: {json.dumps(target, ensure_ascii=False)}")

    return service_id, target


def _service_price_usdc(service_row: Dict[str, Any]) -> str:
    pricing = service_row.get("pricing") if isinstance(service_row.get("pricing"), dict) else {}
    value = (
        service_row.get("basePriceUsdc")
        or service_row.get("priceUsdc")
        or service_row.get("unitPrice")
        or pricing.get("amount")
    )
    if value is None:
        raise RuntimeError(f"price missing in discovery row: {json.dumps(service_row, ensure_ascii=False)}")
    return str(value)


def call_gateway(
    api_base: str,
    service_id: str,
    service_row: Dict[str, Any],
    credential_token: str,
    prompt: str,
) -> Dict[str, Any]:
    """通过 Gateway 调用指定服务。

    POST /api/v1/agent/invoke
    请求头 X-Credential 携带 Agent 凭据令牌。
    """
    url = f"{api_base.rstrip('/')}/api/v1/agent/invoke"
    response = requests.post(
        url,
        headers={
            "Content-Type": CONTENT_TYPE_JSON,
            "X-Credential": credential_token,
        },
        json={
            "serviceId": service_id,
            "idempotencyKey": f"agent-sdk-example-{uuid.uuid4().hex}",
            "costUsdc": _service_price_usdc(service_row),
            "payload": {"body": {"text": prompt}},
            "responseMode": "sync",
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
    """主流程: 加载配置 → 发现服务 → 选择服务 → 调用 Gateway → 打印结果。"""
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
    print(f"request: POST {api_base}/api/v1/agent/invoke")
    result = call_gateway(api_base, service_id, service_row, credential_token, prompt)

    print("\n=== 3) Request Result ===")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}")
        raise
