from collections.abc import Iterable
from copy import deepcopy


class ApprovalService:
    def __init__(self) -> None:
        self._items = [
            {
                "approvalId": "APR-20260316-001",
                "approvalType": "refund_approve",
                "status": "UNDER_REVIEW",
                "approvalLevel": "L2",
                "requesterRole": "finance_admin",
                "amountUsdc": "150.00",
                "createdAt": "2026-03-16T08:00:00Z",
            },
            {
                "approvalId": "APR-20260316-002",
                "approvalType": "risk_rule_change",
                "status": "APPROVED_PENDING_EXECUTION",
                "approvalLevel": "L3",
                "requesterRole": "risk_admin",
                "amountUsdc": "0.00",
                "createdAt": "2026-03-16T08:30:00Z",
            },
        ]
        self._sequence = 3

    def list_items(self, status: str | None = None, approval_type: str | None = None, limit: int = 20) -> dict:
        items: Iterable[dict] = self._items
        if status:
            items = [item for item in items if item["status"] == status]
        if approval_type:
            items = [item for item in items if item["approvalType"] == approval_type]
        sliced = list(items)[:limit]
        return {"items": deepcopy(sliced), "nextCursor": None}

    def pending_count(self) -> int:
        return len([item for item in self._items if item["status"] != "EXECUTED"])

    def create_item(self, payload: dict, requester_role: str) -> dict:
        approval_id = f"APR-20260316-{self._sequence:03d}"
        self._sequence += 1
        item = {
            "approvalId": approval_id,
            "approvalType": payload["approvalType"],
            "status": "SUBMITTED",
            "approvalLevel": payload["approvalLevel"],
            "requesterRole": requester_role,
            "amountUsdc": payload["amountUsdc"],
            "createdAt": "2026-03-16T09:00:00Z",
            "resourceType": payload["resourceType"],
            "resourceId": payload["resourceId"],
            "reason": payload["reason"],
            "payload": payload["payload"],
        }
        self._items.insert(0, item)
        return deepcopy(item)

    def decide(self, approval_id: str, decision: str) -> dict:
        normalized = decision.strip().upper()
        for item in self._items:
            if item["approvalId"] != approval_id:
                continue
            item["status"] = (
                "APPROVED_PENDING_EXECUTION" if normalized == "APPROVE" else "REJECTED"
            )
            return {"approvalId": approval_id, "status": item["status"]}
        raise ValueError(f"Approval {approval_id} not found")
