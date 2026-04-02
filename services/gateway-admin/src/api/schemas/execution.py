from pydantic import BaseModel, Field


class ExecutionAttemptItem(BaseModel):
    attempt_no: int = Field(alias="attemptNo", serialization_alias="attemptNo")
    status: str
    error_code: str | None = Field(default=None, alias="errorCode", serialization_alias="errorCode")
    error_summary: str | None = Field(default=None, alias="errorSummary", serialization_alias="errorSummary")
    finished_at: str | None = Field(default=None, alias="finishedAt", serialization_alias="finishedAt")


class ExecutionJobItem(BaseModel):
    job_id: str = Field(alias="jobId", serialization_alias="jobId")
    approval_id: str = Field(alias="approvalId", serialization_alias="approvalId")
    execution_type: str = Field(alias="executionType", serialization_alias="executionType")
    target_system: str = Field(alias="targetSystem", serialization_alias="targetSystem")
    status: str
    idempotency_key: str = Field(alias="idempotencyKey", serialization_alias="idempotencyKey")
    error_code: str | None = Field(default=None, alias="errorCode", serialization_alias="errorCode")
    error_message: str | None = Field(default=None, alias="errorMessage", serialization_alias="errorMessage")
    retry_count: int = Field(alias="retryCount", serialization_alias="retryCount")
    max_retry_count: int = Field(alias="maxRetryCount", serialization_alias="maxRetryCount")
    queued_by: str | None = Field(default=None, alias="queuedBy", serialization_alias="queuedBy")
    updated_at: str | None = Field(default=None, alias="updatedAt", serialization_alias="updatedAt")
    attempts: list[ExecutionAttemptItem]


class ExecutionJobListResponse(BaseModel):
    items: list[ExecutionJobItem]
    next_cursor: str | None = Field(default=None, serialization_alias="nextCursor")


class ExecutionRetryResult(BaseModel):
    job_id: str = Field(alias="jobId", serialization_alias="jobId")
    status: str
    retry_count: int = Field(alias="retryCount", serialization_alias="retryCount")