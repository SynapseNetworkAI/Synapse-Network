CREATE OR REPLACE VIEW synapse_admin_dashboard_finance_projection AS
WITH day_window AS (
    SELECT date_trunc('day', NOW()) AS day_start
),
reconciliation AS (
    SELECT
        COALESCE(NULLIF(payload->>'deltaUsdc', '')::numeric, 0) AS vault_ledger_delta_usdc,
        updated_at AS reconciliation_updated_at
    FROM synapse_runtime_state
    WHERE state_key = 'deposit_reconciliation_state'
),
balance_snapshot AS (
    SELECT
        COALESCE(SUM(ab.available_balance + ab.pending_balance) FILTER (WHERE la.account_kind = 'consumer_wallet'), 0) AS consumer_liability_usdc,
        COALESCE(SUM(ab.available_balance + ab.pending_balance) FILTER (WHERE la.account_kind = 'provider_wallet'), 0) AS provider_payable_usdc,
        COALESCE(SUM(ab.available_balance + ab.pending_balance) FILTER (WHERE la.account_kind = 'platform_revenue'), 0) AS platform_fee_balance_usdc,
        MAX(ab.updated_at) AS balances_updated_at
    FROM synapse_account_balances AS ab
    JOIN synapse_ledger_accounts AS la ON la.account_id = ab.account_id
),
deposit_window AS (
    SELECT
        COALESCE(SUM(amount_usdc) FILTER (
            WHERE created_at >= (SELECT day_start FROM day_window)
                AND upper(status) <> 'FAILED'
        ), 0) AS today_deposit_usdc,
        COUNT(*) FILTER (
            WHERE upper(status) = 'PENDING_CONFIRMATION'
        )::bigint AS pending_deposit_count,
        MAX(updated_at) AS deposits_updated_at
    FROM synapse_vault_deposits
),
consumer_refund_window AS (
    SELECT
        COALESCE(SUM(amount_usdc) FILTER (
            WHERE updated_at >= (SELECT day_start FROM day_window)
                AND upper(status) = 'CONFIRMED'
                AND withdrawal_kind = 'consumer_refund'
        ), 0) AS today_consumer_refund_usdc,
        COUNT(*) FILTER (
            WHERE upper(status) IN ('REQUESTED', 'SIGNED', 'BROADCASTED')
                AND withdrawal_kind = 'consumer_refund'
        )::bigint AS pending_consumer_refund_count,
        MAX(updated_at) AS consumer_refunds_updated_at
    FROM synapse_vault_withdrawals
),
provider_withdrawal_window AS (
    SELECT
        COALESCE(SUM(amount_usdc) FILTER (
            WHERE updated_at >= (SELECT day_start FROM day_window)
                AND upper(status) = 'CONFIRMED'
                AND withdrawal_kind = 'provider_withdrawal'
        ), 0) AS today_provider_withdrawal_usdc,
        COUNT(*) FILTER (
            WHERE upper(status) IN ('REQUESTED', 'SIGNED', 'BROADCASTED')
                AND withdrawal_kind = 'provider_withdrawal'
        )::bigint AS pending_provider_withdrawal_count,
        MAX(updated_at) AS provider_withdrawals_updated_at
    FROM synapse_vault_withdrawals
),
charge_window AS (
    SELECT
        COALESCE(SUM(charged_usdc) FILTER (
            WHERE created_at >= (SELECT day_start FROM day_window)
                AND status IN ('SUCCEEDED', 'SETTLED')
        ), 0) AS today_charge_usdc,
        MAX(updated_at) AS charge_updated_at
    FROM synapse_invocations
)
SELECT
    charge_window.today_charge_usdc::numeric(36, 6) AS today_charge_usdc,
    deposit_window.today_deposit_usdc::numeric(36, 6) AS today_deposit_usdc,
    consumer_refund_window.today_consumer_refund_usdc::numeric(36, 6) AS today_consumer_refund_usdc,
    provider_withdrawal_window.today_provider_withdrawal_usdc::numeric(36, 6) AS today_provider_withdrawal_usdc,
    balance_snapshot.consumer_liability_usdc::numeric(36, 6) AS consumer_liability_usdc,
    balance_snapshot.provider_payable_usdc::numeric(36, 6) AS provider_payable_usdc,
    balance_snapshot.platform_fee_balance_usdc::numeric(36, 6) AS platform_fee_balance_usdc,
    COALESCE(reconciliation.vault_ledger_delta_usdc, 0)::numeric(36, 6) AS vault_ledger_delta_usdc,
    deposit_window.pending_deposit_count,
    consumer_refund_window.pending_consumer_refund_count,
    provider_withdrawal_window.pending_provider_withdrawal_count,
    GREATEST(
        COALESCE(balance_snapshot.balances_updated_at, 'epoch'::timestamptz),
        COALESCE(deposit_window.deposits_updated_at, 'epoch'::timestamptz),
        COALESCE(consumer_refund_window.consumer_refunds_updated_at, 'epoch'::timestamptz),
        COALESCE(provider_withdrawal_window.provider_withdrawals_updated_at, 'epoch'::timestamptz),
        COALESCE(charge_window.charge_updated_at, 'epoch'::timestamptz),
        COALESCE(reconciliation.reconciliation_updated_at, 'epoch'::timestamptz)
    ) AS projected_at
