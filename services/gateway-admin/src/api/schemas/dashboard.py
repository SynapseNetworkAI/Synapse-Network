from pydantic import BaseModel, Field

from src.api.schemas.approval import ApprovalSummary
from src.api.schemas.provider_withdraw_review import ProviderWithdrawReviewSummary


class HighlightCard(BaseModel):
    title: str
    value: str
    trend: str


class OverviewMetrics(BaseModel):
    pending_approvals: int = Field(alias="pendingApprovals", serialization_alias="pendingApprovals")
    deposit_exceptions: int = Field(alias="depositExceptions", serialization_alias="depositExceptions")
    audit_alerts: int = Field(alias="auditAlerts", serialization_alias="auditAlerts")
    vault_ledger_delta: str = Field(alias="vaultLedgerDelta", serialization_alias="vaultLedgerDelta")


class DashboardOverview(BaseModel):
    metrics: OverviewMetrics
    highlights: list[HighlightCard]


class FinanceOverview(BaseModel):
    today_charge_usdc: str = Field(alias="todayChargeUsdc", serialization_alias="todayChargeUsdc")
    today_deposit_usdc: str = Field(alias="todayDepositUsdc", serialization_alias="todayDepositUsdc")
    today_refund_usdc: str = Field(alias="todayRefundUsdc", serialization_alias="todayRefundUsdc")
    today_withdrawal_usdc: str = Field(alias="todayWithdrawalUsdc", serialization_alias="todayWithdrawalUsdc")
    today_invocation_count: int = Field(alias="todayInvocationCount", serialization_alias="todayInvocationCount")
    today_platform_fee_earned_usdc: str = Field(alias="todayPlatformFeeEarnedUsdc", serialization_alias="todayPlatformFeeEarnedUsdc")
    today_provider_earned_usdc: str = Field(alias="todayProviderEarnedUsdc", serialization_alias="todayProviderEarnedUsdc")
    owner_liability_usdc: str = Field(alias="ownerLiabilityUsdc", serialization_alias="ownerLiabilityUsdc")
    refundable_consumer_balance_usdc: str = Field(alias="refundableConsumerBalanceUsdc", serialization_alias="refundableConsumerBalanceUsdc")
    provider_payable_usdc: str = Field(alias="providerPayableUsdc", serialization_alias="providerPayableUsdc")
    provider_available_to_withdraw_usdc: str = Field(alias="providerAvailableToWithdrawUsdc", serialization_alias="providerAvailableToWithdrawUsdc")
    provider_locked_balance_usdc: str = Field(alias="providerLockedBalanceUsdc", serialization_alias="providerLockedBalanceUsdc")
    platform_fee_balance_usdc: str = Field(alias="platformFeeBalanceUsdc", serialization_alias="platformFeeBalanceUsdc")
    vault_ledger_delta_usdc: str = Field(alias="vaultLedgerDeltaUsdc", serialization_alias="vaultLedgerDeltaUsdc")
    pending_deposit_count: int = Field(alias="pendingDepositCount", serialization_alias="pendingDepositCount")
    pending_withdrawal_count: int = Field(alias="pendingWithdrawalCount", serialization_alias="pendingWithdrawalCount")
    projected_at: str | None = Field(alias="projectedAt", serialization_alias="projectedAt")


class ActivityTrendPoint(BaseModel):
    bucket_date: str = Field(alias="bucketDate", serialization_alias="bucketDate")
    deposit_usdc: str = Field(alias="depositUsdc", serialization_alias="depositUsdc")
    charge_usdc: str = Field(alias="chargeUsdc", serialization_alias="chargeUsdc")
    invocation_count: int = Field(alias="invocationCount", serialization_alias="invocationCount")
    platform_fee_earned_usdc: str = Field(alias="platformFeeEarnedUsdc", serialization_alias="platformFeeEarnedUsdc")
    provider_earned_usdc: str = Field(alias="providerEarnedUsdc", serialization_alias="providerEarnedUsdc")
    refund_usdc: str = Field(alias="refundUsdc", serialization_alias="refundUsdc")
    withdrawal_usdc: str = Field(alias="withdrawalUsdc", serialization_alias="withdrawalUsdc")
    net_flow_usdc: str = Field(alias="netFlowUsdc", serialization_alias="netFlowUsdc")


