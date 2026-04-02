from pydantic import BaseModel, Field


class AuditActionItem(BaseModel):
    audit_id: int | None = Field(alias="auditId", serialization_alias="auditId")
    action_type: str = Field(alias="actionType", serialization_alias="actionType")
    result_status: str = Field(alias="resultStatus", serialization_alias="resultStatus")
    operator_id: str | None = Field(default=None, alias="operatorId", serialization_alias="operatorId")
    operator_email: str | None = Field(default=None, alias="operatorEmail", serialization_alias="operatorEmail")
    operator_role: str | None = Field(default=None, alias="operatorRole", serialization_alias="operatorRole")
    approval_id: str | None = Field(default=None, alias="approvalId", serialization_alias="approvalId")
    job_id: str | None = Field(default=None, alias="jobId", serialization_alias="jobId")
    resource_type: str | None = Field(default=None, alias="resourceType", serialization_alias="resourceType")
    resource_id: str | None = Field(default=None, alias="resourceId", serialization_alias="resourceId")
    error_code: str | None = Field(default=None, alias="errorCode", serialization_alias="errorCode")
    created_at: str | None = Field(default=None, alias="createdAt", serialization_alias="createdAt")


class AuditActionListResponse(BaseModel):
    items: list[AuditActionItem]
    next_cursor: str | None = Field(default=None, serialization_alias="nextCursor")