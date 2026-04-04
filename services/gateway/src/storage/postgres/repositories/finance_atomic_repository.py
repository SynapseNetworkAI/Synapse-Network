"""Finance atomic repository — thin composer class.

Inherits all domain logic from 4 mixin files and adds only
__init__ + redeem_credit_voucher_atomic.
"""
from __future__ import annotations

import time
from decimal import Decimal
from typing import Any, Callable, Optional
from uuid import uuid4

from src.domain.audit import AuditLogRow
from src.domain.voucher import VoucherRedeemCommand, VoucherRedemptionResult
from src.utils.datetime_utils import now_dt_str, to_dt_str

from ..database_manager import DatabaseManager
from .finance_atomic_core_mixin import (
    FinanceAtomicCoreMixin,
    VaultWithdrawalUpsertSpec,
    _INTEGRITY_ERRORS,
)
from .finance_atomic_deposit_mixin import FinanceAtomicDepositMixin
from .finance_atomic_withdraw_mixin import FinanceAtomicWithdrawMixin
from .finance_atomic_voucher_mixin import FinanceAtomicVoucherMixin


class FinanceAtomicRepository(
    FinanceAtomicCoreMixin,
    FinanceAtomicDepositMixin,
    FinanceAtomicWithdrawMixin,
    FinanceAtomicVoucherMixin,
):
    """Postgres-backed atomic finance repository."""

    def __init__(
        self,
        db: DatabaseManager,
        quantize6: Callable[[Any], Decimal],
        balance_upsert_sql: str,
        balance_for_update_sql: str,
        audit_insert_sql: str,
        restricted_session_statuses: tuple[str, ...],
    ):
        self._db = db
        self._q6 = quantize6
        self._balance_upsert_sql = balance_upsert_sql
        self._balance_for_update_sql = balance_for_update_sql
        _ = audit_insert_sql
        self._restricted_session_statuses = restricted_session_statuses

    def redeem_credit_voucher_atomic(
        self, command: VoucherRedeemCommand
    ) -> VoucherRedemptionResult:
        now = int(time.time())
        now_text = to_dt_str(now, now_dt_str())
        owner = str(command.owner_address or "").strip().lower()

        with self._db.connect() as conn:
            try:
                with conn.cursor() as cur:
                    owner_id = self._ensure_owner_account(cur, owner, now_text)

                    if command.idempotency_key:
                        existing = self._read_existing_voucher_redemption_by_idempotency(
                            cur,
                            owner_id=owner_id,
                            client_request_id=command.idempotency_key,
                        )
                        if existing is not None:
                            stored_hash = str(existing[14] or "")
                            if stored_hash and stored_hash != str(command.request_hash or ""):
                                raise RuntimeError(
                                    "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD"
                                )
                            return self._voucher_result_from_row(
                                existing,
                                before_balance=Decimal("0"),
                                after_balance=Decimal("0"),
                            )

                    cur.execute(
                        """
                        SELECT
                            code.voucher_code_id,
                            code.campaign_id,
                            code.code_last4,
                            code.status,
                            code.owner_id_redeemed,
                            code.redemption_id,
                            camp.campaign_code,
                            camp.display_name,
                            camp.status,
                            camp.credit_amount_usdc,
                            camp.starts_at,
                            camp.expires_at,
                            camp.max_total_redemptions,
                            camp.max_redemptions_per_owner,
                            camp.allowlist_mode
                        FROM synapse_credit_voucher_codes AS code
                        INNER JOIN synapse_credit_voucher_campaigns AS camp
                            ON camp.campaign_id = code.campaign_id
                        WHERE code.code_hash = %s
                        FOR UPDATE OF code, camp
                        """,
                        (command.code_hash,),
                    )
                    row = cur.fetchone()
                    if row is None:
                        raise RuntimeError("INVALID_VOUCHER_CODE")

                    (
                        voucher_code_id,
                        campaign_id,
                        code_last4,
                        code_status,
                        owner_id_redeemed,
                        existing_redemption_id,
                        campaign_code,
                        campaign_display_name,
                        campaign_status,
                        credit_amount_usdc,
                        starts_at,
                        expires_at,
                        max_total_redemptions,
                        max_redemptions_per_owner,
                        allowlist_mode,
                    ) = row

                    normalized_code_status = str(code_status or "").strip().lower()
                    normalized_campaign_status = str(campaign_status or "").strip().lower()

                    if normalized_code_status in {"redeemed", "disabled"} or owner_id_redeemed:
                        raise RuntimeError("VOUCHER_ALREADY_REDEEMED")
                    if normalized_code_status == "expired":
                        raise RuntimeError("VOUCHER_EXPIRED")
                    if normalized_campaign_status in {"draft", "paused", "archived"}:
                        raise RuntimeError("VOUCHER_CAMPAIGN_INACTIVE")
                    if normalized_campaign_status == "expired":
                        raise RuntimeError("VOUCHER_EXPIRED")
                    if existing_redemption_id:
                        raise RuntimeError("VOUCHER_ALREADY_REDEEMED")

                    if starts_at is not None and to_dt_str(starts_at, "") > now_text:
                        raise RuntimeError("VOUCHER_CAMPAIGN_INACTIVE")
                    if expires_at is not None and to_dt_str(expires_at, "") <= now_text:
                        raise RuntimeError("VOUCHER_EXPIRED")

                    if str(allowlist_mode or "").strip().lower() == "owner_allowlist":
                        cur.execute(
                            """
                            SELECT 1
                            FROM synapse_credit_voucher_owner_allowlist
                            WHERE campaign_id = %s AND owner_id = %s
                            LIMIT 1
                            """,
                            (campaign_id, owner_id),
                        )
                        if cur.fetchone() is None:
                            raise RuntimeError("OWNER_NOT_ELIGIBLE")

                    if max_total_redemptions is None:
                        raise RuntimeError("VOUCHER_CAMPAIGN_BUDGET_UNDEFINED")

                    cur.execute(
                        """
                        SELECT COUNT(*)
                        FROM synapse_credit_voucher_redemptions
                        WHERE campaign_id = %s
                          AND status = 'COMPLETED'
                        """,
                        (campaign_id,),
                    )
                    if int((cur.fetchone() or [0])[0] or 0) >= int(max_total_redemptions):
                        raise RuntimeError("VOUCHER_CAMPAIGN_EXHAUSTED")

                    cur.execute(
                        """
                        SELECT COUNT(*)
                        FROM synapse_credit_voucher_redemptions
                        WHERE campaign_id = %s
                          AND owner_id = %s
                          AND status = 'COMPLETED'
                        """,
                        (campaign_id, owner_id),
                    )
                    owner_redemption_count = int((cur.fetchone() or [0])[0] or 0)
                    if owner_redemption_count >= int(max_redemptions_per_owner or 1):
                        raise RuntimeError("OWNER_REDEMPTION_LIMIT_EXCEEDED")

                    amount = self._q6(credit_amount_usdc)
                    before_owner = self._load_available_balance(cur, owner, "consumer", now)
                    promo_account_id, promo_before = self._load_locked_campaign_promo_balance(
                        cur,
                        campaign_id=str(campaign_id),
                        credit_amount_usdc=self._q6(credit_amount_usdc),
                        max_total_redemptions=int(max_total_redemptions),
                        now=now,
                    )
                    if promo_before < amount:
                        raise RuntimeError("VOUCHER_CAMPAIGN_EXHAUSTED")

                    after_owner = self._q6(before_owner + amount)
                    promo_after = self._q6(promo_before - amount)
                    target_account_id = self._account_identity(owner, "consumer")[0]

                    self._set_available_balance(
                        cur, owner, "consumer", after_owner, now, now_text
                    )
                    self._upsert_balance_triplet(
                        cur,
                        str(campaign_id),
                        "platform_promo",
                        promo_after,
                        Decimal("0"),
                        Decimal("0"),
                        now_text,
                    )

                    redemption_id = f"vrd-{uuid4().hex}"
                    ledger_entry_id = f"ledger-voucher::{redemption_id}"
                    cur.execute(
                        """
                        INSERT INTO synapse_credit_voucher_redemptions (
                            redemption_id, voucher_code_id, campaign_id, owner_id,
                            owner_address, target_account_id, promo_account_id, ledger_entry_id,
                            granted_amount_usdc, before_balance_usdc, after_balance_usdc,
                            status, request_id, client_request_id, request_hash,
                            client_ip, user_agent, created_at, updated_at
                        ) VALUES (
                            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'COMPLETED',
                            %s, %s, %s, %s, %s, %s, %s
                        )
                        """,
                        (
                            redemption_id,
                            voucher_code_id,
                            campaign_id,
                            owner_id,
                            owner,
                            target_account_id,
                            promo_account_id,
                            ledger_entry_id,
                            str(amount),
                            str(before_owner),
                            str(after_owner),
                            command.request_id,
                            command.idempotency_key,
                            command.request_hash,
                            command.client_ip,
                            command.user_agent,
                            now_text,
                            now_text,
                        ),
                    )

                    cur.execute(
                        """
                        UPDATE synapse_credit_voucher_codes
                        SET status = 'redeemed',
                            owner_id_redeemed = %s,
                            redeemed_by_address = %s,
                            redeemed_at = %s,
                            redemption_id = %s,
                            updated_at = %s
                        WHERE voucher_code_id = %s
                        """,
                        (
                            owner_id,
                            owner,
                            now_text,
                            redemption_id,
                            now_text,
                            voucher_code_id,
                        ),
                    )

                    self._append_ledger_entry(
                        cur,
                        entry_id=ledger_entry_id,
                        reference_type="voucher_redemption",
                        reference_id=redemption_id,
                        business_type="voucher_redeem",
                        debit_account_id=promo_account_id,
                        credit_account_id=target_account_id,
                        amount_usdc=amount,
                        request_id=command.request_id,
                    )
                    self._append_finance_audit_row(
                        cur,
                        AuditLogRow(
                            actionType="VOUCHER_REDEEMED",
                            businessType="deposit",
                            riskLevel="green",
                            ownerAddress=owner,
                            requestId=command.request_id,
                            clientIp=command.client_ip,
                            userAgent=command.user_agent,
                            amountDelta=amount,
                            beforeBalance=before_owner,
                            afterBalance=after_owner,
                            resultStatus="COMPLETED",
                            ledgerId=ledger_entry_id,
                            status="COMPLETED",
                            message=f"campaign={campaign_code}; voucherLast4={code_last4}",
                            detailJson={
                                "campaignId": str(campaign_id),
                                "campaignCode": str(campaign_code),
                                "campaignDisplayName": str(campaign_display_name),
                                "voucherCodeId": str(voucher_code_id),
                                "voucherCodeLast4": str(code_last4),
                                "redemptionId": redemption_id,
                                "promoAccountId": promo_account_id,
                                "targetAccountId": target_account_id,
                            },
                        ),
                    )

                conn.commit()
            except _INTEGRITY_ERRORS:
                conn.rollback()
                if command.idempotency_key:
                    with conn.cursor() as cur:
                        owner_id = self._owner_id(owner)
                        existing = self._read_existing_voucher_redemption_by_idempotency(
                            cur,
                            owner_id=owner_id,
                            client_request_id=command.idempotency_key,
                        )
                        if existing is not None:
                            stored_hash = str(existing[14] or "")
                            if stored_hash and stored_hash != str(command.request_hash or ""):
                                raise RuntimeError(
                                    "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD"
                                )
                            return self._voucher_result_from_row(
                                existing,
                                before_balance=Decimal("0"),
                                after_balance=Decimal("0"),
                            )
                raise
            except Exception:
                conn.rollback()
                raise

        return VoucherRedemptionResult(
            redemptionId=redemption_id,
            voucherCodeId=str(voucher_code_id),
            campaignId=str(campaign_id),
            campaignCode=str(campaign_code),
            campaignDisplayName=str(campaign_display_name),
            voucherCodeLast4=str(code_last4),
            grantedAmountUsdc=amount,
            ownerAddress=owner,
            ledgerEntryId=ledger_entry_id,
            targetAccountId=target_account_id,
            promoAccountId=promo_account_id,
            status="COMPLETED",
            beforeBalanceUsdc=before_owner,
            afterBalanceUsdc=after_owner,
            redeemedAt=now_text,
        )