class ActivityTrendSeries(BaseModel):
    points: list[ActivityTrendPoint]


class OperationsOverview(BaseModel):
    gateway_status: str = Field(alias="gatewayStatus", serialization_alias="gatewayStatus")
    indexer_running: bool = Field(alias="indexerRunning", serialization_alias="indexerRunning")
    indexer_status: str = Field(alias="indexerStatus", serialization_alias="indexerStatus")
    indexer_last_processed_at: str | None = Field(alias="indexerLastProcessedAt", serialization_alias="indexerLastProcessedAt")
    indexer_last_heartbeat_at: str | None = Field(alias="indexerLastHeartbeatAt", serialization_alias="indexerLastHeartbeatAt")
    indexer_last_error: str | None = Field(alias="indexerLastError", serialization_alias="indexerLastError")
    indexer_poll_interval_sec: int = Field(alias="indexerPollIntervalSec", serialization_alias="indexerPollIntervalSec")
    backfill_enabled: bool = Field(alias="backfillEnabled", serialization_alias="backfillEnabled")
    backfill_status: str = Field(alias="backfillStatus", serialization_alias="backfillStatus")
    backfill_last_scan_at: str | None = Field(alias="backfillLastScanAt", serialization_alias="backfillLastScanAt")
    backfill_last_scanned_block: int | None = Field(alias="backfillLastScannedBlock", serialization_alias="backfillLastScannedBlock")
    backfill_last_recovered: int = Field(alias="backfillLastRecovered", serialization_alias="backfillLastRecovered")
    backfill_last_error: str | None = Field(alias="backfillLastError", serialization_alias="backfillLastError")
    recent_gateway_failures: int = Field(alias="recentGatewayFailures", serialization_alias="recentGatewayFailures")
    failed_deposit_count: int = Field(alias="failedDepositCount", serialization_alias="failedDepositCount")
    recent_audit_alerts: int = Field(alias="recentAuditAlerts", serialization_alias="recentAuditAlerts")
    reconciliation_enabled: bool = Field(alias="reconciliationEnabled", serialization_alias="reconciliationEnabled")
    reconciliation_status: str = Field(alias="reconciliationStatus", serialization_alias="reconciliationStatus")
    last_reconciliation_at: str | None = Field(alias="lastReconciliationAt", serialization_alias="lastReconciliationAt")
    reconciliation_alert: bool = Field(alias="reconciliationAlert", serialization_alias="reconciliationAlert")
    reconciliation_delta_usdc: str = Field(alias="reconciliationDeltaUsdc", serialization_alias="reconciliationDeltaUsdc")
    reconciliation_last_error: str | None = Field(alias="reconciliationLastError", serialization_alias="reconciliationLastError")
    projected_at: str | None = Field(alias="projectedAt", serialization_alias="projectedAt")


