\if :{?synapse_gateway_db}
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
        COALESCE(SUM(ab.available_balance) FILTER (WHERE la.account_kind = 'consumer_wallet'), 0) AS refundable_consumer_balance_usdc,
        COALESCE(SUM(ab.available_balance + ab.pending_balance) FILTER (WHERE la.account_kind = 'provider_wallet'), 0) AS provider_payable_usdc,
        COALESCE(SUM(ab.available_balance) FILTER (WHERE la.account_kind = 'provider_wallet'), 0) AS provider_available_to_withdraw_usdc,
        COALESCE(SUM(ab.pending_balance + ab.frozen_balance) FILTER (WHERE la.account_kind = 'provider_wallet'), 0) AS provider_locked_balance_usdc,
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
                AND upper(status) IN ('COMPLETED', 'CONFIRMED')
                AND withdrawal_kind = 'consumer_refund'
        ), 0) AS today_consumer_refund_usdc,
        COUNT(*) FILTER (
            WHERE upper(status) IN ('REQUESTED', 'SIGNED', 'APPROVED_AUTO', 'PENDING_MANUAL_REVIEW', 'BROADCASTED', 'PENDING')
                AND withdrawal_kind = 'consumer_refund'
        )::bigint AS pending_consumer_refund_count,
        MAX(updated_at) AS consumer_refunds_updated_at
    FROM synapse_vault_withdrawals
),
provider_withdrawal_window AS (
    SELECT
        COALESCE(SUM(amount_usdc) FILTER (
            WHERE updated_at >= (SELECT day_start FROM day_window)
                AND upper(status) IN ('COMPLETED', 'CONFIRMED')
                AND withdrawal_kind = 'provider_withdrawal'
        ), 0) AS today_provider_withdrawal_usdc,
        COUNT(*) FILTER (
            WHERE upper(status) IN ('REQUESTED', 'SIGNED', 'APPROVED_AUTO', 'PENDING_MANUAL_REVIEW', 'BROADCASTED', 'PENDING')
                AND withdrawal_kind = 'provider_withdrawal'
        )::bigint AS pending_provider_withdrawal_count,
        MAX(updated_at) AS provider_withdrawals_updated_at
    FROM synapse_vault_withdrawals
),
receipt_confirmed_attempts AS (
    SELECT
        lower(tx_hash) AS tx_hash,
        MAX(updated_at) AS receipt_confirmed_at
    FROM synapse_deposit_attempts
    WHERE stage = 'RECEIPT_CONFIRMED'
        AND tx_hash IS NOT NULL
        AND tx_hash <> ''
    GROUP BY lower(tx_hash)
),
ledger_confirmed_deposits AS (
    SELECT
        lower(tx_hash) AS tx_hash,
        MAX(updated_at) AS ledger_confirmed_at
    FROM synapse_vault_deposits
    WHERE upper(status) = 'CONFIRMED'
    GROUP BY lower(tx_hash)
),
deposit_sync_evidence AS (
    SELECT
        COUNT(*) FILTER (
            WHERE ledger_confirmed_deposits.ledger_confirmed_at IS NULL
                OR ledger_confirmed_deposits.ledger_confirmed_at < receipt_confirmed_attempts.receipt_confirmed_at
        )::bigint AS chain_confirmed_not_ledger_confirmed_count,
        COALESCE(
            ROUND(
                percentile_cont(0.95) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (ledger_confirmed_deposits.ledger_confirmed_at - receipt_confirmed_attempts.receipt_confirmed_at))
                )
            ),
            0
        )::bigint AS deposit_p95_sync_delay_seconds,
        GREATEST(
            COALESCE(MAX(receipt_confirmed_attempts.receipt_confirmed_at), 'epoch'::timestamptz),
            COALESCE(MAX(ledger_confirmed_deposits.ledger_confirmed_at), 'epoch'::timestamptz)
        ) AS deposit_sync_updated_at
    FROM receipt_confirmed_attempts
    LEFT JOIN ledger_confirmed_deposits
        ON ledger_confirmed_deposits.tx_hash = receipt_confirmed_attempts.tx_hash
),
recent_completed_outflow_window AS (
    SELECT
        COALESCE(SUM(amount_usdc) FILTER (
            WHERE updated_at >= NOW() - INTERVAL '6 hours'
                AND upper(status) IN ('COMPLETED', 'CONFIRMED')
                AND withdrawal_kind IN ('consumer_refund', 'provider_withdrawal')
        ), 0) AS recently_completed_outflows_usdc,
        MAX(updated_at) AS recent_completed_outflows_updated_at
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
),
invocation_billing_window AS (
    SELECT
        COUNT(*) FILTER (
            WHERE inv.created_at >= (SELECT day_start FROM day_window)
                AND inv.status IN ('SUCCEEDED', 'SETTLED')
                AND lower(COALESCE(NULLIF(billing.payload->>'businessType', ''), 'charge')) = 'charge'
        )::bigint AS today_invocation_count,
        COALESCE(SUM(
            COALESCE(NULLIF(billing.payload->>'protocolFee', '')::numeric, 0)
            + COALESCE(NULLIF(billing.payload->>'routingTax', '')::numeric, 0)
        ) FILTER (
            WHERE inv.created_at >= (SELECT day_start FROM day_window)
                AND inv.status IN ('SUCCEEDED', 'SETTLED')
                AND lower(COALESCE(NULLIF(billing.payload->>'businessType', ''), 'charge')) = 'charge'
        ), 0) AS today_platform_fee_earned_usdc,
        COALESCE(SUM(
            GREATEST(
                COALESCE(NULLIF(billing.payload->>'unitPrice', '')::numeric, 0)
                - COALESCE(NULLIF(billing.payload->>'protocolFee', '')::numeric, 0),
                0
            )
        ) FILTER (
            WHERE inv.created_at >= (SELECT day_start FROM day_window)
                AND inv.status IN ('SUCCEEDED', 'SETTLED')
                AND lower(COALESCE(NULLIF(billing.payload->>'businessType', ''), 'charge')) = 'charge'
        ), 0) AS today_provider_earned_usdc,
        MAX(GREATEST(inv.updated_at, COALESCE(billing.updated_at, inv.updated_at))) AS invocation_billing_updated_at
    FROM synapse_invocations AS inv
    LEFT JOIN synapse_runtime_state AS billing
        ON billing.state_key = 'invocation_billing::' || inv.invocation_id
)
SELECT
    charge_window.today_charge_usdc::numeric(36, 6) AS today_charge_usdc,
    deposit_window.today_deposit_usdc::numeric(36, 6) AS today_deposit_usdc,
    consumer_refund_window.today_consumer_refund_usdc::numeric(36, 6) AS today_consumer_refund_usdc,
    provider_withdrawal_window.today_provider_withdrawal_usdc::numeric(36, 6) AS today_provider_withdrawal_usdc,
    invocation_billing_window.today_invocation_count,
    invocation_billing_window.today_platform_fee_earned_usdc::numeric(36, 6) AS today_platform_fee_earned_usdc,
    invocation_billing_window.today_provider_earned_usdc::numeric(36, 6) AS today_provider_earned_usdc,
    balance_snapshot.consumer_liability_usdc::numeric(36, 6) AS consumer_liability_usdc,
    balance_snapshot.refundable_consumer_balance_usdc::numeric(36, 6) AS refundable_consumer_balance_usdc,
    balance_snapshot.provider_payable_usdc::numeric(36, 6) AS provider_payable_usdc,
    balance_snapshot.provider_available_to_withdraw_usdc::numeric(36, 6) AS provider_available_to_withdraw_usdc,
    balance_snapshot.provider_locked_balance_usdc::numeric(36, 6) AS provider_locked_balance_usdc,
    balance_snapshot.platform_fee_balance_usdc::numeric(36, 6) AS platform_fee_balance_usdc,
    COALESCE(reconciliation.vault_ledger_delta_usdc, 0)::numeric(36, 6) AS vault_ledger_delta_usdc,
    deposit_window.pending_deposit_count,
    consumer_refund_window.pending_consumer_refund_count,
    provider_withdrawal_window.pending_provider_withdrawal_count,
    deposit_sync_evidence.chain_confirmed_not_ledger_confirmed_count,
    deposit_sync_evidence.deposit_p95_sync_delay_seconds,
    recent_completed_outflow_window.recently_completed_outflows_usdc::numeric(36, 6) AS recently_completed_outflows_usdc,
    GREATEST(
        COALESCE(balance_snapshot.balances_updated_at, 'epoch'::timestamptz),
        COALESCE(deposit_window.deposits_updated_at, 'epoch'::timestamptz),
        COALESCE(consumer_refund_window.consumer_refunds_updated_at, 'epoch'::timestamptz),
        COALESCE(provider_withdrawal_window.provider_withdrawals_updated_at, 'epoch'::timestamptz),
        COALESCE(deposit_sync_evidence.deposit_sync_updated_at, 'epoch'::timestamptz),
        COALESCE(recent_completed_outflow_window.recent_completed_outflows_updated_at, 'epoch'::timestamptz),
        COALESCE(charge_window.charge_updated_at, 'epoch'::timestamptz),
        COALESCE(invocation_billing_window.invocation_billing_updated_at, 'epoch'::timestamptz),
        COALESCE(reconciliation.reconciliation_updated_at, 'epoch'::timestamptz)
    ) AS projected_at,
    consumer_refund_window.today_consumer_refund_usdc::numeric(36, 6) AS today_refund_usdc,
    provider_withdrawal_window.today_provider_withdrawal_usdc::numeric(36, 6) AS today_withdrawal_usdc,
    balance_snapshot.consumer_liability_usdc::numeric(36, 6) AS owner_liability_usdc,
    provider_withdrawal_window.pending_provider_withdrawal_count AS pending_withdrawal_count
