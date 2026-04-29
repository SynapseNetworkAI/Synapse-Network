import re
from decimal import Decimal
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from src.domain.service_contract import (
    RuntimePayloadRecord,
)

TX_HASH_PREFIX_ERROR = "txHash must start with 0x"
TX_HASH_FORMAT_ERROR = "txHash must be a valid 32-byte hex string"
TX_HASH_HEX_LENGTH = 64
EMAIL_FORMAT_ERROR = "email must be a valid address"
EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
EMAIL_VERIFICATION_CODE_DIGITS = 6
EMAIL_VERIFICATION_CODE_FORMAT_ERROR = "EMAIL_VERIFICATION_CODE_INVALID"
AMOUNT_USDC_DECIMAL_PLACES_ERROR = "amountUsdc supports up to 2 decimal places"
SPENDING_LIMIT_POSITIVE_ERROR = "spendingLimitUsdc must be positive"
SPENDING_LIMIT_DECIMAL_PLACES_ERROR = "spendingLimitUsdc supports up to 6 decimal places"
VOUCHER_CODE_LENGTH = 12
VOUCHER_CODE_LENGTH_ERROR = "voucherCode must contain exactly 12 alphanumeric characters"
VOUCHER_CODE_ALPHANUMERIC_ERROR = "voucherCode must be alphanumeric"


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
    token_type: str = "bearer"  # noqa: S105 - OAuth token type literal, not a credential.
    expires_in: int


class OwnerProfilePayload(BaseModel):
    displayName: Optional[str] = Field(default=None, max_length=64)
    email: Optional[str] = Field(default=None, max_length=320)
    notifyMarketing: bool = True
    notifyAlerts: bool = True

    @field_validator("displayName")
    @classmethod
    def normalize_display_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = str(value).strip().lower()
        if not normalized:
            return None
        if not EMAIL_REGEX.match(normalized):
            raise ValueError(EMAIL_FORMAT_ERROR)
        return normalized


class OwnerProfileChallengeRequest(OwnerProfilePayload):
    pass


class OwnerProfileUpdateRequest(OwnerProfilePayload):
    message: str = Field(..., min_length=1, max_length=1024)
    signature: str = Field(..., min_length=1, max_length=2048)


class EmailVerificationCodeRequest(BaseModel):
    email: str = Field(..., max_length=320)
    code: str = Field(
        ...,
        min_length=EMAIL_VERIFICATION_CODE_DIGITS,
        max_length=EMAIL_VERIFICATION_CODE_DIGITS,
    )

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if not normalized or not EMAIL_REGEX.match(normalized):
            raise ValueError(EMAIL_FORMAT_ERROR)
        return normalized

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        normalized = str(value or "").strip()
        if len(normalized) != EMAIL_VERIFICATION_CODE_DIGITS or not normalized.isdigit():
            raise ValueError(EMAIL_VERIFICATION_CODE_FORMAT_ERROR)
        return normalized


class EmailVerificationResendRequest(BaseModel):
    email: str = Field(..., max_length=320)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if not normalized or not EMAIL_REGEX.match(normalized):
            raise ValueError(EMAIL_FORMAT_ERROR)
        return normalized


class OwnerProfileView(BaseModel):
    ownerAddress: str
    displayName: Optional[str] = None
    email: Optional[str] = None
    emailVerified: bool = False
    pendingEmail: Optional[str] = None
    emailVerificationStatus: Literal["none", "pending", "expired", "locked"] = "none"
    emailVerificationExpiresAt: Optional[str] = None
    emailVerificationSendsRemaining: int = 5
    notifyMarketing: bool = True
    notifyAlerts: bool = True
    createdAt: str
    updatedAt: str


class OwnerProfileResponse(BaseResponse):
    profile: OwnerProfileView


class OwnerProfileChallengeResponse(BaseResponse):
    challenge: str
    expiresInSec: int


class CredentialIssueRequest(BaseModel):
    name: Optional[str] = None
    expiresInSec: Optional[int] = None
    maxCalls: Optional[int] = None
    rpm: Optional[int] = None
    creditLimit: Optional[Decimal] = None
    resetInterval: Optional[str] = None
    expiration: Optional[int] = None


class CredentialQuotaUpdateRequest(BaseModel):
    maxCalls: Optional[int] = None
    rpm: Optional[int] = None
    expiresAt: Optional[int] = None
    creditLimit: Optional[Decimal] = None
    resetInterval: Optional[str] = None
    expiration: Optional[int] = None


