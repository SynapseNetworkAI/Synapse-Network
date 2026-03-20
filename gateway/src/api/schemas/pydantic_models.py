from pydantic import BaseModel, Field, field_validator
from typing import Any, Dict, Literal, Optional

from src.domain.service_contract import (
    QuoteInputPreviewRecord,
    RuntimePayloadRecord,
)

TX_HASH_PREFIX_ERROR = "txHash must start with 0x"
TX_HASH_FORMAT_ERROR = "txHash must be a valid 32-byte hex string"


class BaseResponse(BaseModel):
    success: bool = True
    error: Optional[str] = None


class ChallengeRequest(BaseModel):
    wallet_address: str = Field(..., description="Wallet address of the owner")


class ChallengeResponse(BaseResponse):
    challenge: str
    domain: str


class VerifyAuthRequest(BaseModel):
    wallet_address: str
    signature: str
    message: str


class TokenResponse(BaseResponse):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class CredentialIssueRequest(BaseModel):
    name: Optional[str] = None
    expiresInSec: Optional[int] = None
    maxCalls: Optional[int] = None
    rpm: Optional[int] = None
    creditLimit: Optional[float] = None
    resetInterval: Optional[str] = None
    expiration: Optional[int] = None


class CredentialQuotaUpdateRequest(BaseModel):
    maxCalls: Optional[int] = None
    rpm: Optional[int] = None
    expiresAt: Optional[int] = None
    creditLimit: Optional[float] = None
    resetInterval: Optional[str] = None
    expiration: Optional[int] = None


class InferenceRequest(BaseModel):
    prompt: str
    serviceId: Optional[str] = None


