from datetime import date, datetime, time, timezone

from src.core.errors import AppError, BadRequestError, ResourceNotFoundError
from src.domain import AdminActionAudit
from src.domain.enums import AuditResultStatus
from src.services.adapters.provider_withdraw_review import (
    ProviderWithdrawReviewAdapter,
    ProviderWithdrawReviewError,
)
from src.services.auth.service import AdminIdentity
from src.storage.analytics.provider_withdraw_review import ProviderWithdrawReviewRepository
from src.storage.base import AdminStore


class ProviderWithdrawReviewService:
    HISTORY_MAX_SCAN = 5000

    def __init__(
        self,
        store: AdminStore,
        repository: ProviderWithdrawReviewRepository,
        adapter: ProviderWithdrawReviewAdapter,
    ) -> None:
        self._store = store
        self._repository = repository
        self._adapter = adapter

    def list_pending_items(self, limit: int = 20) -> dict:
        items = self._repository.list_pending_reviews(limit=limit)
        return {
            "items": [
                {
                    "withdrawalId": item.withdrawal_id,
                    "ownerAddress": item.owner_address,
                    "amountUsdc": f"{item.amount_usdc:.2f}",
                    "status": item.status,
                    "requestId": item.request_id,
                    "txHash": item.tx_hash,
                    "riskLevel": item.risk_level,
                    "riskReasonCode": item.risk_reason_code,
                    "evidenceSummary": item.evidence_summary,
                    "message": item.message,
                    "createdAt": item.created_at,
                    "updatedAt": item.updated_at,
                }
                for item in items
            ],
            "nextCursor": None,
        }

    def list_history_items(
        self,
        *,
        limit: int = 50,
        query: str | None = None,
        reviewer: str | None = None,
        current_status: str | None = None,
        review_decision: str | None = None,
        reviewed_from: str | None = None,
        reviewed_to: str | None = None,
        cursor: str | None = None,
    ) -> dict:
        normalized_query = (query or "").strip().lower() or None
        normalized_reviewer = (reviewer or "").strip().lower() or None
        normalized_status = (current_status or "").strip().upper() or None
        normalized_decision = (review_decision or "").strip().upper() or None
        reviewed_from_at = self._parse_history_datetime(reviewed_from, field_name="reviewedFrom")
        reviewed_to_at = self._parse_history_datetime(reviewed_to, field_name="reviewedTo", end_of_day=True)
        self._validate_history_range(reviewed_from_at, reviewed_to_at)
        cursor_offset = self._parse_history_cursor(cursor)
        audit_rows = self._list_history_audits()
        filtered_items = self._collect_history_items(
            audit_rows,
            query=normalized_query,
            reviewer=normalized_reviewer,
            current_status=normalized_status,
            review_decision=normalized_decision,
            reviewed_from=reviewed_from_at,
            reviewed_to=reviewed_to_at,
        )

        total_count = len(filtered_items)
        page_items = filtered_items[cursor_offset:cursor_offset + limit]
        next_cursor = str(cursor_offset + limit) if cursor_offset + limit < total_count else None
        total_pages = max(1, (total_count + limit - 1) // limit) if total_count else 1
        return {
            "items": page_items,
            "nextCursor": next_cursor,
            "totalCount": total_count,
            "totalPages": total_pages,
        }

    def _collect_history_items(
        self,
        audits: list[AdminActionAudit],
        *,
        query: str | None,
        reviewer: str | None,
        current_status: str | None,
        review_decision: str | None,
        reviewed_from: datetime | None,
        reviewed_to: datetime | None,
    ) -> list[dict]:
        items: list[dict] = []
        seen_withdrawal_ids: set[str] = set()

        for audit in audits:
            history_item = self._build_history_item(audit)
            if history_item is None:
                continue

            withdrawal_id = str(history_item["withdrawalId"])
            if withdrawal_id in seen_withdrawal_ids:
                continue
            if not self._matches_history_filters(
                history_item,
                audit=audit,
                query=query,
                reviewer=reviewer,
                current_status=current_status,
                review_decision=review_decision,
                reviewed_from=reviewed_from,
                reviewed_to=reviewed_to,
            ):
                continue

            seen_withdrawal_ids.add(withdrawal_id)
            items.append(history_item)

        return items

    def decide_review(
        self,
        withdrawal_id: str,
        *,
        decision: str,
        reviewer: AdminIdentity,
        note: str,
        request_id: str | None = None,
    ) -> dict:
        normalized_decision = decision.strip().upper()
        if normalized_decision not in {"APPROVE", "REJECT"}:
            raise BadRequestError("decision must be APPROVE or REJECT")

        item = self._repository.get_review_item(withdrawal_id)
        if item is None:
            raise ResourceNotFoundError("Provider withdrawal review item not found")
        if item.status != "PENDING_MANUAL_REVIEW":
            raise BadRequestError(f"Withdrawal status={item.status} is not awaiting manual review")

        try:
            result = self._adapter.review_withdrawal(
                item,
                decision=normalized_decision,
                reviewer=reviewer,
                note=note.strip(),
            )
        except ProviderWithdrawReviewError as exc:
            self._append_audit(
                reviewer,
                request_id=request_id,
                item=item,
                decision=normalized_decision,
                note=note,
                result_status=AuditResultStatus.FAILURE,
                error_code=exc.code,
            )
            raise AppError(code=exc.code, message=exc.message, status_code=exc.status_code) from exc

        self._append_audit(
            reviewer,
            request_id=request_id,
            item=item,
            decision=normalized_decision,
            note=note,
            result_status=AuditResultStatus.SUCCESS,
            after={
                "status": result.get("status"),
                "requestedBy": result.get("requestedBy"),
            },
        )
        return {
            "withdrawalId": str(result.get("withdrawalId") or item.withdrawal_id),
            "ownerAddress": str(result.get("ownerAddress") or item.owner_address),
            "reviewDecision": normalized_decision,
            "status": str(result.get("status") or "unknown"),
            "message": result.get("message"),
            "requestedBy": result.get("requestedBy"),
            "ticket": result.get("ticket") or {},
        }

    def _append_audit(
        self,
        reviewer: AdminIdentity,
        *,
        request_id: str | None,
        item,
        decision: str,
        note: str,
        result_status: AuditResultStatus,
        error_code: str | None = None,
        after: dict | None = None,
    ) -> None:
        self._store.audit.append_action(
            AdminActionAudit(
                action_type="provider_withdraw_review.decide",
                result_status=result_status,
                operator_id=reviewer.admin_id,
                operator_email=reviewer.email,
                operator_role=reviewer.role,
                request_id=request_id,
                resource_type="provider_withdrawal",
                resource_id=item.withdrawal_id,
                error_code=error_code,
                before={
                    "status": item.status,
                    "ownerAddress": item.owner_address,
                    "amountUsdc": f"{item.amount_usdc:.2f}",
                },
                after=after or {},
                detail={
                    "decision": decision,
                    "reviewerNote": note.strip(),
                },
                created_at=datetime.now(timezone.utc),
            )
        )

    @staticmethod
    def _serialize_timestamp(value: datetime | None) -> str | None:
        return value.isoformat().replace("+00:00", "Z") if value else None

    @staticmethod
    def _resolve_amount_usdc(item, before: dict) -> str | None:
        if item is not None:
            return f"{item.amount_usdc:.2f}"
        amount = before.get("amountUsdc")
        if amount is None:
            return None
        return str(amount)

    @staticmethod
    def _parse_history_datetime(
        value: str | None,
        *,
        field_name: str,
        end_of_day: bool = False,
    ) -> datetime | None:
        normalized = (value or "").strip()
        if not normalized:
            return None

        if len(normalized) == 10:
            try:
                parsed_date = date.fromisoformat(normalized)
            except ValueError as exc:
                raise BadRequestError(f"{field_name} must be an ISO date or datetime") from exc
            boundary = time.max if end_of_day else time.min
            return datetime.combine(parsed_date, boundary, timezone.utc)

        try:
            parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        except ValueError as exc:
            raise BadRequestError(f"{field_name} must be an ISO date or datetime") from exc
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    @staticmethod
    def _parse_history_cursor(cursor: str | None) -> int:
        normalized = (cursor or "").strip()
        if not normalized:
            return 0
        try:
            offset = int(normalized)
        except ValueError as exc:
            raise BadRequestError("cursor must be an integer offset") from exc
        if offset < 0:
            raise BadRequestError("cursor must be >= 0")
        return offset

    @staticmethod
    def _validate_history_range(reviewed_from: datetime | None, reviewed_to: datetime | None) -> None:
        if reviewed_from and reviewed_to and reviewed_from > reviewed_to:
            raise BadRequestError("reviewedFrom must be <= reviewedTo")

    def _list_history_audits(self) -> list[AdminActionAudit]:
        return list(
            self._store.audit.list_actions(
                action_type="provider_withdraw_review.decide",
                result_status=AuditResultStatus.SUCCESS.value,
                limit=self.HISTORY_MAX_SCAN,
            )
        )

    def _matches_history_filters(
        self,
        item: dict,
        *,
        audit: AdminActionAudit,
        query: str | None,
        reviewer: str | None,
        current_status: str | None,
        review_decision: str | None,
        reviewed_from: datetime | None,
        reviewed_to: datetime | None,
    ) -> bool:
        reviewed_at = audit.created_at.astimezone(timezone.utc) if audit.created_at else None
        if not self._matches_history_time_range(reviewed_at, reviewed_from=reviewed_from, reviewed_to=reviewed_to):
            return False
        if not self._matches_reviewer(item, reviewer):
            return False
        if not self._matches_discrete_filter(str(item.get("currentStatus") or ""), current_status):
            return False
        if not self._matches_discrete_filter(str(item.get("reviewDecision") or ""), review_decision):
            return False
        return self._matches_history_query(item, query)

    @staticmethod
    def _matches_history_time_range(
        reviewed_at: datetime | None,
        *,
        reviewed_from: datetime | None,
        reviewed_to: datetime | None,
    ) -> bool:
        if reviewed_from and (reviewed_at is None or reviewed_at < reviewed_from):
            return False
        if reviewed_to and (reviewed_at is None or reviewed_at > reviewed_to):
            return False
        return True

    @staticmethod
    def _matches_reviewer(item: dict, reviewer: str | None) -> bool:
        if not reviewer:
            return True
        reviewer_email = str(item.get("reviewerEmail") or "").lower()
        reviewer_role = str(item.get("reviewerRole") or "").lower()
        return reviewer in reviewer_email or reviewer in reviewer_role

    @staticmethod
    def _matches_discrete_filter(value: str, expected: str | None) -> bool:
        if not expected:
            return True
        return value.strip().upper() == expected

    @staticmethod
    def _matches_history_query(item: dict, query: str | None) -> bool:
        if not query:
            return True
        haystack = " ".join(
            str(value).lower()
            for value in (
                item.get("withdrawalId"),
                item.get("ownerAddress"),
                item.get("amountUsdc"),
                item.get("requestId"),
                item.get("txHash"),
                item.get("reviewerEmail"),
                item.get("reviewerRole"),
                item.get("reviewerNote"),
                item.get("message"),
                item.get("reviewDecision"),
                item.get("currentStatus"),
            )
            if value is not None and str(value).strip()
        )
        return query in haystack

    def _build_history_item(self, audit: AdminActionAudit) -> dict | None:
        withdrawal_id = str(audit.resource_id or "").strip()
        if not withdrawal_id:
            return None

        review_item = self._repository.get_review_item(withdrawal_id)
        return {
            "withdrawalId": withdrawal_id,
            "ownerAddress": review_item.owner_address if review_item else audit.before.get("ownerAddress"),
            "amountUsdc": self._resolve_amount_usdc(review_item, audit.before),
            "requestId": review_item.request_id if review_item else None,
            "txHash": review_item.tx_hash if review_item else None,
            "riskLevel": review_item.risk_level if review_item else None,
            "riskReasonCode": review_item.risk_reason_code if review_item else None,
            "evidenceSummary": review_item.evidence_summary if review_item else None,
            "reviewDecision": str(audit.detail.get("decision") or "UNKNOWN").strip().upper(),
            "currentStatus": self._resolve_history_status(review_item, audit),
            "reviewerEmail": audit.operator_email,
            "reviewerRole": audit.operator_role,
            "reviewerNote": str(audit.detail.get("reviewerNote") or "").strip() or None,
            "message": review_item.message if review_item else None,
            "createdAt": review_item.created_at if review_item else None,
            "updatedAt": review_item.updated_at if review_item else None,
            "reviewedAt": self._serialize_timestamp(audit.created_at),
        }

    @staticmethod
    def _resolve_history_status(item, audit: AdminActionAudit) -> str:
        return str(
            (item.status if item else None)
            or audit.after.get("status")
            or audit.before.get("status")
            or "UNKNOWN"
        ).strip().upper()