from datetime import datetime

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

    @staticmethod
    def _format_decimal(value) -> str:
        return f"{value:.2f}"

    @staticmethod
    def _format_timestamp(timestamp: datetime | None) -> str | None:
        if timestamp is None:
            return None
        return timestamp.isoformat().replace("+00:00", "Z")
