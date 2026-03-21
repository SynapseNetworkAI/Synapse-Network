from datetime import datetime, timezone

from src.domain.enums import ExecutionJobStatus
from src.storage.analytics import GatewayDashboardProjectionRepository
from src.storage.base import AdminStore


class DashboardService:
    def __init__(self, store: AdminStore, gateway_projection: GatewayDashboardProjectionRepository) -> None:
        self._store = store
        self._gateway_projection = gateway_projection

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
            "ownerLiabilityUsdc": self._format_decimal(snapshot.consumer_liability_usdc),
            "providerPayableUsdc": self._format_decimal(snapshot.provider_payable_usdc),
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