class AgentDiscoverySearchRequest(BaseModel):
    query: Optional[str] = Field(default=None, max_length=256)
    tags: list[str] = Field(default_factory=list)
    page: int = Field(default=1, ge=1)
    pageSize: int = Field(default=10, ge=1, le=50)
    sort: Literal["best_match", "lowest_price", "fastest", "highest_reliability"] = "best_match"

    @field_validator("query")
    @classmethod
    def normalize_query(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None


class AgentQuoteRequest(BaseModel):
    serviceId: str = Field(..., min_length=1, max_length=128)
    inputPreview: QuoteInputPreviewRecord = Field(default_factory=QuoteInputPreviewRecord)
    responseMode: Literal["sync", "async", "stream"] = "sync"


class AgentInvocationRequest(BaseModel):
    quoteId: str = Field(..., min_length=1, max_length=128)
    idempotencyKey: str = Field(..., min_length=1, max_length=128)
    payload: RuntimePayloadRecord = Field(default_factory=RuntimePayloadRecord)
    responseMode: Literal["sync", "async", "stream"] = "sync"


class DepositIntentRequest(BaseModel):
    txHash: str = Field(..., min_length=66, max_length=66)
    amountUsdc: float = Field(..., gt=0)

    @field_validator("txHash")
    @classmethod
    def validate_tx_hash(cls, value: str) -> str:
        normalized = str(value).strip()
        if not normalized.startswith("0x"):
            raise ValueError(TX_HASH_PREFIX_ERROR)
        hex_part = normalized[2:]
        if len(hex_part) != 64 or any(
            ch not in "0123456789abcdefABCDEF" for ch in hex_part
        ):
            raise ValueError(TX_HASH_FORMAT_ERROR)
        return normalized


class DepositAttemptRequest(BaseModel):
    attemptId: str = Field(..., min_length=1, max_length=128)
    amountUsdc: float = Field(..., gt=0)
    stage: Literal[
        "SIGN_REQUESTED",
        "TX_BROADCASTED",
        "RECEIPT_FAILED",
        "RECEIPT_CONFIRMED",
        "INTENT_REGISTERED",
    ]
    clientRequestId: Optional[str] = Field(default=None, min_length=1, max_length=128)
    txHash: Optional[str] = Field(default=None, min_length=66, max_length=66)
    failureReason: Optional[str] = Field(default=None, max_length=512)

    @field_validator("txHash")
    @classmethod
    def validate_optional_tx_hash(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = str(value).strip()
        if not normalized.startswith("0x"):
            raise ValueError(TX_HASH_PREFIX_ERROR)
        hex_part = normalized[2:]
        if len(hex_part) != 64 or any(
            ch not in "0123456789abcdefABCDEF" for ch in hex_part
        ):
            raise ValueError(TX_HASH_FORMAT_ERROR)
        return normalized.lower()


class DepositConfirmRequest(BaseModel):
    eventKey: str = Field(..., min_length=1, max_length=128)
    confirmations: int = Field(default=1, ge=1, le=1000000)


class AdminDepositReplayRequest(BaseModel):
    txHash: str = Field(..., min_length=66, max_length=66)

    @field_validator("txHash")
    @classmethod
    def validate_tx_hash(cls, value: str) -> str:
        normalized = str(value).strip()
        if not normalized.startswith("0x"):
            raise ValueError(TX_HASH_PREFIX_ERROR)
        hex_part = normalized[2:]
        if len(hex_part) != 64 or any(
            ch not in "0123456789abcdefABCDEF" for ch in hex_part
        ):
            raise ValueError(TX_HASH_FORMAT_ERROR)
        return normalized.lower()


class RefundIntentRequest(BaseModel):
    amountUsdc: float = Field(default=10, ge=10)
    reason: Optional[str] = Field(default=None, max_length=256)
    originRequestId: Optional[str] = Field(default=None, max_length=128)
    originTxHash: Optional[str] = Field(default=None, min_length=66, max_length=66)
    refundType: Optional[str] = Field(default="SYSTEM_FAILURE", max_length=32)
    destinationAddress: Optional[str] = Field(default=None, max_length=64)
    evidenceSummary: Optional[str] = Field(default=None, max_length=512)


class RefundCompleteRequest(BaseModel):
    txHash: str = Field(..., min_length=66, max_length=66)
    reviewerAddress: Optional[str] = Field(default=None, max_length=64)
    reviewDecision: Optional[str] = Field(default=None, max_length=16)
    reviewerNote: Optional[str] = Field(default=None, max_length=512)

    @field_validator("txHash")
    @classmethod
    def validate_tx_hash(cls, value: str) -> str:
        normalized = str(value).strip()
        if not normalized.startswith("0x"):
            raise ValueError(TX_HASH_PREFIX_ERROR)
        hex_part = normalized[2:]
        if len(hex_part) != 64 or any(
            ch not in "0123456789abcdefABCDEF" for ch in hex_part
        ):
            raise ValueError(TX_HASH_FORMAT_ERROR)
        return normalized.lower()


class AdminRefundCompleteRequest(RefundCompleteRequest):
    ownerAddress: str = Field(..., min_length=1, max_length=64)


class ProviderWithdrawIntentRequest(BaseModel):
    amountUsdc: Optional[float] = Field(default=None, gt=0)


class ProviderWithdrawCompleteRequest(BaseModel):
    txHash: str = Field(..., min_length=66, max_length=66)

    @field_validator("txHash")
    @classmethod
    def validate_tx_hash(cls, value: str) -> str:
        normalized = str(value).strip()
        if not normalized.startswith("0x"):
            raise ValueError(TX_HASH_PREFIX_ERROR)
        hex_part = normalized[2:]
        if len(hex_part) != 64 or any(
            ch not in "0123456789abcdefABCDEF" for ch in hex_part
        ):
            raise ValueError(TX_HASH_FORMAT_ERROR)
        return normalized.lower()


class AdminProviderWithdrawCompleteRequest(ProviderWithdrawCompleteRequest):
    ownerAddress: str = Field(..., min_length=1, max_length=64)


class RouterConfigRequest(BaseModel):
    dailyLimitUsdc: float = Field(..., ge=0, le=10_000)


# Backward-compatible aliases.
AgentCredentialIssueRequest = CredentialIssueRequest
AgentCredentialQuotaUpdateRequest = CredentialQuotaUpdateRequest
