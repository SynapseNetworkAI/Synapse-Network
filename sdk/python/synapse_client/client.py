import os
import time
from typing import Any, Dict, Optional
from uuid import uuid4

import requests

from .exceptions import (
    AuthenticationError,
    BudgetExceededError,
    DiscoveryError,
    InsufficientFundsError,
    InvokeError,
    QuoteError,
)
from .models import (
    DiscoveryResponse,
    InvocationResponse,
    QuoteInputPreview,
    QuoteResponse,
    RuntimePayload,
    SynapseResponse,
)


TERMINAL_STATUSES = {"SUCCEEDED", "FAILED_RETRYABLE", "FAILED_FINAL", "SETTLED"}


class SynapseClient:
    """Official Python client for Synapse agent discovery, quote, invoke, and receipt APIs."""

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

    def _headers(self, request_id: Optional[str] = None) -> Dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "X-Credential": self.api_key,
        }
        if request_id:
            headers["X-Request-Id"] = request_id
        return headers

    @staticmethod
    def _response_payload(response: requests.Response) -> Dict[str, Any]:
        try:
            data = response.json()
            return data if isinstance(data, dict) else {}
        except ValueError:
            return {}

    @classmethod
    def _error_message(cls, response: requests.Response, fallback: str) -> str:
        payload = cls._response_payload(response)
        detail = payload.get("detail")
        if isinstance(detail, dict):
            return str(detail.get("message") or detail.get("code") or fallback)
        if isinstance(detail, str) and detail.strip():
            return detail.strip()
        return response.text.strip() or fallback

    @classmethod
    def _error_code(cls, response: requests.Response) -> str:
        payload = cls._response_payload(response)
        detail = payload.get("detail")
        if isinstance(detail, dict):
            return str(detail.get("code") or "")
        return ""

    def _raise_for_error(self, response: requests.Response, default_error: Exception) -> None:
        if response.ok:
            return

        error_code = self._error_code(response)
        message = self._error_message(response, str(default_error))

        if response.status_code == 401:
            raise AuthenticationError(message)

        if response.status_code == 402:
            if error_code in {"BUDGET_EXHAUSTED", "CREDENTIAL_CREDIT_LIMIT_EXCEEDED"}:
                raise InsufficientFundsError(message)
            raise BudgetExceededError(message)

        if isinstance(default_error, DiscoveryError):
            raise DiscoveryError(message)
        if isinstance(default_error, QuoteError):
            raise QuoteError(message)
        raise InvokeError(message)

    def search_services(
        self,
        *,
        query: Optional[str] = None,
        tags: Optional[list[str]] = None,
        page: int = 1,
        page_size: int = 10,
        sort: str = "best_match",
        request_id: Optional[str] = None,
    ) -> DiscoveryResponse:
        """Search discoverable services through the agent-facing discovery contract."""
        payload: Dict[str, Any] = {
            "tags": tags or [],
            "page": page,
            "pageSize": page_size,
            "sort": sort,
        }
        if query:
            payload["query"] = query

        response = requests.post(
            f"{self.gateway_url}/api/v1/agent/discovery/search",
            headers=self._headers(request_id=request_id),
            json=payload,
            timeout=self.timeout_sec,
        )
        self._raise_for_error(response, DiscoveryError("service discovery failed"))
        return DiscoveryResponse(**self._response_payload(response))

    def discover_services(
        self,
        intent: Optional[str] = None,
        *,
        tags: Optional[list[str]] = None,
        page: int = 1,
        page_size: int = 10,
        sort: str = "best_match",
        request_id: Optional[str] = None,
    ) -> DiscoveryResponse:
        """Backward-compatible alias for agent discovery search."""
        return self.search_services(
            query=intent,
            tags=tags,
            page=page,
            page_size=page_size,
            sort=sort,
            request_id=request_id,
        )

    def create_quote(
        self,
        service_id: str,
        *,
        input_preview: Optional[Dict[str, Any]] = None,
        response_mode: str = "sync",
        request_id: Optional[str] = None,
    ) -> QuoteResponse:
        """Create a short-lived quote for a service invocation."""
        if not service_id or not service_id.strip():
            raise ValueError("service_id is required")

        preview = QuoteInputPreview(**(input_preview or {}))
        payload = {
            "serviceId": service_id.strip(),
            "inputPreview": preview.model_dump(by_alias=True, exclude_none=True),
            "responseMode": response_mode,
        }
        response = requests.post(
            f"{self.gateway_url}/api/v1/agent/quotes",
            headers=self._headers(request_id=request_id),
            json=payload,
            timeout=self.timeout_sec,
        )
        self._raise_for_error(response, QuoteError("quote creation failed"))
        quote = QuoteResponse(**self._response_payload(response))

        if not quote.budget_check.allowed:
            raise BudgetExceededError("Credential budget does not allow this invocation")

        return quote

    def create_invocation(
        self,
        quote_id: str,
        *,
        payload: Optional[Dict[str, Any]] = None,
        idempotency_key: Optional[str] = None,
        response_mode: str = "sync",
        request_id: Optional[str] = None,
    ) -> InvocationResponse:
        """Invoke a quoted service call using an idempotency key."""
        if not quote_id or not quote_id.strip():
            raise ValueError("quote_id is required")

        invocation_key = (idempotency_key or f"invoke-{uuid4().hex}").strip()
        runtime_payload = RuntimePayload(body=payload or {})
        body = {
            "quoteId": quote_id.strip(),
            "idempotencyKey": invocation_key,
            "payload": runtime_payload.model_dump(by_alias=True),
            "responseMode": response_mode,
        }
        response = requests.post(
            f"{self.gateway_url}/api/v1/agent/invocations",
            headers=self._headers(request_id=request_id),
            json=body,
            timeout=self.timeout_sec,
        )
        self._raise_for_error(response, InvokeError("service invocation failed"))
        return InvocationResponse(**self._response_payload(response))

    def get_invocation_receipt(self, invocation_id: str) -> InvocationResponse:
        """Fetch the latest state for an invocation."""
        if not invocation_id or not invocation_id.strip():
            raise ValueError("invocation_id is required")

        response = requests.get(
            f"{self.gateway_url}/api/v1/agent/invocations/{invocation_id.strip()}",
            headers=self._headers(),
            timeout=self.timeout_sec,
        )
        self._raise_for_error(response, InvokeError("invocation receipt lookup failed"))
        return InvocationResponse(**self._response_payload(response))

    def wait_for_invocation(
        self,
        invocation_id: str,
        *,
        max_wait_sec: int = 90,
        poll_interval_sec: int = 1,
    ) -> InvocationResponse:
        """Poll receipt state until the invocation reaches a terminal status."""
        started = time.time()
        while True:
            receipt = self.get_invocation_receipt(invocation_id)
            if receipt.status in TERMINAL_STATUSES:
                return receipt
            if time.time() - started + max(1, poll_interval_sec) > max_wait_sec:
                raise InvokeError("Synapse invocation pending timeout.")
            time.sleep(max(1, poll_interval_sec))

    def invoke_service(
        self,
        service_id: str,
        *,
        payload: Optional[Dict[str, Any]] = None,
        input_preview: Optional[Dict[str, Any]] = None,
        idempotency_key: Optional[str] = None,
        response_mode: str = "sync",
        poll_pending: bool = True,
        max_wait_sec: int = 90,
        request_id: Optional[str] = None,
    ) -> InvocationResponse:
        """Run the full discovery-contract execution path: quote then invoke then optional receipt polling."""
        preview_payload = input_preview
        if preview_payload is None:
            preview_payload = {
                "sample": {"body": payload or {}},
                "payloadSchema": {"body": {}},
            }

        quote = self.create_quote(
            service_id,
            input_preview=preview_payload,
            response_mode=response_mode,
            request_id=request_id,
        )
        invocation = self.create_invocation(
            quote.quote_id,
            payload=payload,
            idempotency_key=idempotency_key,
            response_mode=response_mode,
            request_id=request_id,
        )

        if invocation.status in TERMINAL_STATUSES:
            return invocation
        if not poll_pending:
            return invocation
        return self.wait_for_invocation(invocation.invocation_id, max_wait_sec=max_wait_sec)

    def call_service(
        self,
        service_id: str,
        payload: Optional[Dict[str, Any]] = None,
        prompt: Optional[str] = None,
        poll_pending: bool = True,
        max_wait_sec: int = 90,
        **kwargs: Any
    ) -> SynapseResponse:
        """Compatibility helper that internally performs quote then invoke."""
        if not service_id or not service_id.strip():
            raise ValueError("service_id is required")

        final_payload: Dict[str, Any] = {}
        if payload is not None:
            final_payload.update(payload)
        elif prompt is not None:
            final_payload["prompt"] = prompt

        reserved_keys = {"request_id", "idempotency_key", "response_mode"}
        final_payload.update(
            {
                key: value
                for key, value in kwargs.items()
                if key not in reserved_keys and value is not None
            }
        )

        request_id = None
        if "request_id" in kwargs and kwargs["request_id"] is not None:
            request_id = str(kwargs["request_id"])

        invocation = self.invoke_service(
            service_id=service_id,
            payload=final_payload,
            idempotency_key=str(kwargs.get("idempotency_key") or "") or None,
            response_mode=str(kwargs.get("response_mode") or "sync"),
            poll_pending=poll_pending,
            max_wait_sec=max_wait_sec,
            request_id=request_id,
        )

        if not invocation.succeeded:
            if invocation.error is not None:
                raise InvokeError(invocation.error.message)
            raise InvokeError("Synapse network invoke failed.")

        return SynapseResponse(
            content=invocation.result,
            invocationId=invocation.invocation_id,
            status=invocation.status,
            feeDeducted=float(invocation.charged_usdc),
            receipt=invocation.receipt.model_dump(by_alias=True) if invocation.receipt is not None else {},
            rawResponse=invocation.model_dump(by_alias=True, exclude_none=True),
            quoteId=invocation.receipt.quote_id if invocation.receipt is not None else None,
        )
