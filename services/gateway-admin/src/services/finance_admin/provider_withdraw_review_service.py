from dataclasses import dataclass
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

ERR_INVALID_DECISION = "decision must be APPROVE or REJECT"
ERR_REVIEW_NOT_FOUND = "withdrawal review item not found"
ERR_HISTORY_DATE = "history filter must be an ISO date or datetime"
ERR_CURSOR_INTEGER = "cursor must be an integer offset"
ERR_CURSOR_NON_NEGATIVE = "cursor must be >= 0"
ERR_HISTORY_RANGE = "reviewedFrom must be <= reviewedTo"
ISO_DATE_LENGTH = 10


@dataclass(frozen=True)
class WithdrawReviewHistoryQuery:
    limit: int = 50
    query: str | None = None
    reviewer: str | None = None
    current_status: str | None = None
    review_decision: str | None = None
    reviewed_from: str | None = None
    reviewed_to: str | None = None
    cursor: str | None = None


@dataclass(frozen=True)
class _HistoryFilters:
    query: str | None
    reviewer: str | None
    current_status: str | None
    review_decision: str | None
    reviewed_from: datetime | None
    reviewed_to: datetime | None


@dataclass(frozen=True)
class _AuditContext:
    request_id: str | None
    item: object
    decision: str
    note: str
    result_status: AuditResultStatus
    error_code: str | None = None
    after: dict | None = None


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
                    "withdrawalKind": item.withdrawal_kind,
                    "reviewType": item.review_type,
                    "ownerAddress": item.owner_address,
                    "subjectAddress": item.subject_address,
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

    def list_history_items(self, filters: WithdrawReviewHistoryQuery) -> dict:
        history_filters = _HistoryFilters(
            query=(filters.query or "").strip().lower() or None,
            reviewer=(filters.reviewer or "").strip().lower() or None,
            current_status=(filters.current_status or "").strip().upper() or None,
            review_decision=(filters.review_decision or "").strip().upper() or None,
            reviewed_from=self._parse_history_datetime(filters.reviewed_from, field_name="reviewedFrom"),
            reviewed_to=self._parse_history_datetime(
                filters.reviewed_to,
                field_name="reviewedTo",
                end_of_day=True,
            ),
        )
        self._validate_history_range(history_filters.reviewed_from, history_filters.reviewed_to)
        cursor_offset = self._parse_history_cursor(filters.cursor)
        audit_rows = self._list_history_audits()
        filtered_items = self._collect_history_items(
            audit_rows,
            filters=history_filters,
        )

        total_count = len(filtered_items)
        page_items = filtered_items[cursor_offset:cursor_offset + filters.limit]
        next_cursor = str(cursor_offset + filters.limit) if cursor_offset + filters.limit < total_count else None
        total_pages = max(1, (total_count + filters.limit - 1) // filters.limit) if total_count else 1
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
        filters: _HistoryFilters,
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
                filters=filters,
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
            raise BadRequestError(ERR_INVALID_DECISION)

        item = self._repository.get_review_item(withdrawal_id)
        if item is None:
            raise ResourceNotFoundError(ERR_REVIEW_NOT_FOUND)
        if item.status != "PENDING_MANUAL_REVIEW":
            message = f"Withdrawal status={item.status} is not awaiting manual review"
            raise BadRequestError(message)

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
                _AuditContext(
                    request_id=request_id,
                    item=item,
                    decision=normalized_decision,
                    note=note,
                    result_status=AuditResultStatus.FAILURE,
                    error_code=exc.code,
                ),
            )
            raise AppError(code=exc.code, message=exc.message, status_code=exc.status_code) from exc

        self._append_audit(
            reviewer,
            _AuditContext(
                request_id=request_id,
                item=item,
                decision=normalized_decision,
                note=note,
                result_status=AuditResultStatus.SUCCESS,
                after={
                    "status": result.get("status"),
                    "requestedBy": result.get("requestedBy"),
                    "withdrawalKind": item.withdrawal_kind,
                },
            ),
        )
        return {
            "withdrawalId": str(result.get("withdrawalId") or item.withdrawal_id),
            "withdrawalKind": item.withdrawal_kind,
            "reviewType": item.review_type,
            "ownerAddress": str(result.get("ownerAddress") or item.owner_address),
            "subjectAddress": item.subject_address,
            "reviewDecision": normalized_decision,
            "status": str(result.get("status") or "unknown"),
            "message": result.get("message"),
            "requestedBy": result.get("requestedBy"),
            "ticket": result.get("ticket") or {},
        }

    def _append_audit(
        self,
        reviewer: AdminIdentity,
        context: _AuditContext,
    ) -> None:
        item = context.item
        self._store.audit.append_action(
            AdminActionAudit(
                action_type="withdrawal_review.decide",
                result_status=context.result_status,
                operator_id=reviewer.admin_id,
                operator_email=reviewer.email,
                operator_role=reviewer.role,
                request_id=context.request_id,
                resource_type=item.withdrawal_kind,
                resource_id=item.withdrawal_id,
                error_code=context.error_code,
                before={
                    "status": item.status,
                    "withdrawalKind": item.withdrawal_kind,
                    "reviewType": item.review_type,
                    "ownerAddress": item.owner_address,
                    "subjectAddress": item.subject_address,
                    "amountUsdc": f"{item.amount_usdc:.2f}",
                },
                after=context.after or {},
                detail={
                    "decision": context.decision,
                    "withdrawalKind": item.withdrawal_kind,
                    "reviewerNote": context.note.strip(),
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

        if len(normalized) == ISO_DATE_LENGTH:
            try:
                parsed_date = date.fromisoformat(normalized)
            except ValueError as exc:
                message = f"{field_name}: {ERR_HISTORY_DATE}"
                raise BadRequestError(message) from exc
            boundary = time.max if end_of_day else time.min
            return datetime.combine(parsed_date, boundary, timezone.utc)

        try:
            parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        except ValueError as exc:
            message = f"{field_name}: {ERR_HISTORY_DATE}"
            raise BadRequestError(message) from exc
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
            raise BadRequestError(ERR_CURSOR_INTEGER) from exc
        if offset < 0:
            raise BadRequestError(ERR_CURSOR_NON_NEGATIVE)
        return offset

    @staticmethod
    def _validate_history_range(reviewed_from: datetime | None, reviewed_to: datetime | None) -> None:
        if reviewed_from and reviewed_to and reviewed_from > reviewed_to:
            raise BadRequestError(ERR_HISTORY_RANGE)

    def _list_history_audits(self) -> list[AdminActionAudit]:
        audits: list[AdminActionAudit] = []
        for action_type in ("withdrawal_review.decide", "provider_withdraw_review.decide"):
            audits.extend(
                self._store.audit.list_actions(
                    action_type=action_type,
                    result_status=AuditResultStatus.SUCCESS.value,
                    limit=self.HISTORY_MAX_SCAN,
                )
            )
        audits.sort(key=lambda audit: audit.created_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return audits[:self.HISTORY_MAX_SCAN]

    def _matches_history_filters(
        self,
        item: dict,
        *,
        audit: AdminActionAudit,
        filters: _HistoryFilters,
    ) -> bool:
        reviewed_at = audit.created_at.astimezone(timezone.utc) if audit.created_at else None
        if not self._matches_history_time_range(
            reviewed_at,
            reviewed_from=filters.reviewed_from,
            reviewed_to=filters.reviewed_to,
        ):
            return False
        if not self._matches_reviewer(item, filters.reviewer):
            return False
        if not self._matches_discrete_filter(str(item.get("currentStatus") or ""), filters.current_status):
            return False
        if not self._matches_discrete_filter(str(item.get("reviewDecision") or ""), filters.review_decision):
            return False
        return self._matches_history_query(item, filters.query)

    @staticmethod
    def _matches_history_time_range(
        reviewed_at: datetime | None,
        *,
        reviewed_from: datetime | None,
        reviewed_to: datetime | None,
    ) -> bool:
        if reviewed_from and (reviewed_at is None or reviewed_at < reviewed_from):
            return False
        return not (reviewed_to and (reviewed_at is None or reviewed_at > reviewed_to))

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
            "withdrawalKind": (
                review_item.withdrawal_kind
                if review_item
                else str(audit.detail.get("withdrawalKind") or audit.before.get("withdrawalKind") or "provider_withdrawal")
            ),
            "reviewType": (
                review_item.review_type
                if review_item
                else str(audit.before.get("reviewType") or "provider_withdraw_review")
            ),
            "ownerAddress": review_item.owner_address if review_item else audit.before.get("ownerAddress"),
            "subjectAddress": review_item.subject_address if review_item else audit.before.get("subjectAddress"),
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
