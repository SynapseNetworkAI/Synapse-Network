export function financeProjectionSql() {
  return `
    SELECT json_build_object(
      'todayChargeUsdc', today_charge_usdc::text,
      'todayDepositUsdc', today_deposit_usdc::text,
      'todayRefundUsdc', today_consumer_refund_usdc::text,
      'todayWithdrawalUsdc', today_provider_withdrawal_usdc::text,
      'todayInvocationCount', today_invocation_count,
      'todayPlatformFeeEarnedUsdc', today_platform_fee_earned_usdc::text,
      'todayProviderEarnedUsdc', today_provider_earned_usdc::text,
      'ownerLiabilityUsdc', consumer_liability_usdc::text,
      'refundableConsumerBalanceUsdc', refundable_consumer_balance_usdc::text,
      'providerPayableUsdc', provider_payable_usdc::text,
      'providerAvailableToWithdrawUsdc', provider_available_to_withdraw_usdc::text,
      'providerLockedBalanceUsdc', provider_locked_balance_usdc::text,
      'platformFeeBalanceUsdc', platform_fee_balance_usdc::text,
      'vaultLedgerDeltaUsdc', vault_ledger_delta_usdc::text,
      'pendingDepositCount', pending_deposit_count,
      'pendingWithdrawalCount', pending_provider_withdrawal_count,
      'projectedAt', projected_at
    )
    FROM synapse_admin_dashboard_finance_projection
    LIMIT 1
  `;
}

export function activityTrendProjectionSql() {
  return `
    SELECT COALESCE(json_agg(json_build_object(
      'bucketDate', bucket_date::text,
      'depositUsdc', deposit_usdc::text,
      'chargeUsdc', charge_usdc::text,
      'invocationCount', invocation_count,
      'platformFeeEarnedUsdc', platform_fee_earned_usdc::text,
      'providerEarnedUsdc', provider_earned_usdc::text,
      'refundUsdc', consumer_refund_usdc::text,
      'withdrawalUsdc', provider_withdrawal_usdc::text,
      'netFlowUsdc', net_flow_usdc::text
    ) ORDER BY bucket_date ASC), '[]'::json)
    FROM synapse_admin_dashboard_activity_trend_projection
  `;
}

export function operationsProjectionSql() {
  return `
    SELECT json_build_object(
      'gatewayStatus', gateway_status,
      'indexerRunning', indexer_running,
      'indexerLastProcessedAt', indexer_last_processed_at,
      'indexerLastHeartbeatAt', indexer_last_heartbeat_at,
      'indexerLastError', indexer_last_error,
      'indexerPollIntervalSec', indexer_poll_interval_sec,
      'backfillEnabled', backfill_enabled,
      'backfillLastScanAt', backfill_last_scan_at,
      'backfillLastScannedBlock', backfill_last_scanned_block,
      'backfillLastRecovered', backfill_last_recovered,
      'backfillLastError', backfill_last_error,
      'recentGatewayFailures', recent_gateway_failures,
      'failedDepositCount', failed_deposit_count,
      'recentAuditAlerts', recent_audit_alerts,
      'reconciliationEnabled', reconciliation_enabled,
      'lastReconciliationAt', last_reconciliation_at,
      'reconciliationAlert', reconciliation_alert,
      'reconciliationDeltaUsdc', reconciliation_delta_usdc::text,
      'reconciliationLastError', reconciliation_last_error,
      'projectedAt', projected_at
    )
    FROM synapse_admin_dashboard_operations_projection
    LIMIT 1
  `;
}

export function dashboardProjectionSql() {
  return `
    SELECT json_build_object(
      'depositExceptions', deposit_exceptions,
      'auditAlerts', audit_alerts,
      'vaultLedgerDelta', vault_ledger_delta_usdc::text,
      'gatewayStatus', gateway_status,
      'lastReconciliationAt', last_reconciliation_at,
      'projectedAt', projected_at
    )
    FROM synapse_admin_dashboard_projection
    LIMIT 1
  `;
}
