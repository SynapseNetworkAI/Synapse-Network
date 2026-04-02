from __future__ import annotations

from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class VoucherRedeemCommand(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    owner_address: str = Field(alias="ownerAddress")
    voucher_code: str = Field(alias="voucherCode")
    normalized_code: str = Field(alias="normalizedCode")
    code_hash: str = Field(alias="codeHash")
    idempotency_key: str = Field(alias="idempotencyKey")
    request_hash: str = Field(alias="requestHash")
    request_id: Optional[str] = Field(default=None, alias="requestId")
    client_ip: Optional[str] = Field(default=None, alias="clientIp")
    user_agent: Optional[str] = Field(default=None, alias="userAgent")


class VoucherRedemptionResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    redemption_id: str = Field(alias="redemptionId")
    voucher_code_id: str = Field(alias="voucherCodeId")
    campaign_id: str = Field(alias="campaignId")
    campaign_code: str = Field(alias="campaignCode")
    campaign_display_name: str = Field(alias="campaignDisplayName")
    voucher_code_last4: str = Field(alias="voucherCodeLast4")
    granted_amount_usdc: Decimal = Field(alias="grantedAmountUsdc")
    owner_address: str = Field(alias="ownerAddress")
    ledger_entry_id: str = Field(alias="ledgerEntryId")
    target_account_id: str = Field(alias="targetAccountId")
    promo_account_id: str = Field(alias="promoAccountId")
    status: str
    before_balance_usdc: Decimal = Field(alias="beforeBalanceUsdc")
    after_balance_usdc: Decimal = Field(alias="afterBalanceUsdc")
    redeemed_at: str = Field(alias="redeemedAt")
