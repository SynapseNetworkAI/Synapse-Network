from datetime import datetime, timezone

from src.core.errors import BadRequestError
from src.domain.enums import ExecutionJobStatus
from src.storage.analytics import GatewayDashboardProjectionRepository
from src.storage.analytics.provider_withdraw_review import ProviderWithdrawReviewRepository, ProviderWithdrawReviewItem
from src.domain import AdminApproval
from src.storage.base import AdminStore


class DashboardService:
    def __init__(
        self,
        store: AdminStore,
        gateway_projection: GatewayDashboardProjectionRepository,
        provider_withdraw_review_repository: ProviderWithdrawReviewRepository,
    ) -> None:
        self._store = store
        self._gateway_projection = gateway_projection
        self._provider_withdraw_review_repository = provider_withdraw_review_repository

    def get_overview(self) -> dict:
        snapshot = self._gateway_projection.get_snapshot()
        pending_approvals = self._store.approval.count_pending_approvals()
        return {
            "metrics": {
                "pendingApprovals": pending_approvals,
                "depositExceptions": snapshot.deposit_exceptions,
                "auditAlerts": snapshot.audit_alerts,
                "vaultLedgerDelta": f"{snapshot.vault_ledger_delta:.2f}",
            },
            "highlights": [
                {
                    "title": "待执行审批队列",
                    "value": str(pending_approvals),
                    "trend": "monitor" if pending_approvals else "stable",
                },
                {
                    "title": "充值修复异常",
                    "value": str(snapshot.deposit_exceptions),
                    "trend": "requires_attention" if snapshot.deposit_exceptions else "stable",
                },
                {
                    "title": "审计告警",
                    "value": str(snapshot.audit_alerts),
                    "trend": "requires_attention" if snapshot.audit_alerts else "stable",
                },
            ],
        }

    def get_finance_overview(self) -> dict:
        snapshot = self._gateway_projection.get_finance_snapshot()
        return {
            "todayChargeUsdc": self._format_decimal(snapshot.today_charge_usdc),
            "todayDepositUsdc": self._format_decimal(snapshot.today_deposit_usdc),
            "todayRefundUsdc": self._format_decimal(snapshot.today_consumer_refund_usdc),
            "todayWithdrawalUsdc": self._format_decimal(snapshot.today_provider_withdrawal_usdc),
            "todayInvocationCount": snapshot.today_invocation_count,
            "todayPlatformFeeEarnedUsdc": self._format_decimal(snapshot.today_platform_fee_earned_usdc),
            "todayProviderEarnedUsdc": self._format_decimal(snapshot.today_provider_earned_usdc),
            "ownerLiabilityUsdc": self._format_decimal(snapshot.consumer_liability_usdc),
            "refundableConsumerBalanceUsdc": self._format_decimal(snapshot.refundable_consumer_balance_usdc),
            "providerPayableUsdc": self._format_decimal(snapshot.provider_payable_usdc),
            "providerAvailableToWithdrawUsdc": self._format_decimal(snapshot.provider_available_to_withdraw_usdc),
            "providerLockedBalanceUsdc": self._format_decimal(snapshot.provider_locked_balance_usdc),
            "platformFeeBalanceUsdc": self._format_decimal(snapshot.platform_fee_balance_usdc),
            "vaultLedgerDeltaUsdc": self._format_decimal(snapshot.vault_ledger_delta_usdc),
            "pendingDepositCount": snapshot.pending_deposit_count,
            "pendingWithdrawalCount": snapshot.pending_provider_withdrawal_count,
            "projectedAt": self._format_timestamp(snapshot.projected_at),
        }

    def get_activity_trends(self) -> dict:
        points = self._gateway_projection.list_activity_trends()
        return {
            "points": [
                {
                    "bucketDate": point.bucket_date.isoformat(),
                    "depositUsdc": self._format_decimal(point.deposit_usdc),
                    "chargeUsdc": self._format_decimal(point.charge_usdc),
                    "invocationCount": point.invocation_count,
                    "platformFeeEarnedUsdc": self._format_decimal(point.platform_fee_earned_usdc),
                    "providerEarnedUsdc": self._format_decimal(point.provider_earned_usdc),
                    "refundUsdc": self._format_decimal(point.consumer_refund_usdc),
                    "withdrawalUsdc": self._format_decimal(point.provider_withdrawal_usdc),
                    "netFlowUsdc": self._format_decimal(point.net_flow_usdc),
                }
                for point in points
            ]
        }

    def get_operations_overview(self) -> dict:
        snapshot = self._gateway_projection.get_operations_snapshot()
        return {
            "gatewayStatus": snapshot.gateway_status,
            "indexerLastProcessedAt": self._format_timestamp(snapshot.indexer_last_processed_at),
            "backfillLastScanAt": self._format_timestamp(snapshot.backfill_last_scan_at),
            "backfillLastScannedBlock": snapshot.backfill_last_scanned_block,
            "recentGatewayFailures": snapshot.recent_gateway_failures,
            "failedDepositCount": snapshot.failed_deposit_count,
            "recentAuditAlerts": snapshot.recent_audit_alerts,
            "lastReconciliationAt": self._format_timestamp(snapshot.last_reconciliation_at),
            "reconciliationAlert": snapshot.reconciliation_alert,
            "reconciliationDeltaUsdc": self._format_decimal(snapshot.reconciliation_delta_usdc),
            "reconciliationLastError": snapshot.reconciliation_last_error,
            "projectedAt": self._format_timestamp(snapshot.projected_at),
        }

    def get_reconciliation_detail(self) -> dict:
        overview = self._gateway_projection.get_snapshot()
        operations = self._gateway_projection.get_operations_snapshot()
        finance = self._gateway_projection.get_finance_snapshot()
        runtime_state = self._gateway_projection.get_reconciliation_runtime_state()
        audit_alerts = max(overview.audit_alerts, operations.recent_audit_alerts, self._store.audit.count_alerts())

        signed_difference = None
        imbalance_direction = "unknown"
        if runtime_state.chain_vault_usdc is not None and runtime_state.ledger_obligation_usdc is not None:
            signed_difference = runtime_state.chain_vault_usdc - runtime_state.ledger_obligation_usdc
            if signed_difference > 0:
                imbalance_direction = "vault_surplus"
            elif signed_difference < 0:
                imbalance_direction = "vault_deficit"
            else:
                imbalance_direction = "balanced"

        delta_value = runtime_state.delta_usdc
        if delta_value is None:
            delta_value = operations.reconciliation_delta_usdc

        return {
            "gatewayStatus": operations.gateway_status,
            "reconciliationAlert": operations.reconciliation_alert,
            "reconciliationDeltaUsdc": self._format_decimal(delta_value),
            "signedDifferenceUsdc": self._format_decimal(signed_difference) if signed_difference is not None else None,
            "imbalanceDirection": imbalance_direction,
            "chainVaultUsdc": self._format_decimal(runtime_state.chain_vault_usdc) if runtime_state.chain_vault_usdc is not None else None,
            "ledgerObligationUsdc": self._format_decimal(runtime_state.ledger_obligation_usdc) if runtime_state.ledger_obligation_usdc is not None else None,
            "lastReconciliationAt": self._format_timestamp(runtime_state.last_check_at or operations.last_reconciliation_at),
            "runtimeStateUpdatedAt": self._format_timestamp(runtime_state.updated_at),
            "reconciliationLastError": operations.reconciliation_last_error,
            "pendingApprovals": self._store.approval.count_pending_approvals(),
            "depositExceptions": overview.deposit_exceptions,
            "auditAlerts": audit_alerts,
            "pendingDepositCount": finance.pending_deposit_count,
            "pendingWithdrawalCount": finance.pending_provider_withdrawal_count,
            "todayRefundUsdc": self._format_decimal(finance.today_consumer_refund_usdc),
            "todayWithdrawalUsdc": self._format_decimal(finance.today_provider_withdrawal_usdc),
            "ownerLiabilityUsdc": self._format_decimal(finance.consumer_liability_usdc),
            "providerPayableUsdc": self._format_decimal(finance.provider_payable_usdc),
            "platformFeeBalanceUsdc": self._format_decimal(finance.platform_fee_balance_usdc),
            "chainConfirmedNotLedgerConfirmedCount": finance.chain_confirmed_not_ledger_confirmed_count,
            "depositP95SyncDelaySeconds": finance.deposit_p95_sync_delay_seconds,
            "recentlyCompletedOutflowsUsdc": self._format_decimal(finance.recently_completed_outflows_usdc),
            "projectedAt": self._format_timestamp(operations.projected_at or finance.projected_at),
            "priorityApprovals": [
                self._serialize_reconciliation_approval_summary(item)
                for item in self._list_active_finance_approvals(limit=6)
            ],
            "depositRepairApprovals": [
                self._serialize_reconciliation_approval_summary(item)
                for item in self._list_active_deposit_repair_approvals(limit=6)
            ],
            "pendingWithdrawalReviews": [
                self._serialize_withdraw_review_summary(item)
                for item in self._provider_withdraw_review_repository.list_pending_reviews(limit=6)
            ],
        }

    def get_reconciliation_drilldown(
        self,
        *,
        owner_address: str | None = None,
        request_id: str | None = None,
        tx_hash: str | None = None,
    ) -> dict:
        owner_value = owner_address.strip() if owner_address else None
        request_value = request_id.strip() if request_id else None
        tx_value = tx_hash.strip() if tx_hash else None
        if not owner_value and not request_value and not tx_value:
            raise BadRequestError("ownerAddress, requestId, or txHash is required")

        priority_matches = [
            self._serialize_reconciliation_approval_summary(item)
            for item in self._list_active_finance_approvals(limit=200)
            if self._matches_approval_locator(item, owner_address=owner_value, request_id=request_value, tx_hash=tx_value)
        ]
        deposit_repair_matches = [
            self._serialize_reconciliation_approval_summary(item)
            for item in self._list_active_deposit_repair_approvals(limit=200)
            if self._matches_approval_locator(item, owner_address=owner_value, request_id=request_value, tx_hash=tx_value)
        ]
        review_matches = [
            self._serialize_withdraw_review_summary(item)
            for item in self._provider_withdraw_review_repository.list_pending_reviews(limit=200)
            if self._matches_review_locator(item, owner_address=owner_value, request_id=request_value, tx_hash=tx_value)
        ]

        return {
            "ownerAddress": owner_value,
            "requestId": request_value,
            "txHash": tx_value,
            "priorityApprovals": priority_matches[:20],
            "depositRepairApprovals": deposit_repair_matches[:20],
            "pendingWithdrawalReviews": review_matches[:20],
        }

    def _list_active_finance_approvals(self, limit: int) -> list[AdminApproval]:
        approvals = self._store.approval.list_approvals(limit=max(limit * 3, 12))
        active_statuses = {"SUBMITTED", "UNDER_REVIEW", "APPROVED_PENDING_EXECUTION", "FAILED"}
        finance_types = {"deposit_repair", "withdrawal_approve", "refund_approve"}
        return [
            approval
            for approval in approvals
            if approval.status.value in active_statuses and approval.approval_type in finance_types
        ][:limit]

    def _list_active_deposit_repair_approvals(self, limit: int) -> list[AdminApproval]:
        approvals = self._store.approval.list_approvals(approval_type="deposit_repair", limit=max(limit * 3, 12))
        active_statuses = {"SUBMITTED", "UNDER_REVIEW", "APPROVED_PENDING_EXECUTION", "FAILED"}
        return [approval for approval in approvals if approval.status.value in active_statuses][:limit]

    def _serialize_reconciliation_approval_summary(self, approval: AdminApproval) -> dict:
        return {
            "approvalId": approval.approval_id,
            "approvalType": approval.approval_type,
            "status": approval.status.value,
            "approvalLevel": approval.approval_level.value,
            "requesterRole": self._resolve_requester_role(approval.requester_id),
            "amountUsdc": self._format_decimal(approval.amount_usdc),
            "createdAt": self._format_timestamp(approval.created_at),
            "ownerAddress": approval.owner_address,
            "requestId": approval.request_id,
            "txHash": approval.tx_hash,
        }

    @staticmethod
    def _serialize_withdraw_review_summary(review: ProviderWithdrawReviewItem) -> dict:
        return {
            "withdrawalId": review.withdrawal_id,
            "ownerAddress": review.owner_address,
            "amountUsdc": f"{review.amount_usdc:.2f}",
            "status": review.status,
            "requestId": review.request_id,
            "txHash": review.tx_hash,
            "riskLevel": review.risk_level,
            "riskReasonCode": review.risk_reason_code,
            "evidenceSummary": review.evidence_summary,
            "message": review.message,
            "createdAt": review.created_at,
            "updatedAt": review.updated_at,
        }

    def _resolve_requester_role(self, admin_id: str | None) -> str:
        if not admin_id:
            return "platform_ops_admin"
        bindings = [
            binding
            for binding in self._store.authorization.list_role_bindings(admin_id)
            if binding.status.value == "ACTIVE"
        ]
        return bindings[0].role_key if bindings else "platform_ops_admin"

    @staticmethod
    def _matches_approval_locator(
        approval: AdminApproval,
        *,
        owner_address: str | None,
        request_id: str | None,
        tx_hash: str | None,
    ) -> bool:
        payload = approval.payload or {}
        if owner_address:
            candidates = [approval.owner_address, payload.get("ownerAddress"), payload.get("owner_address")]
            if any(str(candidate).lower() == owner_address.lower() for candidate in candidates if candidate):
                return True
        if request_id:
            candidates = [approval.request_id, payload.get("requestId"), payload.get("request_id")]
            if any(str(candidate) == request_id for candidate in candidates if candidate):
                return True
        if tx_hash:
            candidates = [approval.tx_hash, payload.get("txHash"), payload.get("tx_hash")]
            if any(str(candidate).lower() == tx_hash.lower() for candidate in candidates if candidate):
                return True
        return False

    @staticmethod
    def _matches_review_locator(
        review: ProviderWithdrawReviewItem,
        *,
        owner_address: str | None,
        request_id: str | None,
        tx_hash: str | None,
    ) -> bool:
        if owner_address and review.owner_address.lower() == owner_address.lower():
            return True
        if request_id and review.request_id == request_id:
            return True
        if tx_hash and review.tx_hash and review.tx_hash.lower() == tx_hash.lower():
            return True
        return False

    def get_system_status(self) -> dict:
        snapshot = self._gateway_projection.get_operations_snapshot()
        failed_jobs = self._store.approval.list_execution_jobs(
            status=ExecutionJobStatus.FAILED.value,
            limit=1,
        )
        return {
            "gatewayAdmin": "healthy",
            "gateway": "degraded" if failed_jobs and snapshot.gateway_status == "healthy" else snapshot.gateway_status,
            "approvalQueueDepth": self._store.approval.count_pending_approvals(),
            "lastReconciliationAt": self._format_timestamp(snapshot.last_reconciliation_at),
        }

    def get_diagnostics(self) -> dict:
        operations = self._gateway_projection.get_operations_snapshot()
        overview = self._gateway_projection.get_snapshot()
        pending_approvals = self._store.approval.count_pending_approvals()
        failed_jobs = self._store.approval.list_execution_jobs(
            status=ExecutionJobStatus.FAILED.value,
            limit=20,
        )
        failed_job_count = len(failed_jobs)
        audit_alerts = max(operations.recent_audit_alerts, self._store.audit.count_alerts())

        return {
            "overallStatus": self._resolve_diagnostic_status(
                operations.reconciliation_alert,
                failed_job_count,
                operations.recent_gateway_failures,
                pending_approvals,
                overview.deposit_exceptions,
                audit_alerts,
            ),
            "checkedAt": self._format_timestamp(datetime.now(timezone.utc)),
            "summary": self._build_diagnostic_summary(
                operations.reconciliation_alert,
                operations.reconciliation_delta_usdc,
                failed_job_count,
                overview.deposit_exceptions,
                pending_approvals,
                audit_alerts,
            ),
            "signals": self._build_diagnostic_signals(
                operations.reconciliation_alert,
                operations.reconciliation_delta_usdc,
                operations.reconciliation_last_error,
                failed_job_count,
                pending_approvals,
                overview.deposit_exceptions,
                audit_alerts,
            ),
            "actions": self._build_diagnostic_actions(
                operations.reconciliation_alert,
                operations.recent_gateway_failures,
                failed_job_count,
                pending_approvals,
                overview.deposit_exceptions,
            ),
        }

    @staticmethod
    def _resolve_diagnostic_status(
        reconciliation_alert: bool,
        failed_job_count: int,
        recent_gateway_failures: int,
        pending_approvals: int,
        deposit_exceptions: int,
        audit_alerts: int,
    ) -> str:
        if reconciliation_alert or failed_job_count > 0 or recent_gateway_failures > 0:
            return "degraded"
        if pending_approvals > 0 or deposit_exceptions > 0 or audit_alerts > 0:
            return "monitoring"
        return "nominal"

    @staticmethod
    def _append_summary_part(parts: list[str], value: int, singular: str, plural: str | None = None) -> None:
        if value <= 0:
            return
        noun = singular if value == 1 else plural or f"{singular}s"
        parts.append(f"{value} {noun}")

    def _build_diagnostic_summary(
        self,
        reconciliation_alert: bool,
        reconciliation_delta_usdc,
        failed_job_count: int,
        deposit_exceptions: int,
        pending_approvals: int,
        audit_alerts: int,
    ) -> str:
        parts: list[str] = []
        if reconciliation_alert:
            parts.append(f"reconciliation delta {reconciliation_delta_usdc:.2f} USDC")
        self._append_summary_part(parts, failed_job_count, "failed execution job")
        self._append_summary_part(parts, deposit_exceptions, "deposit exception")
        self._append_summary_part(parts, pending_approvals, "pending approval")
        self._append_summary_part(parts, audit_alerts, "audit alert")
        return ", ".join(parts) if parts else "all control-plane signals nominal"

    @staticmethod
    def _build_signal(signal_id: str, label: str, status: str, value: str, detail: str) -> dict:
        return {
            "signalId": signal_id,
            "label": label,
            "status": status,
            "value": value,
            "detail": detail,
        }

    def _build_diagnostic_signals(
        self,
        reconciliation_alert: bool,
        reconciliation_delta_usdc,
        reconciliation_last_error: str | None,
        failed_job_count: int,
        pending_approvals: int,
        deposit_exceptions: int,
        audit_alerts: int,
    ) -> list[dict]:
        return [
            self._build_signal(
                "reconciliation",
                "Reconciliation drift",
                "degraded" if reconciliation_alert else "nominal",
                f"{reconciliation_delta_usdc:.2f} USDC",
                reconciliation_last_error or "vault and ledger remain aligned",
            ),
            self._build_signal(
                "execution-failures",
                "Execution retries",
                "degraded" if failed_job_count > 0 else "nominal",
                str(failed_job_count),
                "failed jobs require manual retry" if failed_job_count > 0 else "no failed execution jobs pending retry",
            ),
            self._build_signal(
                "pending-approvals",
                "Pending approvals",
                "monitoring" if pending_approvals > 0 else "nominal",
                str(pending_approvals),
                "approvals still waiting for review or execution" if pending_approvals > 0 else "approval queue clear",
            ),
            self._build_signal(
                "deposit-exceptions",
                "Deposit exceptions",
                "monitoring" if deposit_exceptions > 0 else "nominal",
                str(deposit_exceptions),
                "gateway projection reports unsettled deposit exceptions" if deposit_exceptions > 0 else "deposit repair queue nominal",
            ),
            self._build_signal(
                "audit-alerts",
                "Audit alerts",
                "monitoring" if audit_alerts > 0 else "nominal",
                str(audit_alerts),
                "recent sensitive actions need operator review" if audit_alerts > 0 else "no recent audit alert escalation",
            ),
        ]

    @staticmethod
    def _build_action(action_id: str, label: str, href: str, detail: str, status: str) -> dict:
        return {
            "actionId": action_id,
            "label": label,
            "href": href,
            "detail": detail,
            "status": status,
        }

    @staticmethod
    def _resolve_execution_action_status(failed_job_count: int, pending_approvals: int) -> str:
        if failed_job_count > 0:
            return "degraded"
        if pending_approvals > 0:
            return "monitoring"
        return "nominal"

    def _build_diagnostic_actions(
        self,
        reconciliation_alert: bool,
        recent_gateway_failures: int,
        failed_job_count: int,
        pending_approvals: int,
        deposit_exceptions: int,
    ) -> list[dict]:
        system_status = "degraded" if reconciliation_alert or recent_gateway_failures > 0 else "nominal"
        execution_status = self._resolve_execution_action_status(failed_job_count, pending_approvals)
        finance_status = "monitoring" if deposit_exceptions > 0 else "nominal"
        return [
            self._build_action(
                "system-center",
                "Open system center",
                "/system",
                "inspect gateway, indexer, backfill, and reconciliation runtime state",
                system_status,
            ),
            self._build_action(
                "execution-queue",
                "Inspect execution queue",
                "/execution",
                "review failed or queued approval executions and retry when required",
                execution_status,
            ),
            self._build_action(
                "finance-desk",
                "Jump to finance desk",
                "/finance",
                "resolve deposit exceptions, withdrawal backlog, and liability exposure",
                finance_status,
            ),
        ]

    @staticmethod
    def _format_decimal(value) -> str:
        return f"{value:.2f}"

    @staticmethod
    def _format_timestamp(timestamp: datetime | None) -> str | None:
        if timestamp is None:
            return None
        return timestamp.isoformat().replace("+00:00", "Z")
