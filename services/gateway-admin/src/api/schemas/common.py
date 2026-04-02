from typing import Any

from pydantic import BaseModel, Field


class ErrorBody(BaseModel):
    code: str
    message: str


class ApiResponse(BaseModel):
    success: bool = True
    data: Any = None
    request_id: str = Field(serialization_alias="requestId")


class ApiErrorResponse(BaseModel):
    success: bool = False
    error: ErrorBody
    request_id: str = Field(serialization_alias="requestId")
