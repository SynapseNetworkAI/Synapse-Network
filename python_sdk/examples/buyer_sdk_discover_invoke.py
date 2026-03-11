import json
import sys
import uuid
from pathlib import Path

try:
    from buyer_sdk import SynapseBuyer
except ModuleNotFoundError:
    root = Path(__file__).resolve().parents[2]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from python_sdk.buyer_sdk import SynapseBuyer


CONFIG_PATH = Path(__file__).with_name("buyer_sdk_discover_invoke.config.json")


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        raise RuntimeError(f"Missing config file: {CONFIG_PATH}")

    with CONFIG_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


def main() -> None:
    config = load_config()
    gateway = str(config.get("api_base", "http://127.0.0.1:8000")).strip()
    token = str(config.get("agent_credential_token", "")).strip()
    tx_hash = str(config.get("tx_hash", "")).strip()
    raw_intent = config.get("intent", "名人名言")
    intent = str(raw_intent).strip() if raw_intent is not None else ""
    prompt = str(config.get("prompt", "请给我一句关于坚持的名人名言")).strip() or "请给我一句关于坚持的名人名言"

    if not token:
        raise RuntimeError("Missing 'agent_credential_token' in config file")

    client = SynapseBuyer(credential_token=token, gateway_url=gateway)

    discovery = client.discover_services(intent=intent or None)
    print("[discover]")
    print(json.dumps(discovery, indent=2, ensure_ascii=False))

    services = discovery.get("services", [])
    if not services:
        raise RuntimeError("No services found for current intent")

    target = services[0]
    service_id = target["serviceId"]

    # Generate a unique request ID for transaction tracking
    my_request_id = str(uuid.uuid4())
    print(f"[*] Generated Request ID: {my_request_id}\n")

    result = client.invoke_service(
        service_id=service_id,
        payload={
            "prompt": prompt,
        },
        tx_hash=tx_hash,
        request_id=my_request_id,
    )

    print(f"[invoke success for requestId: {my_request_id}]")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
