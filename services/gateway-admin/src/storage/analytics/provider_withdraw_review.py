from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
import json
from typing import Any, Protocol

import psycopg
from psycopg.rows import dict_row


def _connect(dsn: str):
    return psycopg.connect(dsn, row_factory=dict_row)


def _to_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat().replace("+00:00", "Z")


@dataclass(slots=True)
class ProviderWithdrawReviewItem:
    withdrawal_id: str
    withdrawal_kind: str
    review_type: str
    owner_address: str
    subject_address: str
    amount_usdc: Decimal
    status: str
    request_id: str | None
    tx_hash: str | None
    risk_level: str | None
    risk_reason_code: str | None
    evidence_summary: str | None
    message: str | None
    created_at: str | None
    updated_at: str | None


class ProviderWithdrawReviewRepository(Protocol):
    def list_pending_reviews(self, limit: int = 20) -> list[ProviderWithdrawReviewItem]: ...
    def count_pending_reviews(self) -> int: ...
    def get_review_item(self, withdrawal_id: str) -> ProviderWithdrawReviewItem | None: ...


class InMemoryProviderWithdrawReviewRepository:
    def __init__(self, items: list[ProviderWithdrawReviewItem]) -> None:
        self._items = items

    @classmethod
    def seed_demo(cls) -> "InMemoryProviderWithdrawReviewRepository":
        return cls(
            items=[
                ProviderWithdrawReviewItem(
                    withdrawal_id="wd-demo-review-001",
                    withdrawal_kind="provider_withdrawal",
                    review_type="provider_withdraw_review",
                    owner_address="0x8f3a2c6d4b1180e6ac93d55aefe34c81a8d6d111",
                    subject_address="0x8f3a2c6d4b1180e6ac93d55aefe34c81a8d6d111",
                    amount_usdc=Decimal("128.40"),
                    status="PENDING_MANUAL_REVIEW",
                    request_id="provider-withdraw-review-001",
                    tx_hash=None,
                    risk_level="yellow",
                    risk_reason_code="AUTO_SINGLE_LIMIT_EXCEEDED",
                    evidence_summary="Single withdrawal breached auto-approve threshold; provider historical income remains healthy.",
                    message="Manual review required before issuing withdraw ticket.",
                    created_at="2026-03-16T08:05:00Z",
                    updated_at="2026-03-16T08:05:00Z",
                ),
                ProviderWithdrawReviewItem(
                    withdrawal_id="wd-demo-review-002",
                    withdrawal_kind="provider_withdrawal",
                    review_type="provider_withdraw_review",
                    owner_address="0x7d1a3d59ac5d5310b0ed4b14a22d6327c7911e22",
                    subject_address="0x7d1a3d59ac5d5310b0ed4b14a22d6327c7911e22",
                    amount_usdc=Decimal("320.00"),
                    status="PENDING_MANUAL_REVIEW",
                    request_id="provider-withdraw-review-002",
                    tx_hash=None,
                    risk_level="red",
                    risk_reason_code="AUTO_24H_LIMIT_EXCEEDED",
                    evidence_summary="24h withdrawal aggregate is above the configured auto path. Requires reviewer confirmation.",
                    message="Manual review required before issuing withdraw ticket.",
                    created_at="2026-03-16T08:12:00Z",
                    updated_at="2026-03-16T08:12:00Z",
                ),
            ]
        )

    def list_pending_reviews(self, limit: int = 20) -> list[ProviderWithdrawReviewItem]:
        items = [item for item in self._items if item.status == "PENDING_MANUAL_REVIEW"]
        items.sort(
            key=lambda item: ((item.created_at or ""), (item.withdrawal_id or "")),
            reverse=True,
        )
        return items[:limit]

    def count_pending_reviews(self) -> int:
        return len([item for item in self._items if item.status == "PENDING_MANUAL_REVIEW"])

    def get_review_item(self, withdrawal_id: str) -> ProviderWithdrawReviewItem | None:
        target = withdrawal_id.strip()
        for item in self._items:
            if item.withdrawal_id == target:
                return item
        return None

    def mark_reviewed(self, withdrawal_id: str, *, decision: str, note: str | None = None) -> ProviderWithdrawReviewItem | None:
        updated_status = "APPROVED_AUTO" if decision == "APPROVE" else "REJECTED"
        for index, item in enumerate(self._items):
            if item.withdrawal_id != withdrawal_id:
                continue
            updated = ProviderWithdrawReviewItem(
                withdrawal_id=item.withdrawal_id,
                withdrawal_kind=item.withdrawal_kind,
                review_type=item.review_type,
                owner_address=item.owner_address,
                subject_address=item.subject_address,
                amount_usdc=item.amount_usdc,
                status=updated_status,
                request_id=item.request_id,
                tx_hash=item.tx_hash,
                risk_level=item.risk_level,
                risk_reason_code=item.risk_reason_code,
                evidence_summary=item.evidence_summary,
                message=note or item.message,
                created_at=item.created_at,
                updated_at=_to_iso(datetime.now(timezone.utc)),
            )
            self._items[index] = updated
            return updated
        return None


