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
        COALESCE(SUM(ab.available_balance + ab.pending_balance) FILTER (WHERE la.account_kind = 'owner_vault'), 0) AS buyer_liability_usdc,
        COALESCE(SUM(ab.available_balance + ab.pending_balance) FILTER (WHERE la.account_kind = 'seller_receivable'), 0) AS seller_payable_usdc,
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
withdrawal_window AS (
    SELECT
        COALESCE(SUM(amount_usdc) FILTER (
            WHERE updated_at >= (SELECT day_start FROM day_window)
                AND upper(status) = 'CONFIRMED'
        ), 0) AS today_withdrawal_usdc,
        COUNT(*) FILTER (
            WHERE upper(status) IN ('REQUESTED', 'SIGNED', 'BROADCASTED')
        )::bigint AS pending_withdrawal_count,
        MAX(updated_at) AS withdrawals_updated_at
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
    0::numeric(36, 6) AS today_refund_usdc,
    withdrawal_window.today_withdrawal_usdc::numeric(36, 6) AS today_withdrawal_usdc,
    balance_snapshot.buyer_liability_usdc::numeric(36, 6) AS buyer_liability_usdc,
    balance_snapshot.seller_payable_usdc::numeric(36, 6) AS seller_payable_usdc,
    balance_snapshot.platform_fee_balance_usdc::numeric(36, 6) AS platform_fee_balance_usdc,
    COALESCE(reconciliation.vault_ledger_delta_usdc, 0)::numeric(36, 6) AS vault_ledger_delta_usdc,
    deposit_window.pending_deposit_count,
    withdrawal_window.pending_withdrawal_count,
    GREATEST(
        COALESCE(balance_snapshot.balances_updated_at, 'epoch'::timestamptz),
        COALESCE(deposit_window.deposits_updated_at, 'epoch'::timestamptz),
        COALESCE(withdrawal_window.withdrawals_updated_at, 'epoch'::timestamptz),
        COALESCE(charge_window.charge_updated_at, 'epoch'::timestamptz),
        COALESCE(reconciliation.reconciliation_updated_at, 'epoch'::timestamptz)
    ) AS projected_at
FROM balance_snapshot
CROSS JOIN deposit_window
CROSS JOIN withdrawal_window
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
withdrawal_daily AS (
    SELECT
        updated_at::date AS bucket_date,
        COALESCE(SUM(amount_usdc), 0) AS withdrawal_usdc
    FROM synapse_vault_withdrawals
    WHERE upper(status) = 'CONFIRMED'
    GROUP BY updated_at::date
)
SELECT
    day_series.bucket_date,
    COALESCE(deposit_daily.deposit_usdc, 0)::numeric(36, 6) AS deposit_usdc,
    COALESCE(charge_daily.charge_usdc, 0)::numeric(36, 6) AS charge_usdc,
    0::numeric(36, 6) AS refund_usdc,
    COALESCE(withdrawal_daily.withdrawal_usdc, 0)::numeric(36, 6) AS withdrawal_usdc,
    (
        COALESCE(deposit_daily.deposit_usdc, 0)
        - COALESCE(withdrawal_daily.withdrawal_usdc, 0)
    )::numeric(36, 6) AS net_flow_usdc
FROM day_series
LEFT JOIN deposit_daily ON deposit_daily.bucket_date = day_series.bucket_date
LEFT JOIN charge_daily ON charge_daily.bucket_date = day_series.bucket_date
LEFT JOIN withdrawal_daily ON withdrawal_daily.bucket_date = day_series.bucket_date
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
'Stable admin finance snapshot derived from the build-for-agent runtime tables.';

COMMENT ON VIEW synapse_admin_dashboard_activity_trend_projection IS
'Stable admin daily activity trend projection derived from the build-for-agent runtime tables.';

COMMENT ON VIEW synapse_admin_dashboard_operations_projection IS
'Stable admin operations projection derived from runtime state and audit events.';

COMMENT ON VIEW synapse_admin_dashboard_projection IS
'Compatibility aggregation view built from the finance and operations projections.';CREATE OR REPLACE VIEW synapse_admin_dashboard_finance_projection AS
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
        COALESCE(SUM(available_balance + pending_balance) FILTER (WHERE account_type = 'buyer'), 0) AS buyer_liability_usdc,
        COALESCE(SUM(available_balance + pending_balance) FILTER (WHERE account_type = 'seller'), 0) AS seller_payable_usdc,
        COALESCE(SUM(available_balance + pending_balance) FILTER (WHERE account_type = 'platform_fee'), 0) AS platform_fee_balance_usdc,
        MAX(updated_at) AS balances_updated_at
    FROM synapse_balances
),
deposit_window AS (
    SELECT
        COALESCE(SUM(amount_usdc) FILTER (
            WHERE created_at >= (SELECT day_start FROM day_window)
                AND upper(status) <> 'FAILED'
        ), 0) AS today_deposit_usdc,
        COUNT(*) FILTER (
            WHERE upper(status) IN ('PENDING_CONFIRMATION', 'PENDING')
        )::bigint AS pending_deposit_count,
        MAX(updated_at) AS deposits_updated_at
    FROM synapse_deposit_intents
),
refund_window AS (
    SELECT
        COALESCE(SUM(amount_usdc) FILTER (
            WHERE updated_at >= (SELECT day_start FROM day_window)
                AND upper(status) = 'COMPLETED'
        ), 0) AS today_refund_usdc,
        MAX(updated_at) AS refunds_updated_at
    FROM synapse_refund_intents
),
withdrawal_window AS (
    SELECT
        COALESCE(SUM(amount_usdc) FILTER (
            WHERE updated_at >= (SELECT day_start FROM day_window)
                AND upper(status::text) = 'COMPLETED'
        ), 0) AS today_withdrawal_usdc,
        COUNT(*) FILTER (
            WHERE upper(status::text) IN ('REQUESTED', 'APPROVED_AUTO', 'PENDING_MANUAL_REVIEW')
        )::bigint AS pending_withdrawal_count,
        MAX(updated_at) AS withdrawals_updated_at
    FROM synapse_withdrawal_intents
),
charge_window AS (
    SELECT
        COALESCE(SUM(total_charge) FILTER (
            WHERE to_timestamp(ts / 1000.0) >= (SELECT day_start FROM day_window)
                AND business_type = 'charge'
                AND lower(COALESCE(status, '')) IN ('accepted', 'succeeded', 'success', 'completed')
        ), 0) AS today_charge_usdc,
        MAX(to_timestamp(ts / 1000.0)) AS charge_updated_at
    FROM synapse_usage_log
)
SELECT
    charge_window.today_charge_usdc::numeric(36, 6) AS today_charge_usdc,
    deposit_window.today_deposit_usdc::numeric(36, 6) AS today_deposit_usdc,
    refund_window.today_refund_usdc::numeric(36, 6) AS today_refund_usdc,
    withdrawal_window.today_withdrawal_usdc::numeric(36, 6) AS today_withdrawal_usdc,
    balance_snapshot.buyer_liability_usdc::numeric(36, 6) AS buyer_liability_usdc,
    balance_snapshot.seller_payable_usdc::numeric(36, 6) AS seller_payable_usdc,
    balance_snapshot.platform_fee_balance_usdc::numeric(36, 6) AS platform_fee_balance_usdc,
    COALESCE(reconciliation.vault_ledger_delta_usdc, 0)::numeric(36, 6) AS vault_ledger_delta_usdc,
    deposit_window.pending_deposit_count,
    withdrawal_window.pending_withdrawal_count,
    GREATEST(
        COALESCE(balance_snapshot.balances_updated_at, 'epoch'::timestamptz),
        COALESCE(deposit_window.deposits_updated_at, 'epoch'::timestamptz),
        COALESCE(refund_window.refunds_updated_at, 'epoch'::timestamptz),
        COALESCE(withdrawal_window.withdrawals_updated_at, 'epoch'::timestamptz),
        COALESCE(charge_window.charge_updated_at, 'epoch'::timestamptz),
        COALESCE(reconciliation.reconciliation_updated_at, 'epoch'::timestamptz)
    ) AS projected_at
