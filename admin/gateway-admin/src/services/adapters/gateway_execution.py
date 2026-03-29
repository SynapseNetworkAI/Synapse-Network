import hashlib
import json
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from src.domain import AdminExecutionJob
from src.services.adapters.internal_gateway_auth import build_internal_service_token, payload_digest
from src.services.auth.service import AdminIdentity


def _resolve_command(job: AdminExecutionJob) -> dict[str, str]:
    resource_id = str(job.request_payload.get("resourceId") or "").strip()
    if job.execution_type == "deposit_repair":
        return {"name": "deposit_replay", "path": "/api/v1/admin/deposits/replay", "scope": "deposit.replay"}
    if job.execution_type == "refund_approve":
        return {"name": "refund_complete", "path": f"/api/v1/admin/refunds/{resource_id}/complete", "scope": "refund.complete"}
    if job.execution_type == "withdrawal_approve":
        return {"name": "withdrawal_complete", "path": f"/api/v1/admin/providers/withdrawals/{resource_id}/complete", "scope": "provider_withdraw.complete"}
    raise GatewayExecutionError(
        code="UNSUPPORTED_EXECUTION_TYPE",
        message=f"Execution type {job.execution_type} is not wired to a gateway command.",
        retriable=False,
    )


def _build_request_payload(
    job: AdminExecutionJob,
    command: dict[str, str],
    admin_wallet: str,
) -> dict[str, Any]:
    tx_hash = _payload_value(job, "txHash").lower()
    owner_address = _payload_value(job, "ownerAddress").lower()
    resource_id = _payload_value(job, "resourceId")
    if command["name"] == "deposit_replay":
        if not tx_hash:
            raise GatewayExecutionError(
                code="MISSING_TX_HASH",
                message="deposit_repair execution requires payload.txHash.",
                retriable=False,
            )
        return {"txHash": tx_hash}
    if command["name"] == "refund_complete":
        if not resource_id or not owner_address or not tx_hash:
            raise GatewayExecutionError(
                code="MISSING_REFUND_EXECUTION_FIELDS",
                message="refund_approve execution requires payload.resourceId, payload.ownerAddress, and payload.txHash.",
                retriable=False,
            )
        return {
            "ownerAddress": owner_address,
            "txHash": tx_hash,
            "reviewDecision": str(job.request_payload.get("reviewDecision") or "APPROVE").strip().upper(),
            "reviewerAddress": admin_wallet,
            "reviewerNote": str(job.request_payload.get("reviewerNote") or "approved via gateway-admin execution job").strip(),
        }
    if command["name"] == "withdrawal_complete":
        if not resource_id or not owner_address or not tx_hash:
            raise GatewayExecutionError(
                code="MISSING_WITHDRAWAL_EXECUTION_FIELDS",
                message="withdrawal_approve execution requires payload.resourceId, payload.ownerAddress, and payload.txHash.",
                retriable=False,
            )
        return {
            "ownerAddress": owner_address,
            "txHash": tx_hash,
        }
    raise GatewayExecutionError(
        code="UNSUPPORTED_EXECUTION_TYPE",
        message=f"Execution type {job.execution_type} is not wired to a gateway command.",
        retriable=False,
    )


def _payload_value(job: AdminExecutionJob, key: str) -> str:
    return str(job.request_payload.get(key) or "").strip()


class GatewayExecutionAdapter(Protocol):
    def execute_job(self, job: AdminExecutionJob, operator: AdminIdentity) -> dict[str, Any]: ...


@dataclass(slots=True)
class GatewayExecutionError(Exception):
    code: str
    message: str
    retriable: bool = True
    result_payload: dict[str, Any] | None = None

    def __str__(self) -> str:
        return self.message


class InMemoryGatewayExecutionAdapter:
    def execute_job(self, job: AdminExecutionJob, operator: AdminIdentity) -> dict[str, Any]:
        _ = operator
        command = _resolve_command(job)
        _build_request_payload(job, command, "inmemory-admin-wallet")
        return {
            "command": command["name"],
            "gatewayResponse": {
                "status": "success",
                "requestedBy": "inmemory-admin-wallet",
                "resourceId": job.request_payload.get("resourceId"),
                "txHash": job.request_payload.get("txHash"),
            },
        }


class HttpGatewayExecutionAdapter:
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

    def execute_job(self, job: AdminExecutionJob, operator: AdminIdentity) -> dict[str, Any]:
        command = _resolve_command(job)
        if not self._admin_wallet:
            raise GatewayExecutionError(
                code="GATEWAY_ADMIN_WALLET_NOT_CONFIGURED",
                message="GATEWAY_INTERNAL_ADMIN_WALLET is required for gateway execution.",
                retriable=False,
            )

        request_payload = _build_request_payload(job, command, self._admin_wallet)
        request_id = f"exec:{job.approval_id}:{job.job_id}:{job.retry_count}"
        headers = {
            "Authorization": f"Bearer {self._build_gateway_token(operator, command['scope'], request_payload, request_id)}",
            "X-Request-Id": request_id,
        }
        try:
            response = httpx.post(
                f"{self._base_url}{command['path']}",
                json=request_payload,
                headers=headers,
                timeout=self._timeout_sec,
            )
        except httpx.HTTPError as exc:
            raise GatewayExecutionError(
                code="GATEWAY_UNREACHABLE",
                message=f"Gateway execution request failed: {exc}",
                retriable=True,
            ) from exc

        body = self._parse_body(response)
        if response.is_success:
            return {
                "command": command["name"],
                "gatewayResponse": body,
            }

        detail = body.get("detail") if isinstance(body, dict) else {}
        code = str(detail.get("code") or f"GATEWAY_HTTP_{response.status_code}")
        message = str(detail.get("message") or response.text or "Gateway execution failed")
        raise GatewayExecutionError(
            code=code,
            message=message,
            retriable=response.status_code >= 500 or response.status_code in {408, 409, 429},
            result_payload={
                "statusCode": response.status_code,
                "response": body,
            },
        )

    @staticmethod
    def build_response_digest(payload: dict[str, Any]) -> str:
        return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    def _build_gateway_token(
        self,
        operator: AdminIdentity,
        scope: str,
        payload: dict[str, Any],
        request_id: str,
    ) -> str:
        return build_internal_service_token(
            jwt_secret=self._jwt_secret,
            issuer=self._token_issuer,
            audience=self._token_audience,
            service_subject=self._service_subject,
            admin_wallet=self._admin_wallet,
            scope=scope,
            request_id=request_id,
            body_sha256=payload_digest(payload),
            actor=operator,
        )

    @staticmethod
    def _parse_body(response: httpx.Response) -> dict[str, Any]:
        try:
            payload = response.json()
        except ValueError:
            return {"raw": response.text}
        return payload if isinstance(payload, dict) else {"raw": payload}