FROM balance_snapshot
CROSS JOIN deposit_window
CROSS JOIN consumer_refund_window
CROSS JOIN provider_withdrawal_window
CROSS JOIN charge_window
LEFT JOIN reconciliation ON TRUE;

CREATE OR REPLACE VIEW synapse_admin_dashboard_activity_trend_projection AS
WITH day_series AS (
    SELECT generate_series(
        date_trunc('day', NOW()) - INTERVAL '6 day',
        date_trunc('day', NOW()),
        INTERVAL '1 day'
    )::date AS bucket_date
),
deposit_daily AS (
    SELECT
        created_at::date AS bucket_date,
        COALESCE(SUM(amount_usdc), 0) AS deposit_usdc
    FROM synapse_vault_deposits
    WHERE upper(status) <> 'FAILED'
    GROUP BY created_at::date
),
charge_daily AS (
    SELECT
        created_at::date AS bucket_date,
        COALESCE(SUM(charged_usdc), 0) AS charge_usdc
    FROM synapse_invocations
    WHERE status IN ('SUCCEEDED', 'SETTLED')
    GROUP BY created_at::date
),
consumer_refund_daily AS (
    SELECT
        updated_at::date AS bucket_date,
        COALESCE(SUM(amount_usdc), 0) AS consumer_refund_usdc
    FROM synapse_vault_withdrawals
    WHERE upper(status) = 'CONFIRMED'
        AND withdrawal_kind = 'consumer_refund'
    GROUP BY updated_at::date
),
provider_withdrawal_daily AS (
    SELECT
        updated_at::date AS bucket_date,
        COALESCE(SUM(amount_usdc), 0) AS provider_withdrawal_usdc
    FROM synapse_vault_withdrawals
    WHERE upper(status) = 'CONFIRMED'
        AND withdrawal_kind = 'provider_withdrawal'
    GROUP BY updated_at::date
)
SELECT
    day_series.bucket_date,
    COALESCE(deposit_daily.deposit_usdc, 0)::numeric(36, 6) AS deposit_usdc,
    COALESCE(charge_daily.charge_usdc, 0)::numeric(36, 6) AS charge_usdc,
    COALESCE(consumer_refund_daily.consumer_refund_usdc, 0)::numeric(36, 6) AS consumer_refund_usdc,
    COALESCE(provider_withdrawal_daily.provider_withdrawal_usdc, 0)::numeric(36, 6) AS provider_withdrawal_usdc,
    (
        COALESCE(deposit_daily.deposit_usdc, 0)
        - COALESCE(consumer_refund_daily.consumer_refund_usdc, 0)
        - COALESCE(provider_withdrawal_daily.provider_withdrawal_usdc, 0)
    )::numeric(36, 6) AS net_flow_usdc
FROM day_series
LEFT JOIN deposit_daily ON deposit_daily.bucket_date = day_series.bucket_date
LEFT JOIN charge_daily ON charge_daily.bucket_date = day_series.bucket_date
LEFT JOIN consumer_refund_daily ON consumer_refund_daily.bucket_date = day_series.bucket_date
LEFT JOIN provider_withdrawal_daily ON provider_withdrawal_daily.bucket_date = day_series.bucket_date
ORDER BY day_series.bucket_date ASC;

