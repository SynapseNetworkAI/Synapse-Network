from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from src.services.adapters.internal_gateway_auth import (
    build_internal_service_token,
    payload_digest,
)
from src.services.auth.service import AdminIdentity


class ProviderServicesAdapter(Protocol):
    def list_services(self, *, actor: AdminIdentity, params: dict[str, Any]) -> dict[str, Any]: ...
    def get_service(self, *, actor: AdminIdentity, service_id: str) -> dict[str, Any]: ...
    def force_probe(self, *, actor: AdminIdentity, service_id: str) -> dict[str, Any]: ...
    def update_lifecycle(
        self,
        *,
        actor: AdminIdentity,
        service_id: str,
        action: str,
        note: str | None,
    ) -> dict[str, Any]: ...
    def delete_service(
        self,
        *,
        actor: AdminIdentity,
        service_id: str,
        note: str | None,
    ) -> dict[str, Any]: ...


@dataclass(slots=True)
class ProviderServicesAdapterError(Exception):
    code: str
    message: str
    status_code: int = 400

    def __str__(self) -> str:
        return self.message


class HttpProviderServicesAdapter:
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

    def list_services(self, *, actor: AdminIdentity, params: dict[str, Any]) -> dict[str, Any]:
        return self._request(
            "GET",
            "/api/v1/admin/provider-services",
            actor=actor,
            scope="provider_services.read",
            params=params,
        )

    def get_service(self, *, actor: AdminIdentity, service_id: str) -> dict[str, Any]:
        return self._request(
            "GET",
            f"/api/v1/admin/provider-services/{service_id}",
            actor=actor,
            scope="provider_services.read",
        )

    def force_probe(self, *, actor: AdminIdentity, service_id: str) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/v1/admin/provider-services/{service_id}/force-probe",
            actor=actor,
            scope="provider_services.write",
            payload={},
        )

    def update_lifecycle(
        self,
        *,
        actor: AdminIdentity,
        service_id: str,
        action: str,
        note: str | None,
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/v1/admin/provider-services/{service_id}/lifecycle",
            actor=actor,
            scope="provider_services.write",
            payload={"action": action, "note": note},
        )

    def delete_service(
        self,
        *,
        actor: AdminIdentity,
        service_id: str,
        note: str | None,
    ) -> dict[str, Any]:
        return self._request(
            "DELETE",
            f"/api/v1/admin/provider-services/{service_id}",
            actor=actor,
            scope="provider_services.write",
            payload={"note": note},
        )

    def _request(
        self,
        method: str,
        path: str,
        *,
        actor: AdminIdentity,
        scope: str,
        params: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not self._admin_wallet:
            raise ProviderServicesAdapterError(
                code="GATEWAY_ADMIN_WALLET_NOT_CONFIGURED",
                message="GATEWAY_INTERNAL_ADMIN_WALLET is required for provider service management.",
                status_code=500,
            )
        request_id = f"provider-services:{method.lower()}:{path.rsplit('/', 1)[-1]}"
        body_sha256 = (
            payload_digest(payload)
            if payload is not None
            else hashlib.sha256(b"").hexdigest()
        )
        headers = {
            "Authorization": f"Bearer {self._build_gateway_token(actor, scope, request_id, body_sha256)}",
            "X-Request-Id": request_id,
        }
        clean_params = {
            key: value
            for key, value in (params or {}).items()
            if value is not None and value != ""
        } or None
        try:
            response = httpx.request(
                method,
                f"{self._base_url}{path}",
                params=clean_params,
                json=payload,
                headers=headers,
                timeout=self._timeout_sec,
            )
        except httpx.HTTPError as exc:
            raise ProviderServicesAdapterError(
                code="GATEWAY_UNREACHABLE",
                message=f"Gateway provider service request failed: {exc}",
                status_code=502,
            ) from exc
        body = self._parse_body(response)
        if response.is_success:
            return body
        detail = body.get("detail") if isinstance(body, dict) else {}
        raise ProviderServicesAdapterError(
            code=str(detail.get("code") or f"GATEWAY_HTTP_{response.status_code}"),
            message=str(detail.get("message") or response.text or "Gateway provider service request failed"),
            status_code=response.status_code,
        )

    def _build_gateway_token(
        self,
        actor: AdminIdentity,
        scope: str,
        request_id: str,
        body_sha256: str,
    ) -> str:
        return build_internal_service_token(
            jwt_secret=self._jwt_secret,
            issuer=self._token_issuer,
            audience=self._token_audience,
            service_subject=self._service_subject,
            admin_wallet=self._admin_wallet,
            scope=scope,
            request_id=request_id,
            body_sha256=body_sha256,
            actor=actor,
        )

    @staticmethod
    def _parse_body(response: httpx.Response) -> dict[str, Any]:
        try:
            payload = response.json()
        except ValueError:
            return {"raw": response.text}
        return payload if isinstance(payload, dict) else {"raw": payload}