FROM balance_snapshot
CROSS JOIN deposit_window
CROSS JOIN refund_window
CROSS JOIN withdrawal_window
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
    FROM synapse_deposit_intents
    WHERE upper(status) <> 'FAILED'
    GROUP BY created_at::date
),
charge_daily AS (
    SELECT
        to_timestamp(ts / 1000.0)::date AS bucket_date,
        COALESCE(SUM(total_charge), 0) AS charge_usdc
    FROM synapse_usage_log
    WHERE business_type = 'charge'
        AND lower(COALESCE(status, '')) IN ('accepted', 'succeeded', 'success', 'completed')
    GROUP BY to_timestamp(ts / 1000.0)::date
),
refund_daily AS (
    SELECT
        updated_at::date AS bucket_date,
        COALESCE(SUM(amount_usdc), 0) AS refund_usdc
    FROM synapse_refund_intents
    WHERE upper(status) = 'COMPLETED'
    GROUP BY updated_at::date
),
withdrawal_daily AS (
    SELECT
        updated_at::date AS bucket_date,
        COALESCE(SUM(amount_usdc), 0) AS withdrawal_usdc
    FROM synapse_withdrawal_intents
    WHERE upper(status::text) = 'COMPLETED'
    GROUP BY updated_at::date
)
SELECT
    day_series.bucket_date,
    COALESCE(deposit_daily.deposit_usdc, 0)::numeric(36, 6) AS deposit_usdc,
    COALESCE(charge_daily.charge_usdc, 0)::numeric(36, 6) AS charge_usdc,
    COALESCE(refund_daily.refund_usdc, 0)::numeric(36, 6) AS refund_usdc,
    COALESCE(withdrawal_daily.withdrawal_usdc, 0)::numeric(36, 6) AS withdrawal_usdc,
    (
        COALESCE(deposit_daily.deposit_usdc, 0)
        - COALESCE(refund_daily.refund_usdc, 0)
        - COALESCE(withdrawal_daily.withdrawal_usdc, 0)
    )::numeric(36, 6) AS net_flow_usdc
