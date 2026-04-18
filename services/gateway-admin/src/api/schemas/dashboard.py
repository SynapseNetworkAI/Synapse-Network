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


class AnalyticsMetricCard(BaseModel):
    key: str
    label: str
    value: float | int | str
    unit: str
    tone: str
    detail: str


class AnalyticsAlert(BaseModel):
    severity: str
    title: str
    detail: str
    href: str | None = None


class AnalyticsOverview(BaseModel):
    window: str
    overall_status: str = Field(alias="overallStatus", serialization_alias="overallStatus")
    cards: list[AnalyticsMetricCard]
    alerts: list[AnalyticsAlert]


class AnalyticsFunnelStep(BaseModel):
    event_name: str = Field(alias="eventName", serialization_alias="eventName")
    label: str
    users: int
    events: int
    conversion_rate: float = Field(alias="conversionRate", serialization_alias="conversionRate")
    dropoff_rate: float = Field(alias="dropoffRate", serialization_alias="dropoffRate")


class AnalyticsConsumerFunnelSummary(BaseModel):
    activation_rate: float = Field(alias="activationRate", serialization_alias="activationRate")
    first_invoke_users: int = Field(alias="firstInvokeUsers", serialization_alias="firstInvokeUsers")
    quote_to_invoke_rate: float = Field(alias="quoteToInvokeRate", serialization_alias="quoteToInvokeRate")
    deposit_to_first_invoke_rate: float = Field(alias="depositToFirstInvokeRate", serialization_alias="depositToFirstInvokeRate")


class AnalyticsConsumerFunnel(BaseModel):
    window: str
    steps: list[AnalyticsFunnelStep]
    summary: AnalyticsConsumerFunnelSummary


class AnalyticsDistributionItem(BaseModel):
    key: str
    label: str
    count: int
    value: float
    rate: float = 0


class AnalyticsLatencyPercentiles(BaseModel):
    p50: float
    p95: float
    p99: float | None = None


class AnalyticsInvocationTrendPoint(BaseModel):
    bucket: str
    invoke_completed: int = Field(alias="invokeCompleted", serialization_alias="invokeCompleted")
    invoke_failed: int = Field(alias="invokeFailed", serialization_alias="invokeFailed")
    gmv_usdc: str = Field(alias="gmvUsdc", serialization_alias="gmvUsdc")
    platform_fee_usdc: str = Field(alias="platformFeeUsdc", serialization_alias="platformFeeUsdc")
    provider_net_usdc: str = Field(alias="providerNetUsdc", serialization_alias="providerNetUsdc")


class AnalyticsInvocationRevenue(BaseModel):
    window: str
    quote_count: int = Field(alias="quoteCount", serialization_alias="quoteCount")
    invoke_started_count: int = Field(alias="invokeStartedCount", serialization_alias="invokeStartedCount")
    invoke_completed_count: int = Field(alias="invokeCompletedCount", serialization_alias="invokeCompletedCount")
    invoke_failed_count: int = Field(alias="invokeFailedCount", serialization_alias="invokeFailedCount")
    success_rate: float = Field(alias="successRate", serialization_alias="successRate")
    gmv_usdc: str = Field(alias="gmvUsdc", serialization_alias="gmvUsdc")
    price_avg_usdc: str = Field(alias="priceAvgUsdc", serialization_alias="priceAvgUsdc")
    platform_fee_usdc: str = Field(alias="platformFeeUsdc", serialization_alias="platformFeeUsdc")
    provider_net_usdc: str = Field(alias="providerNetUsdc", serialization_alias="providerNetUsdc")
    latency_ms: AnalyticsLatencyPercentiles = Field(alias="latencyMs", serialization_alias="latencyMs")
    failure_stages: list[AnalyticsDistributionItem] = Field(alias="failureStages", serialization_alias="failureStages")
    error_codes: list[AnalyticsDistributionItem] = Field(alias="errorCodes", serialization_alias="errorCodes")
    trend: list[AnalyticsInvocationTrendPoint]


class AnalyticsProviderSettlementStep(BaseModel):
    event_name: str = Field(alias="eventName", serialization_alias="eventName")
    label: str
    count: int
    amount_usdc: str = Field(alias="amountUsdc", serialization_alias="amountUsdc")
    conversion_rate: float = Field(alias="conversionRate", serialization_alias="conversionRate")


