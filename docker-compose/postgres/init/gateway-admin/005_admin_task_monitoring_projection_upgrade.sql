\if :{?synapse_gateway_db}

DROP VIEW IF EXISTS synapse_admin_dashboard_projection;
DROP VIEW IF EXISTS synapse_admin_dashboard_operations_projection;

CREATE VIEW synapse_admin_dashboard_operations_projection AS
WITH indexer_runtime AS (
    SELECT
        COALESCE(NULLIF(payload->>'running', '')::boolean, FALSE) AS indexer_running,
        CASE
            WHEN NULLIF(payload->>'lastProcessedAt', '') IS NOT NULL
                THEN to_timestamp((payload->>'lastProcessedAt')::double precision)
            ELSE NULL
        END AS indexer_last_processed_at,
        CASE
            WHEN NULLIF(payload->>'heartbeatAt', '') IS NOT NULL
                THEN to_timestamp((payload->>'heartbeatAt')::double precision)
            ELSE NULL
        END AS indexer_last_heartbeat_at,
        NULLIF(payload->>'lastError', '') AS indexer_last_error,
        COALESCE((NULLIF(payload->>'pollIntervalSec', '')::double precision)::integer, 0) AS indexer_poll_interval_sec,
        COALESCE(NULLIF(payload->'backfill'->>'enabled', '')::boolean, FALSE) AS backfill_enabled,
        CASE
            WHEN NULLIF(payload->'backfill'->>'lastScanAt', '') IS NOT NULL
                THEN to_timestamp((payload->'backfill'->>'lastScanAt')::double precision)
            ELSE NULL
        END AS backfill_last_scan_at,
        NULLIF(payload->'backfill'->>'lastScannedBlock', '')::bigint AS backfill_last_scanned_block,
        COALESCE(NULLIF(payload->'backfill'->>'lastRecovered', '')::bigint, 0) AS backfill_last_recovered,
        NULLIF(payload->'backfill'->>'lastError', '') AS backfill_last_error,
        COALESCE(NULLIF(payload->'reconciliation'->>'enabled', '')::boolean, FALSE) AS reconciliation_enabled,
        CASE
            WHEN NULLIF(payload->'reconciliation'->>'lastCheckAt', '') IS NOT NULL
                THEN to_timestamp((payload->'reconciliation'->>'lastCheckAt')::double precision)
            ELSE NULL
        END AS last_reconciliation_at,
        COALESCE(NULLIF(payload->'reconciliation'->>'deltaUsdc', '')::numeric, 0) AS reconciliation_delta_usdc,
        COALESCE(NULLIF(payload->'reconciliation'->>'alert', '')::boolean, FALSE) AS reconciliation_alert,
        NULLIF(payload->'reconciliation'->>'lastError', '') AS reconciliation_last_error,
        updated_at AS indexer_runtime_updated_at
    FROM synapse_runtime_state
    WHERE state_key = 'deposit_indexer_runtime_state'
),
reconciliation AS (
    SELECT
        COALESCE(NULLIF(payload->>'enabled', '')::boolean, FALSE) AS reconciliation_enabled,
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
            OR COALESCE(indexer_runtime.indexer_last_error, '') <> ''
            OR COALESCE(indexer_runtime.backfill_last_error, '') <> ''
            OR COALESCE(indexer_runtime.reconciliation_last_error, reconciliation.reconciliation_last_error) IS NOT NULL
            OR (
                indexer_runtime.indexer_runtime_updated_at IS NOT NULL
                AND COALESCE(indexer_runtime.indexer_running, FALSE) = FALSE
            )
        THEN 'degraded'
        ELSE 'healthy'
    END AS gateway_status,
    COALESCE(indexer_runtime.indexer_running, FALSE) AS indexer_running,
    COALESCE(indexer_runtime.indexer_last_processed_at, runtime_projection.runtime_projection_updated_at) AS indexer_last_processed_at,
    indexer_runtime.indexer_last_heartbeat_at,
    indexer_runtime.indexer_last_error,
    COALESCE(indexer_runtime.indexer_poll_interval_sec, 0) AS indexer_poll_interval_sec,
    COALESCE(indexer_runtime.backfill_enabled, FALSE) AS backfill_enabled,
    COALESCE(indexer_runtime.backfill_last_scan_at, runtime_projection.runtime_projection_updated_at) AS backfill_last_scan_at,
    indexer_runtime.backfill_last_scanned_block,
    COALESCE(indexer_runtime.backfill_last_recovered, 0) AS backfill_last_recovered,
    indexer_runtime.backfill_last_error,
    COALESCE(system_window.recent_gateway_failures, 0) AS recent_gateway_failures,
    COALESCE(failed_deposits.failed_deposit_count, 0) AS failed_deposit_count,
    COALESCE(audit_window.recent_audit_alerts, 0) AS recent_audit_alerts,
    COALESCE(indexer_runtime.reconciliation_enabled, reconciliation.reconciliation_enabled, FALSE) AS reconciliation_enabled,
    COALESCE(indexer_runtime.last_reconciliation_at, reconciliation.last_reconciliation_at) AS last_reconciliation_at,
    COALESCE(indexer_runtime.reconciliation_alert, reconciliation.reconciliation_alert, FALSE) AS reconciliation_alert,
    COALESCE(indexer_runtime.reconciliation_delta_usdc, reconciliation.reconciliation_delta_usdc, 0)::numeric(36, 6) AS reconciliation_delta_usdc,
    COALESCE(indexer_runtime.reconciliation_last_error, reconciliation.reconciliation_last_error) AS reconciliation_last_error,
    GREATEST(
        COALESCE(indexer_runtime.indexer_runtime_updated_at, 'epoch'::timestamptz),
        COALESCE(reconciliation.reconciliation_updated_at, 'epoch'::timestamptz),
        COALESCE(runtime_projection.runtime_projection_updated_at, 'epoch'::timestamptz),
        COALESCE(failed_deposits.failed_deposits_updated_at, 'epoch'::timestamptz),
        COALESCE(audit_window.audit_updated_at, 'epoch'::timestamptz),
        COALESCE(system_window.system_updated_at, 'epoch'::timestamptz)
    ) AS projected_at
FROM system_window
CROSS JOIN failed_deposits
CROSS JOIN audit_window
LEFT JOIN indexer_runtime ON TRUE
LEFT JOIN reconciliation ON TRUE
LEFT JOIN runtime_projection ON TRUE;

COMMENT ON VIEW synapse_admin_dashboard_operations_projection IS
'Stable admin operations projection derived from persisted deposit indexer runtime state, reconciliation runtime state, and target-state audit events.';

CREATE VIEW synapse_admin_dashboard_projection AS
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

COMMENT ON VIEW synapse_admin_dashboard_projection IS
'Target-state compatibility aggregation view built from the finance and operations projections.';

\endif
