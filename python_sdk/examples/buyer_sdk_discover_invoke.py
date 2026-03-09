import json
import os

from buyer_sdk import AgentPayBuyer


def main() -> None:
    gateway = os.getenv("API_BASE", "http://127.0.0.1:8000")
    token = os.getenv("AGENT_CREDENTIAL_TOKEN", "").strip()
    tx_hash = os.getenv("TX_HASH", "").strip()

    if not token:
        raise RuntimeError("Missing AGENT_CREDENTIAL_TOKEN")
    if not tx_hash:
        raise RuntimeError("Missing TX_HASH")

    client = AgentPayBuyer(credential_token=token, gateway_url=gateway)

    discovery = client.discover_services(intent="名人名言")
    print("[discover]")
    print(json.dumps(discovery, indent=2, ensure_ascii=False))

    services = discovery.get("services", [])
    if not services:
        raise RuntimeError("No services found for current intent")

    target = services[0]
    service_id = target["serviceId"]

    result = client.invoke_service(
        service_id=service_id,
        payload={
            "prompt": "请给我一句关于坚持的名人名言",
        },
        tx_hash=tx_hash,
    )

    print("[invoke]")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