class AnalyticsTopProvider(BaseModel):
    provider_id: str = Field(alias="providerId", serialization_alias="providerId")
    service_id: str = Field(alias="serviceId", serialization_alias="serviceId")
    gross_usdc: str = Field(alias="grossUsdc", serialization_alias="grossUsdc")
    provider_net_usdc: str = Field(alias="providerNetUsdc", serialization_alias="providerNetUsdc")
    invoke_count: int = Field(alias="invokeCount", serialization_alias="invokeCount")


class AnalyticsProviderRevenue(BaseModel):
    window: str
    revenue_provider_count: int = Field(alias="revenueProviderCount", serialization_alias="revenueProviderCount")
    first_revenue_provider_count: int = Field(alias="firstRevenueProviderCount", serialization_alias="firstRevenueProviderCount")
    avg_time_since_listing_ms: float = Field(alias="avgTimeSinceListingMs", serialization_alias="avgTimeSinceListingMs")
    provider_gross_usdc: str = Field(alias="providerGrossUsdc", serialization_alias="providerGrossUsdc")
    platform_fee_usdc: str = Field(alias="platformFeeUsdc", serialization_alias="platformFeeUsdc")
    provider_net_usdc: str = Field(alias="providerNetUsdc", serialization_alias="providerNetUsdc")
    pending_settlement_usdc: str = Field(alias="pendingSettlementUsdc", serialization_alias="pendingSettlementUsdc")
    settlement_completed_usdc: str = Field(alias="settlementCompletedUsdc", serialization_alias="settlementCompletedUsdc")
    settlement_failure_rate: float = Field(alias="settlementFailureRate", serialization_alias="settlementFailureRate")
    settlement_p95_confirm_ms: float = Field(alias="settlementP95ConfirmMs", serialization_alias="settlementP95ConfirmMs")
    settlement_funnel: list[AnalyticsProviderSettlementStep] = Field(alias="settlementFunnel", serialization_alias="settlementFunnel")
    top_providers: list[AnalyticsTopProvider] = Field(alias="topProviders", serialization_alias="topProviders")


class AnalyticsFinanceContext(BaseModel):
    pending_deposit_count: int = Field(default=0, alias="pendingDepositCount", serialization_alias="pendingDepositCount")
    pending_withdrawal_count: int = Field(default=0, alias="pendingWithdrawalCount", serialization_alias="pendingWithdrawalCount")
    vault_ledger_delta_usdc: str = Field(default="0.00", alias="vaultLedgerDeltaUsdc", serialization_alias="vaultLedgerDeltaUsdc")
    chain_confirmed_not_ledger_confirmed_count: int = Field(default=0, alias="chainConfirmedNotLedgerConfirmedCount", serialization_alias="chainConfirmedNotLedgerConfirmedCount")


class AnalyticsDepositFailureSample(BaseModel):
    timestamp: str
    error_code: str = Field(alias="errorCode", serialization_alias="errorCode")
    amount_usdc: str = Field(alias="amountUsdc", serialization_alias="amountUsdc")
    env: str
    correlation_id: str = Field(default="", alias="correlationId", serialization_alias="correlationId")
    tx_hash: str = Field(default="", alias="txHash", serialization_alias="txHash")


class AnalyticsMoneyFlow(BaseModel):
    window: str
    deposit_usdc: str = Field(alias="depositUsdc", serialization_alias="depositUsdc")
    deposit_failed_count: int = Field(alias="depositFailedCount", serialization_alias="depositFailedCount")
    withdrawal_usdc: str = Field(alias="withdrawalUsdc", serialization_alias="withdrawalUsdc")
    withdrawal_failed_count: int = Field(alias="withdrawalFailedCount", serialization_alias="withdrawalFailedCount")
    refund_usdc: str = Field(alias="refundUsdc", serialization_alias="refundUsdc")
    confirm_latency_ms: AnalyticsLatencyPercentiles = Field(alias="confirmLatencyMs", serialization_alias="confirmLatencyMs")
    deposit_errors: list[AnalyticsDistributionItem] = Field(alias="depositErrors", serialization_alias="depositErrors")
    deposit_failure_samples: list[AnalyticsDepositFailureSample] = Field(default_factory=list, alias="depositFailureSamples", serialization_alias="depositFailureSamples")
    withdrawal_errors: list[AnalyticsDistributionItem] = Field(alias="withdrawalErrors", serialization_alias="withdrawalErrors")
    finance_context: AnalyticsFinanceContext = Field(alias="financeContext", serialization_alias="financeContext")


