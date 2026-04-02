from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ApprovalSummary(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    approval_id: str = Field(alias="approvalId", serialization_alias="approvalId")
    approval_type: str = Field(alias="approvalType", serialization_alias="approvalType")
    status: str
    approval_level: str = Field(alias="approvalLevel", serialization_alias="approvalLevel")
    requester_role: str = Field(alias="requesterRole", serialization_alias="requesterRole")
    amount_usdc: str = Field(alias="amountUsdc", serialization_alias="amountUsdc")
    created_at: str = Field(alias="createdAt", serialization_alias="createdAt")


class ApprovalListResponse(BaseModel):
    items: list[ApprovalSummary]
    next_cursor: str | None = Field(default=None, serialization_alias="nextCursor")


class CreateApprovalRequest(BaseModel):
    approval_type: str = Field(alias="approvalType")
    resource_type: str = Field(alias="resourceType")
    resource_id: str = Field(alias="resourceId")
    approval_level: str = Field(alias="approvalLevel")
    amount_usdc: str = Field(alias="amountUsdc")
    reason: str
    payload: dict[str, Any]


class ApprovalDecisionRequest(BaseModel):
    decision: str
    comment: str


class ApprovalDecisionResult(BaseModel):
    approval_id: str = Field(alias="approvalId", serialization_alias="approvalId")
    status: str