FROM day_series
LEFT JOIN deposit_daily ON deposit_daily.bucket_date = day_series.bucket_date
LEFT JOIN charge_daily ON charge_daily.bucket_date = day_series.bucket_date
LEFT JOIN refund_daily ON refund_daily.bucket_date = day_series.bucket_date
LEFT JOIN withdrawal_daily ON withdrawal_daily.bucket_date = day_series.bucket_date
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
backfill AS (
    SELECT
        CASE
            WHEN NULLIF(payload->>'lastScanAt', '') IS NOT NULL
                THEN to_timestamp((payload->>'lastScanAt')::double precision)
            ELSE NULL
        END AS backfill_last_scan_at,
        NULLIF(payload->>'lastScannedBlock', '')::bigint AS backfill_last_scanned_block,
        updated_at AS backfill_updated_at
    FROM synapse_runtime_state
    WHERE state_key = 'deposit_backfill_state'
),
failed_deposits AS (
    SELECT
        COUNT(*)::bigint AS failed_deposit_count,
        MAX(updated_at) AS failed_deposits_updated_at
    FROM synapse_deposit_intents
    WHERE upper(status) = 'FAILED'
),
audit_window AS (
    SELECT
        COUNT(*) FILTER (
            WHERE lower(COALESCE(result_status, '')) IN ('failed', 'failure', 'alert')
                OR error_code IS NOT NULL
        )::bigint AS recent_audit_alerts,
        MAX(created_at) AS audit_updated_at
    FROM synapse_audit_log
    WHERE created_at >= NOW() - INTERVAL '24 hours'
),
system_window AS (
    SELECT
        COUNT(*) FILTER (
            WHERE lower(COALESCE(result_status, '')) IN ('failed', 'failure', 'error', 'degraded')
                OR error_code IS NOT NULL
        )::bigint AS recent_gateway_failures,
        MAX(created_at) AS system_updated_at
    FROM synapse_system_activity_log
    WHERE created_at >= NOW() - INTERVAL '30 minutes'
),
processed_events AS (
    SELECT MAX(updated_at) AS indexer_last_processed_at
    FROM synapse_processed_deposit_events
)
SELECT
    CASE
        WHEN COALESCE(reconciliation.reconciliation_alert, FALSE)
            OR COALESCE(system_window.recent_gateway_failures, 0) > 0
            OR reconciliation.reconciliation_last_error IS NOT NULL
        THEN 'degraded'
        ELSE 'healthy'
    END AS gateway_status,
    processed_events.indexer_last_processed_at,
    backfill.backfill_last_scan_at,
    backfill.backfill_last_scanned_block,
    COALESCE(system_window.recent_gateway_failures, 0) AS recent_gateway_failures,
    COALESCE(failed_deposits.failed_deposit_count, 0) AS failed_deposit_count,
    COALESCE(audit_window.recent_audit_alerts, 0) AS recent_audit_alerts,
    reconciliation.last_reconciliation_at,
    COALESCE(reconciliation.reconciliation_alert, FALSE) AS reconciliation_alert,
    COALESCE(reconciliation.reconciliation_delta_usdc, 0)::numeric(36, 6) AS reconciliation_delta_usdc,
    reconciliation.reconciliation_last_error,
    GREATEST(
        COALESCE(reconciliation.reconciliation_updated_at, 'epoch'::timestamptz),
        COALESCE(backfill.backfill_updated_at, 'epoch'::timestamptz),
        COALESCE(failed_deposits.failed_deposits_updated_at, 'epoch'::timestamptz),
        COALESCE(audit_window.audit_updated_at, 'epoch'::timestamptz),
        COALESCE(system_window.system_updated_at, 'epoch'::timestamptz),
        COALESCE(processed_events.indexer_last_processed_at, 'epoch'::timestamptz)
    ) AS projected_at
