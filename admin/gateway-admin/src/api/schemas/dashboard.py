from pydantic import BaseModel, Field


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
    buyer_liability_usdc: str = Field(alias="buyerLiabilityUsdc", serialization_alias="buyerLiabilityUsdc")
    seller_payable_usdc: str = Field(alias="sellerPayableUsdc", serialization_alias="sellerPayableUsdc")
    platform_fee_balance_usdc: str = Field(alias="platformFeeBalanceUsdc", serialization_alias="platformFeeBalanceUsdc")
    vault_ledger_delta_usdc: str = Field(alias="vaultLedgerDeltaUsdc", serialization_alias="vaultLedgerDeltaUsdc")
    pending_deposit_count: int = Field(alias="pendingDepositCount", serialization_alias="pendingDepositCount")
    pending_withdrawal_count: int = Field(alias="pendingWithdrawalCount", serialization_alias="pendingWithdrawalCount")
    projected_at: str | None = Field(alias="projectedAt", serialization_alias="projectedAt")


class ActivityTrendPoint(BaseModel):
    bucket_date: str = Field(alias="bucketDate", serialization_alias="bucketDate")
    deposit_usdc: str = Field(alias="depositUsdc", serialization_alias="depositUsdc")
    charge_usdc: str = Field(alias="chargeUsdc", serialization_alias="chargeUsdc")
    refund_usdc: str = Field(alias="refundUsdc", serialization_alias="refundUsdc")
    withdrawal_usdc: str = Field(alias="withdrawalUsdc", serialization_alias="withdrawalUsdc")
    net_flow_usdc: str = Field(alias="netFlowUsdc", serialization_alias="netFlowUsdc")


class ActivityTrendSeries(BaseModel):
    points: list[ActivityTrendPoint]


class OperationsOverview(BaseModel):
    gateway_status: str = Field(alias="gatewayStatus", serialization_alias="gatewayStatus")
    indexer_last_processed_at: str | None = Field(alias="indexerLastProcessedAt", serialization_alias="indexerLastProcessedAt")
    backfill_last_scan_at: str | None = Field(alias="backfillLastScanAt", serialization_alias="backfillLastScanAt")
    backfill_last_scanned_block: int | None = Field(alias="backfillLastScannedBlock", serialization_alias="backfillLastScannedBlock")
    recent_gateway_failures: int = Field(alias="recentGatewayFailures", serialization_alias="recentGatewayFailures")
    failed_deposit_count: int = Field(alias="failedDepositCount", serialization_alias="failedDepositCount")
    recent_audit_alerts: int = Field(alias="recentAuditAlerts", serialization_alias="recentAuditAlerts")
    last_reconciliation_at: str | None = Field(alias="lastReconciliationAt", serialization_alias="lastReconciliationAt")
    reconciliation_alert: bool = Field(alias="reconciliationAlert", serialization_alias="reconciliationAlert")
    reconciliation_delta_usdc: str = Field(alias="reconciliationDeltaUsdc", serialization_alias="reconciliationDeltaUsdc")
    reconciliation_last_error: str | None = Field(alias="reconciliationLastError", serialization_alias="reconciliationLastError")
    projected_at: str | None = Field(alias="projectedAt", serialization_alias="projectedAt")


class SystemStatus(BaseModel):
    gateway_admin: str = Field(alias="gatewayAdmin", serialization_alias="gatewayAdmin")
    gateway: str
    approval_queue_depth: int = Field(alias="approvalQueueDepth", serialization_alias="approvalQueueDepth")
    last_reconciliation_at: str | None = Field(alias="lastReconciliationAt", serialization_alias="lastReconciliationAt")