class CredentialUpdateRequest(BaseModel):
    """Full credential update — name + all quota fields."""

    name: Optional[str] = None
    maxCalls: Optional[int] = None
    rpm: Optional[int] = None
    expiresAt: Optional[int] = None
    creditLimit: Optional[Decimal] = None
    resetInterval: Optional[str] = None
    expiration: Optional[int] = None


class InferenceRequest(BaseModel):
    prompt: Optional[str] = None
    serviceId: Optional[str] = None
    payload: dict[str, Any] = Field(default_factory=dict)


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


class AgentInvokeRequest(BaseModel):
    """Single-call invoke: serviceId + costUsdc (price the agent observed in discovery).

    Gateway checks that the live service price equals costUsdc (±1e-6 tolerance).
    If the price has changed since discovery, it returns 422 PRICE_MISMATCH so the
    agent can re-discover before being charged.
    """

    serviceId: str = Field(..., min_length=1, max_length=128)
    idempotencyKey: str = Field(..., min_length=1, max_length=128)
    costUsdc: Optional[Decimal] = Field(
        default=None,
        ge=Decimal("0"),
        description="Fixed-price service price the agent saw during discovery. LLM token-metered calls may omit this and rely on maxCostUsdc/auto hold.",
    )
    maxCostUsdc: Optional[Decimal] = Field(
        default=None,
        ge=Decimal("0"),
        description="Optional LLM token-metered pre-authorization cap. If omitted, Gateway estimates a bounded hold.",
    )
    payload: RuntimePayloadRecord = Field(default_factory=RuntimePayloadRecord)
    responseMode: Literal["sync", "async", "stream"] = "sync"


class DepositIntentRequest(BaseModel):
    txHash: str = Field(..., min_length=66, max_length=66)
    amountUsdc: Decimal = Field(..., gt=Decimal("0"))

    @field_validator("txHash")
    @classmethod
    def validate_tx_hash(cls, value: str) -> str:
        normalized = str(value).strip()
        if not normalized.startswith("0x"):
            raise ValueError(TX_HASH_PREFIX_ERROR)
        hex_part = normalized[2:]
        if len(hex_part) != TX_HASH_HEX_LENGTH or any(
            ch not in "0123456789abcdefABCDEF" for ch in hex_part
        ):
            raise ValueError(TX_HASH_FORMAT_ERROR)
        return normalized