class ReconciliationDetail(BaseModel):
    gateway_status: str = Field(alias="gatewayStatus", serialization_alias="gatewayStatus")
    reconciliation_alert: bool = Field(alias="reconciliationAlert", serialization_alias="reconciliationAlert")
    reconciliation_delta_usdc: str = Field(alias="reconciliationDeltaUsdc", serialization_alias="reconciliationDeltaUsdc")
    signed_difference_usdc: str | None = Field(alias="signedDifferenceUsdc", serialization_alias="signedDifferenceUsdc")
    imbalance_direction: str = Field(alias="imbalanceDirection", serialization_alias="imbalanceDirection")
    chain_vault_usdc: str | None = Field(alias="chainVaultUsdc", serialization_alias="chainVaultUsdc")
    ledger_obligation_usdc: str | None = Field(alias="ledgerObligationUsdc", serialization_alias="ledgerObligationUsdc")
    last_reconciliation_at: str | None = Field(alias="lastReconciliationAt", serialization_alias="lastReconciliationAt")
    runtime_state_updated_at: str | None = Field(alias="runtimeStateUpdatedAt", serialization_alias="runtimeStateUpdatedAt")
    reconciliation_last_error: str | None = Field(alias="reconciliationLastError", serialization_alias="reconciliationLastError")
    pending_approvals: int = Field(alias="pendingApprovals", serialization_alias="pendingApprovals")
    deposit_exceptions: int = Field(alias="depositExceptions", serialization_alias="depositExceptions")
    audit_alerts: int = Field(alias="auditAlerts", serialization_alias="auditAlerts")
    pending_deposit_count: int = Field(alias="pendingDepositCount", serialization_alias="pendingDepositCount")
    pending_withdrawal_count: int = Field(alias="pendingWithdrawalCount", serialization_alias="pendingWithdrawalCount")
    today_refund_usdc: str = Field(alias="todayRefundUsdc", serialization_alias="todayRefundUsdc")
    today_withdrawal_usdc: str = Field(alias="todayWithdrawalUsdc", serialization_alias="todayWithdrawalUsdc")
    owner_liability_usdc: str = Field(alias="ownerLiabilityUsdc", serialization_alias="ownerLiabilityUsdc")
    provider_payable_usdc: str = Field(alias="providerPayableUsdc", serialization_alias="providerPayableUsdc")
    platform_fee_balance_usdc: str = Field(alias="platformFeeBalanceUsdc", serialization_alias="platformFeeBalanceUsdc")
    chain_confirmed_not_ledger_confirmed_count: int = Field(alias="chainConfirmedNotLedgerConfirmedCount", serialization_alias="chainConfirmedNotLedgerConfirmedCount")
    deposit_p95_sync_delay_seconds: int = Field(alias="depositP95SyncDelaySeconds", serialization_alias="depositP95SyncDelaySeconds")
    recently_completed_outflows_usdc: str = Field(alias="recentlyCompletedOutflowsUsdc", serialization_alias="recentlyCompletedOutflowsUsdc")
    projected_at: str | None = Field(alias="projectedAt", serialization_alias="projectedAt")
    priority_approvals: list["ReconciliationApprovalSummary"] = Field(alias="priorityApprovals", serialization_alias="priorityApprovals")
    deposit_repair_approvals: list["ReconciliationApprovalSummary"] = Field(alias="depositRepairApprovals", serialization_alias="depositRepairApprovals")
    pending_withdrawal_reviews: list[ProviderWithdrawReviewSummary] = Field(alias="pendingWithdrawalReviews", serialization_alias="pendingWithdrawalReviews")


class ReconciliationApprovalSummary(ApprovalSummary):
    owner_address: str | None = Field(default=None, alias="ownerAddress", serialization_alias="ownerAddress")
    request_id: str | None = Field(default=None, alias="requestId", serialization_alias="requestId")
    tx_hash: str | None = Field(default=None, alias="txHash", serialization_alias="txHash")


class ReconciliationDrilldownResult(BaseModel):
    owner_address: str | None = Field(default=None, alias="ownerAddress", serialization_alias="ownerAddress")
    request_id: str | None = Field(default=None, alias="requestId", serialization_alias="requestId")
    tx_hash: str | None = Field(default=None, alias="txHash", serialization_alias="txHash")
    priority_approvals: list[ReconciliationApprovalSummary] = Field(alias="priorityApprovals", serialization_alias="priorityApprovals")
    deposit_repair_approvals: list[ReconciliationApprovalSummary] = Field(alias="depositRepairApprovals", serialization_alias="depositRepairApprovals")
    pending_withdrawal_reviews: list[ProviderWithdrawReviewSummary] = Field(alias="pendingWithdrawalReviews", serialization_alias="pendingWithdrawalReviews")


class SystemStatus(BaseModel):
    gateway_admin: str = Field(alias="gatewayAdmin", serialization_alias="gatewayAdmin")
    gateway: str
    approval_queue_depth: int = Field(alias="approvalQueueDepth", serialization_alias="approvalQueueDepth")
    last_reconciliation_at: str | None = Field(alias="lastReconciliationAt", serialization_alias="lastReconciliationAt")


class DiagnosticSignal(BaseModel):
    signal_id: str = Field(alias="signalId", serialization_alias="signalId")
    label: str
    status: str
    value: str
    detail: str


class DiagnosticAction(BaseModel):
    action_id: str = Field(alias="actionId", serialization_alias="actionId")
    label: str
    href: str
    detail: str
    status: str


class DashboardDiagnostics(BaseModel):
    overall_status: str = Field(alias="overallStatus", serialization_alias="overallStatus")
    checked_at: str = Field(alias="checkedAt", serialization_alias="checkedAt")
    summary: str
    signals: list[DiagnosticSignal]
    actions: list[DiagnosticAction]
