import hashlib
import httpx
from dataclasses import dataclass
from typing import Any, Protocol

from src.services.adapters.internal_gateway_auth import build_internal_service_token, payload_digest
from src.services.auth.service import AdminIdentity


class BusinessPolicyAdapter(Protocol):
    def get_policy(self, operator: AdminIdentity) -> dict[str, Any]: ...
    def publish_policy(
        self, *, operator: AdminIdentity, policy: dict[str, Any], published_version: int
    ) -> dict[str, Any]: ...
    def get_overview(self, operator: AdminIdentity) -> dict[str, Any]: ...


@dataclass(slots=True)
class BusinessPolicyAdapterError(Exception):
    code: str
    message: str
    retriable: bool = True

    def __str__(self) -> str:
        return self.message


class HttpBusinessPolicyAdapter:
    def __init__(
        self,
        *,
        base_url: str,
        admin_wallet: str,
        jwt_secret: str,
        token_issuer: str,
        token_audience: str,
        service_subject: str,
        timeout_sec: float,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._admin_wallet = admin_wallet.strip().lower()
        self._jwt_secret = jwt_secret
        self._token_issuer = token_issuer
        self._token_audience = token_audience
        self._service_subject = service_subject
        self._timeout_sec = timeout_sec

    def get_policy(self, operator: AdminIdentity) -> dict[str, Any]:
        return self._request(
            operator=operator,
            scope="business_policy.read",
            method="GET",
            path="/api/v1/admin/business-policy",
            payload={},
        )

    def publish_policy(
        self, *, operator: AdminIdentity, policy: dict[str, Any], published_version: int
    ) -> dict[str, Any]:
        return self._request(
            operator=operator,
            scope="business_policy.write",
            method="PUT",
            path="/api/v1/admin/business-policy",
            payload={"policy": policy, "publishedVersion": published_version},
        )

    def get_overview(self, operator: AdminIdentity) -> dict[str, Any]:
        return self._request(
            operator=operator,
            scope="business_policy.read",
            method="GET",
            path="/api/v1/admin/config-overview",
            payload={},
        )

    def _request(
        self,
        *,
        operator: AdminIdentity,
        scope: str,
        method: str,
        path: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        request_id = f"admin-config:{scope}:{operator.admin_id}"
        body_sha256 = (
            payload_digest(payload)
            if method.upper() != "GET"
            else hashlib.sha256(b"").hexdigest()
        )
        headers = {
            "Authorization": f"Bearer {build_internal_service_token(jwt_secret=self._jwt_secret, issuer=self._token_issuer, audience=self._token_audience, service_subject=self._service_subject, admin_wallet=self._admin_wallet, scope=scope, request_id=request_id, body_sha256=body_sha256, actor=operator)}",
            "X-Request-Id": request_id,
        }
        try:
            response = httpx.request(
                method,
                f"{self._base_url}{path}",
                json=payload if method != "GET" else None,
                headers=headers,
                timeout=self._timeout_sec,
            )
        except httpx.HTTPError as exc:
            raise BusinessPolicyAdapterError(
                code="GATEWAY_UNREACHABLE",
                message=f"Gateway business policy request failed: {exc}",
                retriable=True,
            ) from exc
        body = self._parse_body(response)
        if response.is_success:
            return body
        detail = body.get("detail") if isinstance(body, dict) else {}
        if not isinstance(detail, dict):
            detail = {}
        raw_message = ""
        if isinstance(body, dict):
            raw_message = str(body.get("raw") or body.get("detail") or "").strip()
        raise BusinessPolicyAdapterError(
            code=str(detail.get("code") or f"GATEWAY_HTTP_{response.status_code}"),
            message=str(
                detail.get("message")
                or raw_message
                or response.text
                or "Gateway business policy request failed"
            ),
            retriable=response.status_code >= 500 or response.status_code in {408, 409, 429},
        )

    @staticmethod
    def _parse_body(response: httpx.Response) -> dict[str, Any]:
        try:
            payload = response.json()
        except ValueError:
            return {"raw": response.text}
        return payload if isinstance(payload, dict) else {"raw": payload}
