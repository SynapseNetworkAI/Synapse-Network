import { spawnSync } from "node:child_process";

const WINDOW_INTERVALS = {
  "1h": "1 hour",
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

function sqlQuote(value) {
  return String(value ?? "").replace(/'/g, "''");
}

export function postgresAnalyticsQuery({ dsn, root, sql }) {
  const result = spawnSync(
    "psql",
    [dsn, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { cwd: root, encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(
      `Postgres query failed: ${(result.stderr || result.stdout || "").slice(
        0,
        1000
      )}`
    );
  }
  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function postgresRawWindowSnapshot({ dsn, root, window = "24h" }) {
  const interval = WINDOW_INTERVALS[window] || WINDOW_INTERVALS["24h"];
  const rows = postgresAnalyticsQuery({
    dsn,
    root,
    sql: `
      WITH events AS (
        SELECT event_id, event_name, event_key AS distinct_id, COALESCE(payload->>'source', 'gateway') AS source, payload->'properties' AS properties
        FROM synapse_analytics_outbox
        WHERE created_at >= now() - interval '${interval}'
      )
      SELECT json_build_object(
        'quoteGenerated', COUNT(*) FILTER (WHERE event_name = 'quote_generated'),
        'invokeStarted', COUNT(*) FILTER (WHERE event_name = 'invoke_started'),
        'invokeCompleted', COUNT(*) FILTER (WHERE event_name = 'invoke_completed'),
        'invokeFailed', COUNT(*) FILTER (WHERE event_name = 'invoke_failed'),
        'budgetBlocked', COUNT(*) FILTER (WHERE event_name = 'budget_blocked'),
        'criticalRiskEvents', COUNT(*) FILTER (WHERE event_name = 'risk_rule_triggered' AND lower(COALESCE(properties->>'severity', '')) IN ('critical','high')),
        'providerHealthDegraded', COUNT(*) FILTER (WHERE event_name = 'provider_health_degraded'),
        'depositFailed', COUNT(*) FILTER (WHERE event_name = 'deposit_failed'),
        'withdrawalFailed', COUNT(*) FILTER (WHERE event_name = 'withdrawal_failed'),
        'gmvUsdc', COALESCE(SUM(CASE WHEN event_name = 'invoke_completed' THEN NULLIF(properties->>'price_usdc', '')::numeric ELSE 0 END), 0),
        'platformFeeUsdc', COALESCE(SUM(CASE WHEN event_name = 'provider_revenue_received' THEN NULLIF(properties->>'platform_fee_usdc', '')::numeric ELSE 0 END), 0),
        'providerNetUsdc', COALESCE(SUM(CASE WHEN event_name = 'provider_revenue_received' THEN NULLIF(properties->>'provider_net_usdc', '')::numeric ELSE 0 END), 0),
        'providerGrossUsdc', COALESCE(SUM(CASE WHEN event_name = 'provider_revenue_received' THEN NULLIF(properties->>'gross_usdc', '')::numeric ELSE 0 END), 0),
        'depositUsdc', COALESCE(SUM(CASE WHEN event_name = 'deposit_completed' THEN NULLIF(properties->>'amount_usdc', '')::numeric ELSE 0 END), 0),
        'withdrawalUsdc', COALESCE(SUM(CASE WHEN event_name = 'withdrawal_completed' THEN NULLIF(properties->>'amount_usdc', '')::numeric ELSE 0 END), 0),
        'refundUsdc', COALESCE(SUM(CASE WHEN event_name = 'refund_completed' THEN NULLIF(properties->>'amount_usdc', '')::numeric ELSE 0 END), 0),
        'eventCount', COUNT(*)
      )
      FROM events
    `,
  });
  return rows[0] || {};
}

export function postgresRawRunRows({ dsn, root, serviceIds, runId }) {
  const serviceIdList = (serviceIds || [])
    .map((id) => `'${sqlQuote(id)}'`)
    .join(",");
  const rows = postgresAnalyticsQuery({
    dsn,
    root,
    sql: `
      WITH events AS (
        SELECT event_id, event_name, event_key AS distinct_id, payload->'properties' AS properties
        FROM synapse_analytics_outbox
        WHERE created_at >= now() - interval '24 hours'
          AND (
            payload->'properties'->>'e2e_marker' = '${sqlQuote(runId)}'
            ${
              (serviceIds || []).length
                ? `OR payload->'properties'->>'service_id' IN (${serviceIdList})`
                : ""
            }
          )
      )
      SELECT json_build_object(
        'eventName', event_name,
        'count', COUNT(*),
        'uniqueEventIds', COUNT(DISTINCT event_id),
        'priceUsdc', COALESCE(SUM(COALESCE(NULLIF(properties->>'price_usdc', '')::numeric, 0)), 0),
        'grossUsdc', COALESCE(SUM(COALESCE(NULLIF(properties->>'gross_usdc', '')::numeric, 0)), 0),
        'platformFeeUsdc', COALESCE(SUM(COALESCE(NULLIF(properties->>'platform_fee_usdc', '')::numeric, 0)), 0),
        'providerNetUsdc', COALESCE(SUM(COALESCE(NULLIF(properties->>'provider_net_usdc', '')::numeric, 0)), 0),
        'amountUsdc', COALESCE(SUM(COALESCE(NULLIF(properties->>'amount_usdc', '')::numeric, 0)), 0),
        'rawWalletDistinctIds', COUNT(*) FILTER (WHERE distinct_id LIKE '0x%' OR length(distinct_id) = 42)
      )
      FROM events
      GROUP BY event_name
      ORDER BY event_name ASC
    `,
  });
  return rows;
}