FROM balance_snapshot
CROSS JOIN deposit_window
CROSS JOIN consumer_refund_window
CROSS JOIN provider_withdrawal_window
CROSS JOIN deposit_sync_evidence
CROSS JOIN recent_completed_outflow_window
CROSS JOIN charge_window
CROSS JOIN invocation_billing_window
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
invocation_billing_daily AS (
    SELECT
        inv.created_at::date AS bucket_date,
        COUNT(*) FILTER (
            WHERE lower(COALESCE(NULLIF(billing.payload->>'businessType', ''), 'charge')) = 'charge'
        )::bigint AS invocation_count,
        COALESCE(SUM(
            COALESCE(NULLIF(billing.payload->>'protocolFee', '')::numeric, 0)
            + COALESCE(NULLIF(billing.payload->>'routingTax', '')::numeric, 0)
        ) FILTER (
            WHERE lower(COALESCE(NULLIF(billing.payload->>'businessType', ''), 'charge')) = 'charge'
        ), 0) AS platform_fee_earned_usdc,
        COALESCE(SUM(
            GREATEST(
                COALESCE(NULLIF(billing.payload->>'unitPrice', '')::numeric, 0)
                - COALESCE(NULLIF(billing.payload->>'protocolFee', '')::numeric, 0),
                0
            )
        ) FILTER (
            WHERE lower(COALESCE(NULLIF(billing.payload->>'businessType', ''), 'charge')) = 'charge'
        ), 0) AS provider_earned_usdc
    FROM synapse_invocations AS inv
    LEFT JOIN synapse_runtime_state AS billing
        ON billing.state_key = 'invocation_billing::' || inv.invocation_id
    WHERE inv.status IN ('SUCCEEDED', 'SETTLED')
    GROUP BY inv.created_at::date
),
consumer_refund_daily AS (
    SELECT
        updated_at::date AS bucket_date,
        COALESCE(SUM(amount_usdc), 0) AS consumer_refund_usdc
    FROM synapse_vault_withdrawals
    WHERE upper(status) IN ('COMPLETED', 'CONFIRMED')
        AND withdrawal_kind = 'consumer_refund'
    GROUP BY updated_at::date
),
provider_withdrawal_daily AS (
    SELECT
        updated_at::date AS bucket_date,
        COALESCE(SUM(amount_usdc), 0) AS provider_withdrawal_usdc
    FROM synapse_vault_withdrawals
    WHERE upper(status) IN ('COMPLETED', 'CONFIRMED')
        AND withdrawal_kind = 'provider_withdrawal'
    GROUP BY updated_at::date
)
SELECT
    day_series.bucket_date,
    COALESCE(deposit_daily.deposit_usdc, 0)::numeric(36, 6) AS deposit_usdc,
    COALESCE(charge_daily.charge_usdc, 0)::numeric(36, 6) AS charge_usdc,
    COALESCE(invocation_billing_daily.invocation_count, 0)::bigint AS invocation_count,
    COALESCE(invocation_billing_daily.platform_fee_earned_usdc, 0)::numeric(36, 6) AS platform_fee_earned_usdc,
    COALESCE(invocation_billing_daily.provider_earned_usdc, 0)::numeric(36, 6) AS provider_earned_usdc,
    COALESCE(consumer_refund_daily.consumer_refund_usdc, 0)::numeric(36, 6) AS consumer_refund_usdc,
    COALESCE(provider_withdrawal_daily.provider_withdrawal_usdc, 0)::numeric(36, 6) AS provider_withdrawal_usdc,
    (
        COALESCE(deposit_daily.deposit_usdc, 0)
        - COALESCE(consumer_refund_daily.consumer_refund_usdc, 0)
        - COALESCE(provider_withdrawal_daily.provider_withdrawal_usdc, 0)
    )::numeric(36, 6) AS net_flow_usdc,
    COALESCE(consumer_refund_daily.consumer_refund_usdc, 0)::numeric(36, 6) AS refund_usdc,
    COALESCE(provider_withdrawal_daily.provider_withdrawal_usdc, 0)::numeric(36, 6) AS withdrawal_usdc
FROM day_series
LEFT JOIN deposit_daily ON deposit_daily.bucket_date = day_series.bucket_date
LEFT JOIN charge_daily ON charge_daily.bucket_date = day_series.bucket_date
LEFT JOIN invocation_billing_daily ON invocation_billing_daily.bucket_date = day_series.bucket_date
LEFT JOIN consumer_refund_daily ON consumer_refund_daily.bucket_date = day_series.bucket_date
LEFT JOIN provider_withdrawal_daily ON provider_withdrawal_daily.bucket_date = day_series.bucket_date
ORDER BY day_series.bucket_date ASC;
\endif