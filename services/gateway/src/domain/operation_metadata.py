from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class ReviewActionMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    decision: Optional[str] = None
    reviewer_address: Optional[str] = Field(default=None, alias="reviewerAddress")
    reviewer_note: Optional[str] = Field(default=None, alias="reviewerNote")


class OperationContextMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    request_id: Optional[str] = Field(default=None, alias="requestId")
    trace_id: Optional[str] = Field(default=None, alias="traceId")
    client_ip: Optional[str] = Field(default=None, alias="clientIp")
    user_agent: Optional[str] = Field(default=None, alias="userAgent")
    actor_address: Optional[str] = Field(default=None, alias="actorAddress")
    note: Optional[str] = None
    review: ReviewActionMetadata = Field(default_factory=ReviewActionMetadata)


class WithdrawalTicketMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    amount: Optional[str] = None
    fee: Optional[str] = None
    nonce: Optional[int] = None
    deadline: Optional[int] = None
    signature: Optional[str] = None
    chain_id: Optional[int] = Field(default=None, alias="chainId")
    contract_address: Optional[str] = Field(default=None, alias="contractAddress")