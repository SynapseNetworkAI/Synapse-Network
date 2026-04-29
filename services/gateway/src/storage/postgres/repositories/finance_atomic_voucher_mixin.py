"""Finance atomic repository — voucher/charge domain helpers and public atomics.

Contains: campaign promo balance loading, voucher redemption helpers,
charge_consumer_and_record_usage_atomic.
"""
from __future__ import annotations

# quality-budget-disable-reason: type: ignore[attr-defined] because sibling mixins provide these members.

import time
from decimal import Decimal
from typing import Any

from src.domain.audit import AuditLogRow
from src.domain.finance import (
    ChargeConsumerUsageCommand,
    ConsumerChargeResult,
    SettleConsumerHoldUsageCommand,
)
from src.domain.voucher import VoucherRedemptionResult
from src.utils.datetime_utils import now_dt_str, to_dt_str


class FinanceAtomicVoucherMixin:
    """Voucher/charge domain helpers and charge_consumer_and_record_usage_atomic."""

    def _load_locked_campaign_promo_balance(
        self,
        cur: Any,
        *,
        campaign_id: str,
        credit_amount_usdc: Decimal,
        max_total_redemptions: int,
        now: int,
    ) -> tuple[str, Decimal]:
        now_text = to_dt_str(now, now_dt_str())
        promo_account_id = self._ensure_platform_promo_account(cur, campaign_id, now_text)  # type: ignore[attr-defined]

        cur.execute(
            """
            SELECT COALESCE(SUM(granted_amount_usdc), 0)
            FROM synapse_credit_voucher_redemptions
            WHERE campaign_id = %s
              AND status = 'COMPLETED'
            """,
            (campaign_id,),
        )
        redeemed_amount = self._q6((cur.fetchone() or [0])[0])  # type: ignore[attr-defined]
        total_budget = self._q6(credit_amount_usdc * Decimal(max_total_redemptions))  # type: ignore[attr-defined]
        derived_available = self._q6(max(Decimal("0"), total_budget - redeemed_amount))  # type: ignore[attr-defined]

        cur.execute(self._balance_for_update_sql, (promo_account_id,))  # type: ignore[attr-defined]
        hit = cur.fetchone()
        if hit is None:
            self._upsert_balance_triplet(  # type: ignore[attr-defined]
                cur, campaign_id, "platform_promo", derived_available,
                Decimal("0"), Decimal("0"), now_text,
            )
            return promo_account_id, derived_available

        current_available = self._q6(hit[0])  # type: ignore[attr-defined]
        current_pending = self._q6(hit[1])  # type: ignore[attr-defined]
        current_frozen = self._q6(hit[2])  # type: ignore[attr-defined]
        if (
            current_available != derived_available
            or current_pending != Decimal("0")
            or current_frozen != Decimal("0")
        ):
            self._upsert_balance_triplet(  # type: ignore[attr-defined]
                cur, campaign_id, "platform_promo", derived_available,
                Decimal("0"), Decimal("0"), now_text,
            )
            return promo_account_id, derived_available

        return promo_account_id, current_available

    def _read_existing_voucher_redemption_by_idempotency(
        self,
        cur: Any,
        *,
        owner_id: str,
        client_request_id: str,
    ) -> tuple[Any, ...] | None:
        cur.execute(
            """
            SELECT
                red.redemption_id,
                red.voucher_code_id,
                red.campaign_id,
                camp.campaign_code,
                camp.display_name,
                code.code_last4,
                red.granted_amount_usdc,
                red.owner_address,
                red.ledger_entry_id,
                red.target_account_id,
                red.promo_account_id,
                red.status,
                red.before_balance_usdc,
                red.after_balance_usdc,
                red.request_hash,
                red.created_at
            FROM synapse_credit_voucher_redemptions AS red
            INNER JOIN synapse_credit_voucher_campaigns AS camp
                ON camp.campaign_id = red.campaign_id
            INNER JOIN synapse_credit_voucher_codes AS code
                ON code.voucher_code_id = red.voucher_code_id
            WHERE red.owner_id = %s
              AND red.client_request_id = %s
            ORDER BY red.created_at DESC
            LIMIT 1
            """,
            (owner_id, client_request_id),
        )
        return cur.fetchone()

    @staticmethod
    def _voucher_result_from_row(
        row: tuple[Any, ...],
        *,
        before_balance: Decimal,
        after_balance: Decimal,
    ) -> Any:
        (
            redemption_id,
            voucher_code_id,
            campaign_id,
            campaign_code,
            display_name,
            code_last4,
            granted_amount_usdc,
            owner_address,
            ledger_entry_id,
            target_account_id,
            promo_account_id,
            status,
            stored_before_balance,
            stored_after_balance,
            _request_hash,
            created_at,
        ) = row
        return VoucherRedemptionResult(
            redemptionId=str(redemption_id),
            voucherCodeId=str(voucher_code_id),
            campaignId=str(campaign_id),
            campaignCode=str(campaign_code),
            campaignDisplayName=str(display_name),
            voucherCodeLast4=str(code_last4),
            grantedAmountUsdc=granted_amount_usdc,
            ownerAddress=str(owner_address),
            ledgerEntryId=str(ledger_entry_id),
            targetAccountId=str(target_account_id),
            promoAccountId=str(promo_account_id),
            status=str(status),
            beforeBalanceUsdc=stored_before_balance or before_balance,
            afterBalanceUsdc=stored_after_balance or after_balance,
            redeemedAt=to_dt_str(created_at, "") or "",
        )

    def charge_consumer_and_record_usage_atomic(
        self,
        command: ChargeConsumerUsageCommand,
    ) -> ConsumerChargeResult:
        now = int(time.time())
        now_text = to_dt_str(now, now_dt_str())
        owner = str(command.owner_wallet or "").strip().lower()
        provider = str(command.provider_wallet or "").strip().lower()

        with self._db.connect() as conn:  # type: ignore[attr-defined]
            with conn.cursor() as cur:
                self._assert_charge_not_restricted(cur, owner, provider, now)  # type: ignore[attr-defined]

                before_consumer = self._load_available_balance(  # type: ignore[attr-defined]
                    cur, owner, "consumer", now
                )
                if before_consumer < self._q6(command.total_charge):  # type: ignore[attr-defined]
                    raise RuntimeError("INSUFFICIENT_BALANCE")

                provider_before = self._load_available_balance(cur, provider, "provider", now)  # type: ignore[attr-defined]
                platform_before = self._load_available_balance(cur, "__platform__", "platform_fee", now)  # type: ignore[attr-defined]
                consumer_after = self._q6(before_consumer - self._q6(command.total_charge))  # type: ignore[attr-defined]
                provider_after = self._q6(provider_before + self._q6(command.provider_net))  # type: ignore[attr-defined]
                platform_after = self._q6(  # type: ignore[attr-defined]
                    platform_before + self._q6(command.platform_fee_total)  # type: ignore[attr-defined]
                )
                invocation_id = (
                    str(command.invocation.invocation_id or "").strip()
                    if command.invocation is not None
                    else str(command.usage_row.id or "").strip()
                )
                self._set_available_balance(cur, owner, "consumer", consumer_after, now, now_text)  # type: ignore[attr-defined]
                self._set_available_balance(cur, provider, "provider", provider_after, now, now_text)  # type: ignore[attr-defined]
                self._set_available_balance(  # type: ignore[attr-defined]
                    cur, "__platform__", "platform_fee", platform_after, now, now_text,
                )

                row = self._build_charge_usage_row(command, invocation_id, owner, provider, now)  # type: ignore[attr-defined]
                self._record_charge_facts(cur, command, row, owner, provider, now_text)  # type: ignore[attr-defined]

                self._append_finance_audit_row(  # type: ignore[attr-defined]
                    cur,
                    AuditLogRow(
                        actionType="CONSUMER_CHARGE_ATOMIC",
                        businessType="charge",
                        riskLevel="green",
                        ownerAddress=owner,
                        amountDelta=-self._q6(command.total_charge),  # type: ignore[attr-defined]
                        beforeBalance=before_consumer,
                        afterBalance=consumer_after,
                        resultStatus="SUCCEEDED",
                        status="SUCCEEDED",
                        requestId=row.request_id,
                        message=f"provider={provider}; invocation={row.id}",
                    ),
                )

            conn.commit()
        return ConsumerChargeResult(
            consumerAvailableBalanceAfter=consumer_after
        )

    def settle_consumer_llm_hold_atomic(
        self,
        command: SettleConsumerHoldUsageCommand,
    ) -> ConsumerChargeResult:
        """Atomically capture actual LLM usage from a pre-authorized consumer hold."""
        now = int(time.time())
        now_text = to_dt_str(now, now_dt_str())
        owner = str(command.owner_wallet or "").strip().lower()
        provider = str(command.provider_wallet or "").strip().lower()

        hold_usdc = self._q6(command.hold_usdc)  # type: ignore[attr-defined]
        total_charge = self._q6(command.total_charge)  # type: ignore[attr-defined]
        provider_net = self._q6(command.provider_net)  # type: ignore[attr-defined]
        platform_fee_total = self._q6(command.platform_fee_total)  # type: ignore[attr-defined]
        if total_charge > hold_usdc:
            raise RuntimeError("LLM_BILLING_HOLD_EXCEEDED")

        with self._db.connect() as conn:  # type: ignore[attr-defined]
            with conn.cursor() as cur:
                self._assert_charge_not_restricted(cur, owner, provider, now)  # type: ignore[attr-defined]

                consumer_available, consumer_pending, consumer_frozen = self._load_locked_balance_triplet(  # type: ignore[attr-defined]
                    cur, owner, "consumer", now
                )
                if consumer_frozen < hold_usdc:
                    raise RuntimeError("LLM_HOLD_FROZEN_BALANCE_INCONSISTENT")

                provider_before = self._load_available_balance(cur, provider, "provider", now)  # type: ignore[attr-defined]
                platform_before = self._load_available_balance(cur, "__platform__", "platform_fee", now)  # type: ignore[attr-defined]

                consumer_after = self._q6(consumer_available + hold_usdc - total_charge)  # type: ignore[attr-defined]
                consumer_frozen_after = self._q6(consumer_frozen - hold_usdc)  # type: ignore[attr-defined]
                provider_after = self._q6(provider_before + provider_net)  # type: ignore[attr-defined]
                platform_after = self._q6(platform_before + platform_fee_total)  # type: ignore[attr-defined]

                self._upsert_balance_triplet(  # type: ignore[attr-defined]
                    cur,
                    owner,
                    "consumer",
                    consumer_after,
                    consumer_pending,
                    consumer_frozen_after,
                    now_text,
                )
                self._set_available_balance(cur, provider, "provider", provider_after, now, now_text)  # type: ignore[attr-defined]
                self._set_available_balance(  # type: ignore[attr-defined]
                    cur, "__platform__", "platform_fee", platform_after, now, now_text
                )

                charge_command = ChargeConsumerUsageCommand(
                    owner_wallet=command.owner_wallet,
                    provider_wallet=command.provider_wallet,
                    total_charge=total_charge,
                    provider_net=provider_net,
                    platform_fee_total=platform_fee_total,
                    usage_row=command.usage_row,
                    request_id=command.request_id,
                    unit_price=command.unit_price,
                    protocol_fee=command.protocol_fee,
                    routing_tax=command.routing_tax,
                    invocation=command.invocation,
                )
                invocation_id = (
                    str(command.invocation.invocation_id or "").strip()
                    if command.invocation is not None
                    else str(command.usage_row.id or "").strip()
                )
                row = self._build_charge_usage_row(charge_command, invocation_id, owner, provider, now)  # type: ignore[attr-defined]
                self._record_charge_facts(cur, charge_command, row, owner, provider, now_text)  # type: ignore[attr-defined]

                self._append_finance_audit_row(  # type: ignore[attr-defined]
                    cur,
                    AuditLogRow(
                        actionType="CONSUMER_LLM_HOLD_SETTLED_ATOMIC",
                        businessType="charge",
                        riskLevel="green",
                        ownerAddress=owner,
                        amountDelta=-total_charge,
                        beforeBalance=consumer_available,
                        afterBalance=consumer_after,
                        resultStatus="SUCCEEDED",
                        status="SUCCEEDED",
                        requestId=row.request_id,
                        message=f"provider={provider}; invocation={row.id}; hold={hold_usdc}",
                    ),
                )

            conn.commit()
        return ConsumerChargeResult(consumerAvailableBalanceAfter=consumer_after)
