import time
from typing import Any, Dict, List, Optional

import requests

from .exceptions import DiscoveryError, InvokeError
from .models import DiscoveryResponse, ToolSpec


class AgentPayBuyer:
    """Buyer-side sdk for discovery + paid invoke."""

    def __init__(
        self,
        credential_token: str,
        gateway_url: str = "http://127.0.0.1:8000",
        timeout_sec: int = 30,
    ):
        self.credential_token = credential_token.strip()
        self.gateway_url = gateway_url.rstrip("/")
        self.timeout_sec = timeout_sec

        if not self.credential_token:
            raise ValueError("credential_token is required")

    def discover_services(self, intent: Optional[str] = None) -> DiscoveryResponse:
        url = f"{self.gateway_url}/api/v2/services/discover"
        params: Dict[str, str] = {}
        if intent:
            params["intent"] = intent

        response = requests.get(url, params=params, timeout=self.timeout_sec)
        if not response.ok:
            raise DiscoveryError(response.text or "service discovery failed")

        data = response.json()
        return data

    def invoke_service(
        self,
        service_id: str,
        payload: Dict[str, Any],
        tx_hash: str = "",
        request_id: str = "",
        poll_pending: bool = True,
        max_wait_sec: int = 90,
    ) -> Dict[str, Any]:
        if not service_id.strip():
            raise ValueError("service_id is required")

        url = f"{self.gateway_url}/api/v2/generate"
        headers = {
            "Content-Type": "application/json",
            "X-Service-Id": service_id,
            "X-Agent-Credential": self.credential_token,
        }
        if tx_hash.strip():
            headers["X-Tx-Hash"] = tx_hash
        if request_id.strip():
            headers["X-Request-Id"] = request_id.strip()

        body = dict(payload)
        body.setdefault("service_id", service_id)

        started = time.time()
        while True:
            response = requests.post(url, headers=headers, json=body, timeout=self.timeout_sec)

            if response.status_code == 202 and poll_pending:
                retry_after = 2
                try:
                    retry_after = int(response.json().get("retryAfterSec", 2))
                except Exception:
                    retry_after = 2

                if time.time() - started + retry_after > max_wait_sec:
                    raise InvokeError("invoke pending timeout")
                time.sleep(max(1, retry_after))
                continue

            if not response.ok:
                raise InvokeError(response.text or "invoke failed")

            return response.json()

    @staticmethod
    def build_tools_from_discovery(discovery: DiscoveryResponse) -> List[ToolSpec]:
        tools: List[ToolSpec] = []
        for service in discovery.get("services", []):
            service_id = str(service.get("serviceId", "")).strip()
            if not service_id:
                continue

            service_name = str(service.get("serviceName", service_id))
            summary = str(service.get("summary", "") or "")
            request_schema = (
                service.get("invoke", {}).get("request", {}).get("schema")
                or {"type": "object", "properties": {}}
            )

            tools.append(
                {
                    "type": "function",
                    "function": {
                        "name": f"invoke_{service_id.lower()}",
                        "description": f"{service_name}. {summary}".strip(),
                        "parameters": request_schema,
                    },
                }
            )
        return tools