class AnalyticsDegradedProvider(BaseModel):
    provider_id: str = Field(alias="providerId", serialization_alias="providerId")
    service_id: str = Field(alias="serviceId", serialization_alias="serviceId")
    count: int
    reason: str


class AnalyticsBudgetBlock(BaseModel):
    key: str
    error_code: str = Field(alias="errorCode", serialization_alias="errorCode")
    service_id: str = Field(alias="serviceId", serialization_alias="serviceId")
    surface: str
    count: int
    required_usdc: str = Field(alias="requiredUsdc", serialization_alias="requiredUsdc")
    available_usdc: str = Field(alias="availableUsdc", serialization_alias="availableUsdc")
    gap_usdc: str = Field(alias="gapUsdc", serialization_alias="gapUsdc")


class AnalyticsBudgetBlockSample(BaseModel):
    timestamp: str
    service_id: str = Field(alias="serviceId", serialization_alias="serviceId")
    error_code: str = Field(alias="errorCode", serialization_alias="errorCode")
    required_usdc: str = Field(alias="requiredUsdc", serialization_alias="requiredUsdc")
    available_usdc: str = Field(alias="availableUsdc", serialization_alias="availableUsdc")
    correlation_id: str = Field(default="", alias="correlationId", serialization_alias="correlationId")
    surface: str


class AnalyticsRiskHealth(BaseModel):
    window: str
    critical_risk_events: int = Field(alias="criticalRiskEvents", serialization_alias="criticalRiskEvents")
    risk_rules: list[AnalyticsDistributionItem] = Field(alias="riskRules", serialization_alias="riskRules")
    surfaces: list[AnalyticsDistributionItem]
    provider_health_degraded_count: int = Field(alias="providerHealthDegradedCount", serialization_alias="providerHealthDegradedCount")
    degraded_providers: list[AnalyticsDegradedProvider] = Field(alias="degradedProviders", serialization_alias="degradedProviders")
    budget_gap_usdc: str = Field(alias="budgetGapUsdc", serialization_alias="budgetGapUsdc")
    budget_blocks: list[AnalyticsBudgetBlock] = Field(default_factory=list, alias="budgetBlocks", serialization_alias="budgetBlocks")
    budget_block_samples: list[AnalyticsBudgetBlockSample] = Field(default_factory=list, alias="budgetBlockSamples", serialization_alias="budgetBlockSamples")
    refund_reasons: list[AnalyticsDistributionItem] = Field(alias="refundReasons", serialization_alias="refundReasons")


class AnalyticsCriticalEventFreshness(BaseModel):
    event_name: str = Field(alias="eventName", serialization_alias="eventName")
    seen: bool
    last_seen_at: str = Field(alias="lastSeenAt", serialization_alias="lastSeenAt")
    count: int


class AnalyticsSchemaIssueSample(BaseModel):
    event_name: str = Field(alias="eventName", serialization_alias="eventName")
    issue: str
    count: int


class AnalyticsDataQuality(BaseModel):
    window: str
    overall_status: str = Field(alias="overallStatus", serialization_alias="overallStatus")
    event_count: int = Field(alias="eventCount", serialization_alias="eventCount")
    duplicate_rate: float = Field(alias="duplicateRate", serialization_alias="duplicateRate")
    critical_events_freshness: list[AnalyticsCriticalEventFreshness] = Field(alias="criticalEventsFreshness", serialization_alias="criticalEventsFreshness")
    source_coverage: dict[str, int] = Field(alias="sourceCoverage", serialization_alias="sourceCoverage")
    privacy_violations: int = Field(alias="privacyViolations", serialization_alias="privacyViolations")
    missing_required_properties: int = Field(alias="missingRequiredProperties", serialization_alias="missingRequiredProperties")
    xor_violations: int = Field(alias="xorViolations", serialization_alias="xorViolations")
    kafka_lag: int = Field(alias="kafkaLag", serialization_alias="kafkaLag")
    clickhouse_lag: int = Field(alias="clickhouseLag", serialization_alias="clickhouseLag")
    file_backend_fallback_events: int = Field(alias="fileBackendFallbackEvents", serialization_alias="fileBackendFallbackEvents")
    schema_issue_samples: list[AnalyticsSchemaIssueSample] = Field(alias="schemaIssueSamples", serialization_alias="schemaIssueSamples")
