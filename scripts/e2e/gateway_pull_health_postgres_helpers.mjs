import { spawnSync } from "node:child_process";

export function createGatewayPullHealthPostgresHelpers({
  root,
  isStaging,
  postgresDsn,
  localAdminPostgresDsnCandidates,
  expectedServiceIds,
  llmServiceId,
  addCheck,
  traceEvent,
  redact,
}) {
  function psqlJson(sql) {
    if (!postgresDsn) return null;
    const result = spawnSync(
      "psql",
      [postgresDsn, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql],
      { cwd: root, encoding: "utf8" }
    );
    if (result.status !== 0) {
      return {
        error: redact(result.stderr || result.stdout || ""),
      };
    }
    const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
    if (!line) return null;
    try {
      return JSON.parse(line);
    } catch {
      return { raw: redact(line) };
    }
  }

  function psqlExec(sql) {
    if (!postgresDsn) {
      return {
        status: 1,
        stdout: "",
        stderr: "POSTGRES_DSN is not configured",
      };
    }
    const result = spawnSync(
      "psql",
      [postgresDsn, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql],
      { cwd: root, encoding: "utf8" }
    );
    traceEvent("psql_exec", {
      status: result.status,
      stdout: redact(result.stdout || "").slice(0, 1000),
      stderr: redact(result.stderr || "").slice(0, 1000),
    });
    return result;
  }

  function psqlExecWithDsn(dsn, sql) {
    if (!dsn) {
      return {
        status: 1,
        stdout: "",
        stderr: "Postgres DSN is not configured",
      };
    }
    const result = spawnSync(
      "psql",
      [dsn, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql],
      { cwd: root, encoding: "utf8" }
    );
    traceEvent("psql_exec", {
      status: result.status,
      stdout: redact(result.stdout || "").slice(0, 1000),
      stderr: redact(result.stderr || "").slice(0, 1000),
    });
    return result;
  }

  function sqlString(value) {
    return String(value).replace(/'/g, "''");
  }

  function expireExpectedHealthSnapshots() {
    if (isStaging) return;
    const ids = expectedServiceIds
      .map((serviceId) => `'${sqlString(serviceId)}'`)
      .join(",");
    const result = psqlExec(`
    UPDATE synapse_service_health_snapshots
    SET last_checked_at = NOW() - INTERVAL '10 minutes',
        updated_at = NOW() - INTERVAL '10 minutes'
    WHERE service_id IN (${ids});

    UPDATE synapse_service_health_runtime
    SET last_checked_at = NOW() - INTERVAL '10 minutes',
        updated_at = NOW() - INTERVAL '10 minutes'
    WHERE service_id IN (${ids});
  `);
    addCheck(
      "local_expired_snapshot_fixture_applied",
      result.status === 0,
      { serviceIds: expectedServiceIds },
      "Could not simulate expired health snapshots for local fail-closed verification."
    );
  }

  function ensureLocalOfflineLifecycleSchema() {
    if (isStaging) return;
    let result = {
      status: 1,
      stdout: "",
      stderr: "No local admin DSN candidates",
    };
    for (const candidate of localAdminPostgresDsnCandidates) {
      result = psqlExecWithDsn(
        candidate,
        `
    ALTER TABLE synapse_service_manifests
      DROP CONSTRAINT IF EXISTS synapse_service_manifests_status_check;
    ALTER TABLE synapse_service_manifests
      ADD CONSTRAINT synapse_service_manifests_status_check
      CHECK (status IN ('draft', 'active', 'paused', 'offline', 'archived'));
  `
      );
      if (result.status === 0) break;
    }
    addCheck(
      "local_offline_lifecycle_schema_available",
      result.status === 0,
      {},
      "Local DB schema must allow the offline lifecycle state before offline dogfood can run."
    );
  }

  function makeLocalLlmUnavailableForNoHold() {
    if (isStaging) return;
    const safe = sqlString(llmServiceId);
    const result = psqlExec(`
    UPDATE synapse_service_health_snapshots
    SET last_checked_at = NOW() - INTERVAL '10 minutes',
        updated_at = NOW() - INTERVAL '10 minutes',
        health_score = 0,
        error_code = 'DOGFOOD_LLM_UNAVAILABLE'
    WHERE service_id = '${safe}';

    UPDATE synapse_service_health_runtime
    SET status = 'unhealthy',
        overall_status = 'unhealthy',
        last_checked_at = NOW() - INTERVAL '10 minutes',
        updated_at = NOW() - INTERVAL '10 minutes',
        error_code = 'DOGFOOD_LLM_UNAVAILABLE'
    WHERE service_id = '${safe}';
  `);
    addCheck(
      "local_llm_unavailable_fixture_applied",
      result.status === 0,
      { serviceId: llmServiceId },
      "Could not make local LLM service unavailable before no-hold verification."
    );
  }

  function markLocalServiceOffline(serviceId) {
    const safe = sqlString(serviceId);
    const result = psqlExec(`
    UPDATE synapse_service_manifests
    SET status = 'offline', updated_at = NOW()
    WHERE service_id = '${safe}';

    UPDATE synapse_service_health_snapshots
    SET health_score = 0,
        success_rate_24h = 0,
        error_code = 'DOGFOOD_OFFLINE',
        last_checked_at = NOW(),
        updated_at = NOW()
    WHERE service_id = '${safe}';

    UPDATE synapse_service_health_runtime
    SET status = 'unhealthy',
        overall_status = 'offline',
        error_code = 'DOGFOOD_OFFLINE',
        offline_reason = 'dogfood_offline_quarantine',
        updated_at = NOW()
    WHERE service_id = '${safe}';

    UPDATE synapse_runtime_state
    SET payload = payload || jsonb_build_object(
          'lifecycleStatus', 'offline',
          'status', 'offline',
          'offlineReason', 'dogfood_offline_quarantine',
          'offlineAt', NOW()::text
        ),
        updated_at = NOW()
    WHERE state_key = 'service_meta::${safe}';
  `);
    addCheck(
      "local_offline_fixture_applied",
      result.status === 0,
      { serviceId },
      "Could not simulate offline quarantine state for local service."
    );
  }

  function idempotencySql(idempotencyKey) {
    const safe = String(idempotencyKey).replace(/'/g, "''");
    return `
    SELECT json_build_object(
      'quoteCount', (SELECT count(*) FROM synapse_service_quotes WHERE request_fingerprint LIKE '%${safe}%'),
      'invocationCount', (SELECT count(*) FROM synapse_invocations WHERE idempotency_key = '${safe}'),
      'invocations', COALESCE((SELECT json_agg(json_build_object('invocationId', invocation_id, 'status', status, 'chargedUsdc', charged_usdc, 'errorCode', error_code)) FROM synapse_invocations WHERE idempotency_key = '${safe}'), '[]'::json)
    );
  `;
  }

  return {
    psqlJson,
    psqlExec,
    expireExpectedHealthSnapshots,
    ensureLocalOfflineLifecycleSchema,
    makeLocalLlmUnavailableForNoHold,
    markLocalServiceOffline,
    idempotencySql,
  };
}
