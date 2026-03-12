import time
import os
from typing import Any, Dict, List, Optional

import requests

from .exceptions import DiscoveryError, InvokeError, InsufficientFundsError, AuthenticationError
from .models import DiscoveryResponse, ToolSpec, SynapseResponse, DiscoveredService


class SynapseClient:
    """The official Python client for interacting with Synapse Network AI services."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        gateway_url: str = "http://127.0.0.1:8000",
        timeout_sec: int = 30,
    ):
        # Resolve api_key from arguments or environment variable
        self.api_key = (api_key or os.getenv("SYNAPSE_API_KEY", "")).strip()
        self.gateway_url = gateway_url.rstrip("/")
        self.timeout_sec = timeout_sec

        if not self.api_key:
            raise ValueError("api_key is required. Pass it via init or set SYNAPSE_API_KEY env var.")

    def discover_services(self, intent: Optional[str] = None) -> DiscoveryResponse:
        """Dynamically fetch all available AI services on the Synapse Network."""
        url = f"{self.gateway_url}/api/v2/services/discover"
        params: Dict[str, str] = {}
        if intent:
            params["intent"] = intent

        response = requests.get(url, params=params, timeout=self.timeout_sec)
        if not response.ok:
            raise DiscoveryError(response.text or "service discovery failed")

        data = response.json()
        return DiscoveryResponse(**data)

    def call_service(
        self,
        service_id: str,
        payload: Optional[Dict[str, Any]] = None,
        prompt: Optional[str] = None,
        poll_pending: bool = True,
        max_wait_sec: int = 90,
        **kwargs: Any
    ) -> SynapseResponse:
        """
        Call a specific AI service efficiently.
        
        Args:
            service_id: The Target ID of the service (e.g. DeepSeek-R1-2501 or SVC_xxx)
            payload: Arbitrary JSON dictionary representing the upstream API request body. 
                     (e.g., {"messages": [...], "temperature": 0.7})
            prompt: Simplified text prompt, acts as a fallback if payload is not provided.
            poll_pending: Whether to automatically poll if the gateway returns 202 Async.
            kwargs: Additional keys to merge into the top-level request body.
        """
        if not service_id or not service_id.strip():
            raise ValueError("service_id is required")

        url = f"{self.gateway_url}/api/v2/generate"
        headers = {
            "Content-Type": "application/json",
            "X-Service-Id": service_id,
            "X-Agent-Credential": self.api_key,
        }

        # Build payload dynamically
        final_payload = {}
        if payload is not None:
            final_payload.update(payload)
        elif prompt is not None:
            final_payload["prompt"] = prompt

        body = {
            "service_id": service_id,
            **final_payload,
            **kwargs
        }

        started = time.time()
        while True:
            response = requests.post(url, headers=headers, json=body, timeout=self.timeout_sec)

            if response.status_code == 401:
                raise AuthenticationError("Invalid API Key or unauthorized access.")
            if response.status_code == 402:
                raise InsufficientFundsError("Insufficient USDC balance in your Agent account. Please top up.")

            if response.status_code == 202 and poll_pending:
                retry_after = 2
                try:
                    retry_after = int(response.json().get("retryAfterSec", 2))
                except Exception:
                    pass

                if time.time() - started + retry_after > max_wait_sec:
                    raise InvokeError("Synapse network invoke pending timeout.")
                time.sleep(max(1, retry_after))
                continue

            if not response.ok:
                raise InvokeError(response.text or "Synapse network invoke failed.")

            data = response.json()
            
            # Unpack response
            return SynapseResponse(
                content=data.get("result", {}).get("answer", data.get("result", "")),
                tx_hash=data.get("routerTxHash") or data.get("txHash"),
                fee_deducted=float(data.get("usage", {}).get("fee", 0.0)),
                raw_response=data
            )
