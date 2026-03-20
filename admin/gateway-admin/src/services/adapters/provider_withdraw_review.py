import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any, Protocol

import httpx
import jwt

from src.services.auth.service import AdminIdentity
from src.storage.analytics.provider_withdraw_review import (
    InMemoryProviderWithdrawReviewRepository,
    ProviderWithdrawReviewItem,
)


class ProviderWithdrawReviewAdapter(Protocol):
    def review_withdrawal(
        self,
        item: ProviderWithdrawReviewItem,
        *,
        decision: str,
        reviewer: AdminIdentity,
        note: str,
    ) -> dict[str, Any]: ...


@dataclass(slots=True)
class ProviderWithdrawReviewError(Exception):
    code: str
    message: str
    status_code: int = 400

    def __str__(self) -> str:
        return self.message


class InMemoryProviderWithdrawReviewAdapter:
    def __init__(self, repository: InMemoryProviderWithdrawReviewRepository) -> None:
        self._repository = repository

    def review_withdrawal(
        self,
        item: ProviderWithdrawReviewItem,
        *,
        decision: str,
        reviewer: AdminIdentity,
        note: str,
    ) -> dict[str, Any]:
        updated = self._repository.mark_reviewed(item.withdrawal_id, decision=decision, note=note or None)
        status = "APPROVED_AUTO" if decision == "APPROVE" else "REJECTED"
        if updated is not None:
            status = updated.status
        message = note
        if not message:
            message = "Manual review approved in demo mode." if decision == "APPROVE" else "Manual review rejected in demo mode."
        return {
            "status": status,
            "withdrawalId": item.withdrawal_id,
            "ownerAddress": item.owner_address,
            "requestedBy": reviewer.admin_id,
            "message": message,
            "ticket": {"signature": "sig-demo-approved"} if decision == "APPROVE" else {},
        }


class HttpProviderWithdrawReviewAdapter:
    def __init__(
        self,
        *,
        base_url: str,
        admin_wallet: str,
        jwt_secret: str,
        timeout_sec: float,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._admin_wallet = admin_wallet.strip().lower()
        self._jwt_secret = jwt_secret
        self._timeout_sec = timeout_sec

    def review_withdrawal(
        self,
        item: ProviderWithdrawReviewItem,
        *,
        decision: str,
        reviewer: AdminIdentity,
        note: str,
    ) -> dict[str, Any]:
        _ = reviewer
        if not self._admin_wallet:
            raise ProviderWithdrawReviewError(
                code="GATEWAY_ADMIN_WALLET_NOT_CONFIGURED",
                message="GATEWAY_INTERNAL_ADMIN_WALLET is required for provider withdrawal reviews.",
                status_code=500,
            )
        headers = {
            "Authorization": f"Bearer {self._build_gateway_token()}",
            "X-User-Address": self._admin_wallet,
            "X-Request-Id": f"provider-withdraw-review:{item.withdrawal_id}:{decision.lower()}",
        }
        payload = {
            "ownerAddress": item.owner_address.lower(),
            "reviewDecision": decision,
            "reviewerAddress": self._admin_wallet,
            "reviewerNote": note,
        }
        try:
            response = httpx.post(
                f"{self._base_url}/api/v1/admin/providers/withdrawals/{item.withdrawal_id}/review",
                json=payload,
                headers=headers,
                timeout=self._timeout_sec,
            )
        except httpx.HTTPError as exc:
            raise ProviderWithdrawReviewError(
                code="GATEWAY_UNREACHABLE",
                message=f"Gateway review request failed: {exc}",
                status_code=502,
            ) from exc

        body = self._parse_body(response)
        if response.is_success:
            return body

        detail = body.get("detail") if isinstance(body, dict) else {}
        raise ProviderWithdrawReviewError(
            code=str(detail.get("code") or f"GATEWAY_HTTP_{response.status_code}"),
            message=str(detail.get("message") or response.text or "Gateway review request failed"),
            status_code=response.status_code,
        )

    @staticmethod
    def build_response_digest(payload: dict[str, Any]) -> str:
        return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    def _build_gateway_token(self) -> str:
        now = int(time.time())
        return jwt.encode(
            {
                "sub": self._admin_wallet,
                "role": "admin",
                "iat": now,
                "exp": now + 300,
            },
            self._jwt_secret,
            algorithm="HS256",
        )

    @staticmethod
    def _parse_body(response: httpx.Response) -> dict[str, Any]:
        try:
            payload = response.json()
        except ValueError:
            return {"raw": response.text}
        return payload if isinstance(payload, dict) else {"raw": payload}