class DepositAttemptRequest(BaseModel):
    attemptId: str = Field(..., min_length=1, max_length=128)
    amountUsdc: Decimal = Field(..., gt=Decimal("0"))
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
        if len(hex_part) != TX_HASH_HEX_LENGTH or any(
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
        if len(hex_part) != TX_HASH_HEX_LENGTH or any(
            ch not in "0123456789abcdefABCDEF" for ch in hex_part
        ):
            raise ValueError(TX_HASH_FORMAT_ERROR)
        return normalized.lower()


class RefundIntentRequest(BaseModel):
    amountUsdc: Decimal = Field(default=Decimal("10"), ge=Decimal("10"))
    reason: Optional[str] = Field(default=None, max_length=256)
    originRequestId: Optional[str] = Field(default=None, max_length=128)
    originTxHash: Optional[str] = Field(default=None, min_length=66, max_length=66)
    refundType: Optional[str] = Field(default="SYSTEM_FAILURE", max_length=32)
    destinationAddress: Optional[str] = Field(default=None, max_length=64)
    evidenceSummary: Optional[str] = Field(default=None, max_length=512)


class ConsumerWithdrawRequest(BaseModel):
    """Withdraw unused consumer balance (unspent deposits) back to wallet."""
    amountUsdc: Decimal = Field(..., gt=Decimal("0"), description="Amount in USDC to withdraw, > 0")
    reason: Optional[str] = Field(default=None, max_length=256)


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
        if len(hex_part) != TX_HASH_HEX_LENGTH or any(
            ch not in "0123456789abcdefABCDEF" for ch in hex_part
        ):
            raise ValueError(TX_HASH_FORMAT_ERROR)
        return normalized.lower()


class AdminRefundCompleteRequest(RefundCompleteRequest):
    ownerAddress: str = Field(..., min_length=1, max_length=64)


class RefundFailRequest(BaseModel):
    reasonCode: str = Field(..., min_length=3, max_length=64)
    message: Optional[str] = Field(default=None, max_length=512)
    txHash: Optional[str] = Field(default=None, min_length=66, max_length=66)

    @field_validator("txHash")
    @classmethod
    def validate_optional_tx_hash(cls, value: Optional[str]) -> Optional[str]:
        if value in {None, ""}:
            return None
        normalized = str(value).strip()
        if not normalized.startswith("0x"):
            raise ValueError(TX_HASH_PREFIX_ERROR)
        hex_part = normalized[2:]
        if len(hex_part) != TX_HASH_HEX_LENGTH or any(
            ch not in "0123456789abcdefABCDEF" for ch in hex_part
        ):
            raise ValueError(TX_HASH_FORMAT_ERROR)
        return normalized.lower()


class AdminRefundReviewRequest(BaseModel):
    ownerAddress: str = Field(..., min_length=1, max_length=64)
    reviewDecision: str = Field(..., min_length=6, max_length=16)
    reviewerAddress: Optional[str] = Field(default=None, max_length=64)
    reviewerNote: Optional[str] = Field(default=None, max_length=512)


class ProviderWithdrawIntentRequest(BaseModel):
    amountUsdc: Optional[Decimal] = Field(default=None, gt=0)

    @field_validator("amountUsdc")
    @classmethod
    def validate_amount_usdc(cls, value: Optional[Decimal]) -> Optional[Decimal]:
        if value is None:
            return None
        if value != value.quantize(Decimal("0.01")):
            raise ValueError(AMOUNT_USDC_DECIMAL_PLACES_ERROR)
        return value


class ProviderWithdrawCompleteRequest(BaseModel):
    txHash: str = Field(..., min_length=66, max_length=66)

    @field_validator("txHash")
    @classmethod
    def validate_tx_hash(cls, value: str) -> str:
        normalized = str(value).strip()
        if not normalized.startswith("0x"):
            raise ValueError(TX_HASH_PREFIX_ERROR)
        hex_part = normalized[2:]
        if len(hex_part) != TX_HASH_HEX_LENGTH or any(
            ch not in "0123456789abcdefABCDEF" for ch in hex_part
        ):
            raise ValueError(TX_HASH_FORMAT_ERROR)
        return normalized.lower()


class AdminProviderWithdrawCompleteRequest(ProviderWithdrawCompleteRequest):
    ownerAddress: str = Field(..., min_length=1, max_length=64)


class AdminProviderWithdrawReviewRequest(BaseModel):
    ownerAddress: str = Field(..., min_length=1, max_length=64)
    reviewDecision: str = Field(..., min_length=6, max_length=16)
    reviewerAddress: Optional[str] = Field(default=None, max_length=64)
    reviewerNote: Optional[str] = Field(default=None, max_length=512)


class OwnerSpendLimitUpdateRequest(BaseModel):
    spendingLimitUsdc: Optional[Decimal] = Field(default=None)
    allowUnlimited: bool = False

    @field_validator("spendingLimitUsdc")
    @classmethod
    def validate_spending_limit_usdc(
        cls, value: Optional[Decimal]
    ) -> Optional[Decimal]:
        if value is None:
            return None
        if value <= 0:
            raise ValueError(SPENDING_LIMIT_POSITIVE_ERROR)
        if value != value.quantize(Decimal("0.000001")):
            raise ValueError(SPENDING_LIMIT_DECIMAL_PLACES_ERROR)
        return value


class VoucherRedeemRequest(BaseModel):
    voucherCode: str = Field(..., min_length=12, max_length=64)

    @field_validator("voucherCode")
    @classmethod
    def validate_voucher_code(cls, value: str) -> str:
        normalized = str(value or "").strip().upper()
        compact = "".join(ch for ch in normalized if ch.isalnum())
        if len(compact) != VOUCHER_CODE_LENGTH:
            raise ValueError(VOUCHER_CODE_LENGTH_ERROR)
        if not compact.isalnum():
            raise ValueError(VOUCHER_CODE_ALPHANUMERIC_ERROR)
        return normalized


# Backward-compatible aliases.
AgentCredentialIssueRequest = CredentialIssueRequest
AgentCredentialQuotaUpdateRequest = CredentialQuotaUpdateRequest