CREATE OR REPLACE VIEW synapse_admin_dashboard_operations_projection AS
WITH reconciliation AS (
    SELECT
        CASE
            WHEN NULLIF(payload->>'lastCheckAt', '') IS NOT NULL
                THEN to_timestamp((payload->>'lastCheckAt')::double precision)
            ELSE NULL
        END AS last_reconciliation_at,
        COALESCE(NULLIF(payload->>'deltaUsdc', '')::numeric, 0) AS reconciliation_delta_usdc,
        COALESCE(NULLIF(payload->>'alert', '')::boolean, FALSE) AS reconciliation_alert,
        NULLIF(payload->>'lastError', '') AS reconciliation_last_error,
        updated_at AS reconciliation_updated_at
    FROM synapse_runtime_state
    WHERE state_key = 'deposit_reconciliation_state'
),
runtime_projection AS (
    SELECT updated_at AS runtime_projection_updated_at
    FROM synapse_runtime_state
    WHERE state_key = 'agent_runtime_projection_state'
),
failed_deposits AS (
    SELECT
        COUNT(*)::bigint AS failed_deposit_count,
        MAX(updated_at) AS failed_deposits_updated_at
    FROM synapse_vault_deposits
    WHERE upper(status) = 'FAILED'
),
audit_window AS (
    SELECT
        COUNT(*) FILTER (
            WHERE lower(COALESCE(result_status, '')) IN ('failed', 'failure', 'alert', 'degraded')
                OR error_code IS NOT NULL
        )::bigint AS recent_audit_alerts,
        MAX(created_at) AS audit_updated_at
    FROM synapse_audit_events
    WHERE created_at >= NOW() - INTERVAL '24 hours'
),
system_window AS (
    SELECT
        COUNT(*) FILTER (
            WHERE lower(COALESCE(result_status, '')) IN ('failed', 'failure', 'error', 'degraded')
                OR error_code IS NOT NULL
        )::bigint AS recent_gateway_failures,
        MAX(created_at) AS system_updated_at
    FROM synapse_audit_events
    WHERE created_at >= NOW() - INTERVAL '30 minutes'
)
SELECT
    CASE
        WHEN COALESCE(reconciliation.reconciliation_alert, FALSE)
            OR COALESCE(system_window.recent_gateway_failures, 0) > 0
            OR reconciliation.reconciliation_last_error IS NOT NULL
        THEN 'degraded'
        ELSE 'healthy'
    END AS gateway_status,
    runtime_projection.runtime_projection_updated_at AS indexer_last_processed_at,
    runtime_projection.runtime_projection_updated_at AS backfill_last_scan_at,
    NULL::bigint AS backfill_last_scanned_block,
    COALESCE(system_window.recent_gateway_failures, 0) AS recent_gateway_failures,
    COALESCE(failed_deposits.failed_deposit_count, 0) AS failed_deposit_count,
    COALESCE(audit_window.recent_audit_alerts, 0) AS recent_audit_alerts,
    reconciliation.last_reconciliation_at,
    COALESCE(reconciliation.reconciliation_alert, FALSE) AS reconciliation_alert,
    COALESCE(reconciliation.reconciliation_delta_usdc, 0)::numeric(36, 6) AS reconciliation_delta_usdc,
    reconciliation.reconciliation_last_error,
    GREATEST(
        COALESCE(reconciliation.reconciliation_updated_at, 'epoch'::timestamptz),
        COALESCE(runtime_projection.runtime_projection_updated_at, 'epoch'::timestamptz),
        COALESCE(failed_deposits.failed_deposits_updated_at, 'epoch'::timestamptz),
        COALESCE(audit_window.audit_updated_at, 'epoch'::timestamptz),
        COALESCE(system_window.system_updated_at, 'epoch'::timestamptz)
    ) AS projected_at
FROM system_window
CROSS JOIN failed_deposits
CROSS JOIN audit_window
LEFT JOIN reconciliation ON TRUE
LEFT JOIN runtime_projection ON TRUE;

CREATE OR REPLACE VIEW synapse_admin_dashboard_projection AS
SELECT
    operations.failed_deposit_count AS deposit_exceptions,
    operations.recent_audit_alerts AS audit_alerts,
    finance.vault_ledger_delta_usdc,
    operations.gateway_status,
    operations.last_reconciliation_at,
    operations.reconciliation_alert,
    operations.reconciliation_last_error,
    GREATEST(finance.projected_at, operations.projected_at) AS projected_at
FROM synapse_admin_dashboard_finance_projection AS finance
CROSS JOIN synapse_admin_dashboard_operations_projection AS operations;

COMMENT ON VIEW synapse_admin_dashboard_finance_projection IS
'Stable admin finance snapshot derived from the target-state Owner / Agent / Provider runtime tables.';

COMMENT ON VIEW synapse_admin_dashboard_activity_trend_projection IS
'Stable admin daily activity trend projection derived from the target-state Owner / Agent / Provider runtime tables.';

COMMENT ON VIEW synapse_admin_dashboard_operations_projection IS
'Stable admin operations projection derived from runtime state and target-state audit events.';

COMMENT ON VIEW synapse_admin_dashboard_projection IS
'Target-state compatibility aggregation view built from the finance and operations projections.';