class PostgresProviderWithdrawReviewRepository:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    def list_pending_reviews(self, limit: int = 20) -> list[ProviderWithdrawReviewItem]:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    vw.withdrawal_id,
                    vw.withdrawal_kind,
                    owner.owner_wallet,
                    vw.amount_usdc,
                    COALESCE(rs.payload->>'flowStatus', vw.status) AS flow_status,
                    COALESCE(vw.request_id, rs.payload->>'requestId') AS request_id,
                    vw.tx_hash,
                    rs.payload,
                    vw.created_at,
                    vw.updated_at
                FROM synapse_vault_withdrawals vw
                JOIN synapse_ledger_accounts account
                  ON account.account_id = vw.source_account_id
                JOIN synapse_owner_accounts owner
                  ON owner.owner_id = account.owner_id
                LEFT JOIN synapse_runtime_state rs
                  ON rs.state_key = CONCAT('vault_withdrawal_meta::', vw.withdrawal_id)
                WHERE vw.withdrawal_kind IN ('provider_withdrawal', 'consumer_refund')
                  AND COALESCE(rs.payload->>'flowStatus', vw.status) = 'PENDING_MANUAL_REVIEW'
                ORDER BY vw.created_at DESC, vw.withdrawal_id DESC
                LIMIT %s
                """,
                (limit,),
            )
            rows = cur.fetchall()
        return [self._to_item(row) for row in rows]

    def count_pending_reviews(self) -> int:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) AS total
                FROM synapse_vault_withdrawals vw
                LEFT JOIN synapse_runtime_state rs
                  ON rs.state_key = CONCAT('vault_withdrawal_meta::', vw.withdrawal_id)
                WHERE vw.withdrawal_kind IN ('provider_withdrawal', 'consumer_refund')
                  AND COALESCE(rs.payload->>'flowStatus', vw.status) = 'PENDING_MANUAL_REVIEW'
                """
            )
            row = cur.fetchone()
        return int(row["total"])

    def get_review_item(self, withdrawal_id: str) -> ProviderWithdrawReviewItem | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    vw.withdrawal_id,
                    vw.withdrawal_kind,
                    owner.owner_wallet,
                    vw.amount_usdc,
                    COALESCE(rs.payload->>'flowStatus', vw.status) AS flow_status,
                    COALESCE(vw.request_id, rs.payload->>'requestId') AS request_id,
                    vw.tx_hash,
                    rs.payload,
                    vw.created_at,
                    vw.updated_at
                FROM synapse_vault_withdrawals vw
                JOIN synapse_ledger_accounts account
                  ON account.account_id = vw.source_account_id
                JOIN synapse_owner_accounts owner
                  ON owner.owner_id = account.owner_id
                LEFT JOIN synapse_runtime_state rs
                  ON rs.state_key = CONCAT('vault_withdrawal_meta::', vw.withdrawal_id)
                WHERE vw.withdrawal_kind IN ('provider_withdrawal', 'consumer_refund')
                  AND vw.withdrawal_id = %s
                LIMIT 1
                """,
                (withdrawal_id.strip(),),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return self._to_item(row)

    @staticmethod
    def _payload_dict(payload: Any) -> dict[str, Any]:
        if isinstance(payload, dict):
            return payload
        if isinstance(payload, memoryview):
            payload = payload.tobytes().decode("utf-8")
        if isinstance(payload, bytes):
            payload = payload.decode("utf-8")
        if isinstance(payload, str) and payload.strip():
            try:
                parsed = json.loads(payload)
            except json.JSONDecodeError:
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return {}

    def _to_item(self, row: dict[str, Any]) -> ProviderWithdrawReviewItem:
        payload = self._payload_dict(row.get("payload"))
        withdrawal_kind = str(row.get("withdrawal_kind") or "provider_withdrawal")
        review_type = "consumer_withdraw_review" if withdrawal_kind == "consumer_refund" else "provider_withdraw_review"
        owner_wallet = str(row.get("owner_wallet") or "")
        return ProviderWithdrawReviewItem(
            withdrawal_id=str(row.get("withdrawal_id") or ""),
            withdrawal_kind=withdrawal_kind,
            review_type=review_type,
            owner_address=owner_wallet,
            subject_address=owner_wallet,
            amount_usdc=Decimal(str(row.get("amount_usdc") or "0")),
            status=str(row.get("flow_status") or row.get("status") or "REQUESTED"),
            request_id=str(row.get("request_id")) if row.get("request_id") else None,
            tx_hash=str(row.get("tx_hash")) if row.get("tx_hash") else None,
            risk_level=str(payload.get("riskLevel")) if payload.get("riskLevel") else None,
            risk_reason_code=str(payload.get("riskReasonCode")) if payload.get("riskReasonCode") else None,
            evidence_summary=str(payload.get("evidenceSummary")) if payload.get("evidenceSummary") else None,
            message=str(payload.get("message")) if payload.get("message") else None,
            created_at=_to_iso(row.get("created_at")),
            updated_at=_to_iso(row.get("updated_at")),
        )
