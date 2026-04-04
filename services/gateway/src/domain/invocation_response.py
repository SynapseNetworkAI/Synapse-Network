"""Typed response shapes for invocation and consumer API outcomes.

Use these models instead of bare dict[str, Any] on all service functions that
return invocation state or consumer-facing payloads.
"""
from __future__ import annotations

from typing import Any, Optional, Union

from pydantic import BaseModel


class InvocationReceiptRef(BaseModel):
    quoteId: str
    invocationId: str


class InvocationSuccessResponse(BaseModel):
    invocationId: str
    status: str
    chargedUsdc: float
    result: Any
    receipt: InvocationReceiptRef


class InvocationErrorInfo(BaseModel):
    code: str
    message: str
    retryable: bool
    action: Optional[str] = None


class InvocationErrorResponse(BaseModel):
    invocationId: str
    status: str
    error: InvocationErrorInfo


class InvocationPendingResponse(BaseModel):
    invocationId: str
    status: str
    chargedUsdc: float


# Union of all possible invocation state shapes
InvocationStateResponse = Union[
    InvocationSuccessResponse, InvocationErrorResponse, InvocationPendingResponse
]


class ConsumerReceipt(BaseModel):
    requestId: str
    quoteId: str
    invocationId: str
    serviceId: str
    totalCharge: float
    consumerAvailableBalanceAfter: float
    serviceUnitPrice: float


class ConsumerResponseData(BaseModel):
    result: Any


class ConsumerResponsePayload(BaseModel):
    status: str
    code: str
    receipt: ConsumerReceipt
    data: ConsumerResponseData


class ConsumerSuccessResponse(BaseModel):
    statusCode: int
    ok: bool
    payload: ConsumerResponsePayload