FROM processed_events
CROSS JOIN system_window
CROSS JOIN failed_deposits
CROSS JOIN audit_window
LEFT JOIN reconciliation ON TRUE
LEFT JOIN backfill ON TRUE;

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
'Stable admin finance snapshot derived from gateway truth tables.';

COMMENT ON VIEW synapse_admin_dashboard_activity_trend_projection IS
'Stable admin daily activity trend projection derived from gateway truth tables.';

COMMENT ON VIEW synapse_admin_dashboard_operations_projection IS
'Stable admin operations projection derived from gateway runtime state and system logs.';

COMMENT ON VIEW synapse_admin_dashboard_projection IS
'Compatibility aggregation view built from the finance and operations projections.';

COMMENT ON COLUMN synapse_admin_dashboard_projection.deposit_exceptions IS
'Count of failed gateway deposit intents.';

COMMENT ON COLUMN synapse_admin_dashboard_projection.audit_alerts IS
'Count of gateway audit alerts or failures within the last 24 hours.';

COMMENT ON COLUMN synapse_admin_dashboard_projection.vault_ledger_delta_usdc IS
'Latest deposit reconciliation delta between chain vault balance and ledger obligation.';

COMMENT ON COLUMN synapse_admin_dashboard_projection.gateway_status IS
'Gateway health summary derived from reconciliation and recent system failures.';

COMMENT ON COLUMN synapse_admin_dashboard_projection.last_reconciliation_at IS
'Timestamp of the latest deposit reconciliation check.';

COMMENT ON COLUMN synapse_admin_dashboard_projection.reconciliation_alert IS
'Whether the latest reconciliation result is in alert state.';

COMMENT ON COLUMN synapse_admin_dashboard_projection.reconciliation_last_error IS
'Last reconciliation error code if the latest check failed.';

COMMENT ON COLUMN synapse_admin_dashboard_projection.projected_at IS
'Projection freshness timestamp.';