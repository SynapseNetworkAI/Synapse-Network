#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertLocalHttpUrl,
  assertStagingHttpUrl,
  requireStagingConfirmation,
  resolveE2eEnvironment,
} from "../lib/e2e_env_guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const generatedAt = new Date();
const environment = resolveE2eEnvironment({
  value: process.env.SERVICE_HEALTH_TYPED_TABLES_ENV,
  defaultEnv: "local",
  scriptName: "service-health-typed-tables",
});
const isStaging = environment === "staging";
const runId =
  process.env.SERVICE_HEALTH_TYPED_TABLES_RUN_ID ||
  `service-health-typed-${environment}-${Date.now().toString(36)}`;
const evidenceDir = path.resolve(
  process.env.SERVICE_HEALTH_TYPED_TABLES_EVIDENCE_DIR ||
    (isStaging
      ? path.join(
          ROOT,
          "docs/evidence/staging/service-health-typed-tables",
          `${formatTimestamp(generatedAt)}-staging`
        )
      : path.join(
          ROOT,
          "output/dogfood/service-health-typed-tables",
          `${formatTimestamp(generatedAt)}-local`
        ))
);

if (isStaging) {
  requireStagingConfirmation(
    "SERVICE_HEALTH_TYPED_TABLES_STAGING_CONFIRM",
    "I_UNDERSTAND_THIS_READS_STAGING_DB_AND_CALLS_STAGING_SERVICES"
  );
}

const gatewayBaseUrl = trimSlash(
  process.env.GATEWAY_BASE_URL ||
    process.env.STAGING_GATEWAY_URL ||
    (isStaging
      ? "https://api-staging.synapse-network.ai"
      : "http://127.0.0.1:8000")
);
const userFrontUrl = trimSlash(
  process.env.STAGING_USER_FRONT_URL ||
    process.env.USER_FRONT_URL ||
    (isStaging ? "https://staging.synapse-network.ai" : "http://localhost:3000")
);
const postgresDsn =
  process.env.SERVICE_HEALTH_TYPED_TABLES_POSTGRES_DSN ||
  process.env.STAGING_POSTGRES_DSN ||
  process.env.POSTGRES_DSN ||
  (isStaging
    ? ""
    : "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway");
const expectedServiceIds = (
  process.env.SERVICE_HEALTH_TYPED_TABLES_EXPECTED_SERVICE_IDS ||
  "svc_oss_security_healthcheck,svc_web3_sentiment_index,svc_protocol_fundamental_brief"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const credential =
  process.env.STAGING_E2E_AGENT_CREDENTIAL ||
  process.env.GATEWAY_PULL_HEALTH_E2E_CREDENTIAL ||
  process.env.SERVICE_HEALTH_TYPED_TABLES_E2E_CREDENTIAL ||
  "";

if (isStaging) {
  assertStagingHttpUrl("GATEWAY_BASE_URL", gatewayBaseUrl);
  assertStagingHttpUrl("STAGING_USER_FRONT_URL", userFrontUrl);
} else {
  assertLocalHttpUrl("GATEWAY_BASE_URL", gatewayBaseUrl);
  assertLocalHttpUrl("USER_FRONT_URL", userFrontUrl);
  if (process.env.ALLOW_GCP_SECRET_MANAGER === "1") {
    throw new Error("LOCAL_E2E_FORBIDS_GCP_SECRET_MANAGER");
  }
}
if (!postgresDsn) {
  throw new Error(
    isStaging
      ? "STAGING_POSTGRES_DSN is required for typed health table evidence."
      : "POSTGRES_DSN is required for typed health table evidence."
  );
}

const checks = [];
const failed = [];
const trace = [];
const sqlTimingEvidence = { environment, runId, measurements: [] };
const apiEvidence = { environment, gatewayBaseUrl, userFrontUrl, snapshots: {} };
const dbEvidence = { environment, expectedServiceIds, snapshots: {} };
const businessEvidence = {
  environment,
  fixedInvoke: { attempted: false },
  llmInvoke: { attempted: false, skippedWithReason: "not part of this focused gate" },
  noHold: { attempted: false, skippedWithReason: "covered by gateway-pull-health dogfood" },
  depositIndexerSmoke: { attempted: false, skippedWithReason: "read-only balance/deposit consistency only" },
};

fs.mkdirSync(evidenceDir, { recursive: true });

function formatTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function redact(value) {
  return String(value ?? "")
    .replace(/agt_[A-Za-z0-9._~+/-]+/g, "agt_[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://[REDACTED]@")
    .replace(/\b0x[a-fA-F0-9]{64,}\b/g, "0x[REDACTED]")
    .replace(
      /(password|private[_-]?key|api[_-]?key|secret|signature|token|credential)\s*[:=]\s*[^,\s"']+/gi,
      "$1=[REDACTED]"
    );
}

function isSensitiveKey(key) {
  return /(?:password|privateKey|apiKey|secret|signature|token|credential|dsn|authorization)/i.test(
    String(key || "")
  );
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        isSensitiveKey(key) ? "[REDACTED]" : sanitize(child),
      ])
    );
  }
  if (typeof value === "string") return redact(value);
  return value;
}

function addCheck(name, ok, details = {}, error = "") {
  const check = {
    name,
    status: ok ? "passed" : "failed",
    ok: Boolean(ok),
    details: sanitize(details),
    error: redact(error),
  };
  checks.push(check);
  if (!ok) failed.push(check);
  traceEvent("check", check);
  return check;
}

function traceEvent(event, details = {}) {
  trace.push(
    sanitize({
      runId,
      timestamp: new Date().toISOString(),
      event,
      ...details,
    })
  );
}

function psql(args, { input = "" } = {}) {
  return spawnSync("psql", [postgresDsn, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    input,
  });
}

function psqlScalar(sql) {
  const result = psql(["-t", "-A", "-c", sql]);
  if (result.status !== 0) {
    return { error: redact(result.stderr || result.stdout || "") };
  }
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "";
}

function psqlJson(sql) {
  const raw = psqlScalar(sql);
  if (typeof raw !== "string") return raw;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw: redact(raw) };
  }
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function serviceIdsSql() {
  return expectedServiceIds.map(sqlLiteral).join(",");
}

function measureSql({ name, sql, countSql, compareTo = "" }) {
  const started = Date.now();
  const result = psql(["-t", "-A", "-c", `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`]);
  const durationMs = Date.now() - started;
  let explain = null;
  let planningMs = null;
  let executionMs = null;
  if (result.status === 0) {
    try {
      explain = JSON.parse(result.stdout.trim());
      planningMs = Number(explain?.[0]?.["Planning Time"] ?? 0);
      executionMs = Number(explain?.[0]?.["Execution Time"] ?? 0);
    } catch {
      explain = null;
    }
  }
  const rowCountRaw = countSql ? psqlScalar(countSql) : "";
  const rowCount = Number(rowCountRaw || 0);
  const measurement = sanitize({
    name,
    compareTo,
    status: result.status,
    durationMs,
    planningMs,
    executionMs,
    rowCount,
    fingerprint: crypto.createHash("sha256").update(sql).digest("hex"),
    error: result.status === 0 ? "" : result.stderr || result.stdout,
  });
  sqlTimingEvidence.measurements.push(measurement);
  traceEvent("sql_timing", measurement);
  addCheck(
    `sql_timing_${name}`,
    result.status === 0,
    measurement,
    measurement.error || `SQL timing failed for ${name}`
  );
  return measurement;
}

async function timedJsonFetch(url, options = {}) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json,*/*;q=0.8",
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - started,
      json,
      text: redact(text.slice(0, 2000)),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: Date.now() - started,
      json: null,
      text: redact(error.message),
    };
  }
}

function gatewayApi(pathname) {
  return `${gatewayBaseUrl}/api${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

async function captureApiSnapshot(label) {
  const [discover, stats, health, registry] = await Promise.all([
    timedJsonFetch(gatewayApi("/v1/services/discover")),
    timedJsonFetch(gatewayApi("/v1/services/network-stats")),
    timedJsonFetch(gatewayApi("/v1/services/health/status?includeInactive=true")),
    timedJsonFetch(`${userFrontUrl}/marketplace/registry.json`),
  ]);
  const snapshot = sanitize({
    label,
    discover,
    stats,
    health,
    registry,
  });
  apiEvidence.snapshots[label] = snapshot;
  addCheck(
    `api_snapshot_${label}`,
    [discover, stats, health, registry].every((item) => item.status >= 200 && item.status < 300),
    {
      discover: discover.status,
      stats: stats.status,
      health: health.status,
      registry: registry.status,
    },
    "Gateway/User-front public service status endpoints must be reachable."
  );
  return snapshot;
}

function captureDbSnapshot(label) {
  const ids = serviceIdsSql();
  const snapshot = psqlJson(`
    SELECT json_build_object(
      'label', ${sqlLiteral(label)},
      'manifestTotal', (SELECT count(*) FROM synapse_service_manifests),
      'expectedManifests', (
        SELECT count(*) FROM synapse_service_manifests WHERE service_id IN (${ids})
      ),
      'typedRuntimeRows', (
        SELECT count(*) FROM synapse_service_health_runtime WHERE service_id IN (${ids})
      ),
      'typedEventRows', (
        SELECT count(*) FROM synapse_service_health_events WHERE service_id IN (${ids})
      ),
      'legacyHealthKvRows', (
        SELECT count(*) FROM synapse_runtime_state WHERE state_key LIKE 'service_health_%'
      ),
      'expectedRuntime', COALESCE((
        SELECT json_agg(json_build_object(
          'serviceId', service_id,
          'targetUrl', target_url,
          'status', status,
          'overallStatus', overall_status,
          'lastCheckedAt', last_checked_at,
          'updatedAt', updated_at,
          'consecutiveFailures', consecutive_failures
        ) ORDER BY service_id, target_url)
        FROM synapse_service_health_runtime
        WHERE service_id IN (${ids})
      ), '[]'::json)
    );
  `);
  dbEvidence.snapshots[label] = sanitize(snapshot);
  addCheck(
    `db_snapshot_${label}`,
    !snapshot?.error && Number(snapshot?.expectedManifests || 0) === expectedServiceIds.length,
    snapshot || {},
    "Expected canonical services must be registered in DB."
  );
  return snapshot;
}

function maxUpdatedAtMs(snapshot) {
  const rows = Array.isArray(snapshot?.expectedRuntime) ? snapshot.expectedRuntime : [];
  return Math.max(
    0,
    ...rows.map((row) => {
      const parsed = Date.parse(row.updatedAt || row.updated_at || "");
      return Number.isFinite(parsed) ? parsed : 0;
    })
  );
}

function runLocalHealthRefresh(label) {
  if (isStaging) return { skipped: true, reason: "staging_read_only" };
  const code = `
import asyncio, json
from dataclasses import asdict
from src.core.config import settings
from src.storage import create_storage
from src.services.platform.service_health_probe import refresh_all_service_health

async def main():
    storage = create_storage(settings)
    try:
        result = await refresh_all_service_health(storage)
        print(json.dumps(asdict(result)))
    finally:
        close = getattr(storage, "close", None)
        if callable(close):
            close()

asyncio.run(main())
`;
  const python = path.join(ROOT, "services/gateway/.venv/bin/python");
  const started = Date.now();
  const result = spawnSync(python, ["-c", code], {
    cwd: path.join(ROOT, "services/gateway"),
    encoding: "utf8",
    env: {
      ...process.env,
      ENV_FILE: process.env.ENV_FILE || "/tmp/synapse-service-health-e2e-no-env-file",
      POSTGRES_DSN: postgresDsn,
      STORAGE_BACKEND: "postgres",
      SERVICE_HEALTH_MAX_CANDIDATES_PER_TICK:
        process.env.SERVICE_HEALTH_MAX_CANDIDATES_PER_TICK || "25",
    },
  });
  const payloadText = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "{}";
  let payload = {};
  try {
    payload = JSON.parse(payloadText.replace(/'/g, '"'));
  } catch {
    payload = { raw: redact(payloadText) };
  }
  const evidence = sanitize({
    label,
    status: result.status,
    durationMs: Date.now() - started,
    stdout: result.stdout.slice(0, 2000),
    stderr: result.stderr.slice(0, 2000),
    result: payload,
  });
  traceEvent("local_health_refresh", evidence);
  addCheck(
    `local_health_refresh_${label}`,
    result.status === 0,
    evidence,
    "Local typed-table E2E must be able to run a bounded health refresh."
  );
  return evidence;
}

function runLocalEventCleanupOnce() {
  if (isStaging) return { skipped: true, reason: "staging_read_only" };
  const before = Number(psqlScalar("SELECT count(*) FROM synapse_service_health_events WHERE created_at < NOW() - INTERVAL '7 days';") || 0);
  const result = spawnSync(
    path.join(ROOT, "services/gateway/.venv/bin/python"),
    ["-m", "src.worker", "service-health-events-cleanup", "--once"],
    {
      cwd: path.join(ROOT, "services/gateway"),
      encoding: "utf8",
      env: {
        ...process.env,
        ENV_FILE: process.env.ENV_FILE || "/tmp/synapse-service-health-e2e-no-env-file",
        POSTGRES_DSN: postgresDsn,
        STORAGE_BACKEND: "postgres",
      },
    }
  );
  const after = Number(psqlScalar("SELECT count(*) FROM synapse_service_health_events WHERE created_at < NOW() - INTERVAL '7 days';") || 0);
  const evidence = sanitize({
    beforeExpiredEvents: before,
    afterExpiredEvents: after,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  addCheck(
    "service_health_events_cleanup_once",
    result.status === 0 && after <= before,
    evidence,
    "service-health-events-cleanup --once must run independently from monitor loop."
  );
  return evidence;
}

function cleanupLocalLegacyKv() {
  if (isStaging) return { skipped: true, reason: "staging_read_only" };
  const beforeRegistered = Number(psqlScalar("SELECT count(*) FROM synapse_service_manifests;") || 0);
  const beforeLegacy = Number(psqlScalar("SELECT count(*) FROM synapse_runtime_state WHERE state_key LIKE 'service_health_%';") || 0);
  const result = psql(["-c", "DELETE FROM synapse_runtime_state WHERE state_key LIKE 'service_health_%';"]);
  const afterLegacy = Number(psqlScalar("SELECT count(*) FROM synapse_runtime_state WHERE state_key LIKE 'service_health_%';") || 0);
  const afterRegistered = Number(psqlScalar("SELECT count(*) FROM synapse_service_manifests;") || 0);
  const evidence = sanitize({
    beforeLegacy,
    afterLegacy,
    beforeRegistered,
    afterRegistered,
    status: result.status,
  });
  addCheck(
    "local_legacy_health_kv_cleanup_registration_safe",
    result.status === 0 && afterLegacy === 0 && beforeRegistered === afterRegistered,
    evidence,
    "Legacy service_health_% cleanup must not delete service registrations."
  );
  return evidence;
}

function sourceHotPathScan() {
  const result = spawnSync(
    "rg",
    [
      "-n",
      "state_key LIKE 'service_health_%'|state_key LIKE \\$1",
      "services/gateway/src/services/platform",
      "services/gateway/src/storage/postgres/repositories/service_registry_query_mixin.py",
    ],
    { cwd: ROOT, encoding: "utf8" }
  );
  const output = result.stdout.trim();
  const allowed = output
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !line.includes("cleanup_legacy_service_health_runtime_state"));
  const evidence = sanitize({ status: result.status, matches: allowed });
  addCheck(
    "health_hot_path_legacy_kv_absent",
    allowed.length === 0,
    evidence,
    "Health refresh/discovery hot path must not query legacy service_health_% runtime_state rows."
  );
  return evidence;
}

async function runFixedInvoke() {
  if (!credential) {
    businessEvidence.fixedInvoke.skippedWithReason =
      "STAGING_E2E_AGENT_CREDENTIAL or SERVICE_HEALTH_TYPED_TABLES_E2E_CREDENTIAL is not configured.";
    addCheck("fixed_price_invoke_skipped_with_reason", true, businessEvidence.fixedInvoke);
    return;
  }
  const idempotencyKey = `${runId}-fixed-invoke`;
  businessEvidence.fixedInvoke = { attempted: true, serviceId: "svc_oss_security_healthcheck", idempotencyKey };
  const result = await timedJsonFetch(gatewayApi("/v1/agent/invoke"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Credential": credential,
      "X-Request-Id": `${runId}:fixed-invoke`,
    },
    body: JSON.stringify({
      serviceId: "svc_oss_security_healthcheck",
      idempotencyKey,
      payload: { body: { target: "typed-health-regression", checks: ["health"] } },
    }),
  });
  const invocationId = result.json?.invocationId || result.json?.invocation_id || "";
  const db = invocationId
    ? psqlJson(`
      SELECT json_build_object(
        'invocation', (
          SELECT json_build_object('invocationId', invocation_id, 'serviceId', service_id, 'status', status, 'chargedUsdc', charged_usdc::text)
          FROM synapse_invocations WHERE invocation_id = ${sqlLiteral(invocationId)}
        ),
        'ledgerCount', (SELECT count(*) FROM synapse_ledger_entries WHERE reference_id = ${sqlLiteral(invocationId)}),
        'auditCount', (SELECT count(*) FROM synapse_audit_events WHERE invocation_id = ${sqlLiteral(invocationId)})
      );
    `)
    : null;
  businessEvidence.fixedInvoke = sanitize({
    ...businessEvidence.fixedInvoke,
    status: result.status,
    response: result.json || result.text,
    db,
  });
  addCheck(
    "fixed_price_invoke_regression",
    result.ok && String(result.json?.status || "").toUpperCase() === "SUCCEEDED",
    businessEvidence.fixedInvoke,
    "Fixed-price canonical invoke must still succeed after health typed-table migration."
  );
}

function writeEvidence() {
  const traceText = trace.map((row) => JSON.stringify(sanitize(row))).join("\n") + "\n";
  fs.writeFileSync(path.join(evidenceDir, "trace.jsonl"), traceText);
  const traceDigest = crypto.createHash("sha256").update(traceText).digest("hex");
  const report = sanitize({
    status: failed.length ? "failed" : "success",
    environment,
    runId,
    generatedAt: generatedAt.toISOString(),
    evidenceDir,
    failed,
    checks,
    traceDigest,
    files: {
      sqlTiming: "sql-timing-evidence.json",
      api: "api-evidence.json",
      db: "db-evidence.json",
      business: "business-regression-evidence.json",
    },
  });
  fs.writeFileSync(path.join(evidenceDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(evidenceDir, "sql-timing-evidence.json"), `${JSON.stringify(sanitize(sqlTimingEvidence), null, 2)}\n`);
  fs.writeFileSync(path.join(evidenceDir, "api-evidence.json"), `${JSON.stringify(sanitize(apiEvidence), null, 2)}\n`);
  fs.writeFileSync(path.join(evidenceDir, "db-evidence.json"), `${JSON.stringify(sanitize(dbEvidence), null, 2)}\n`);
  fs.writeFileSync(path.join(evidenceDir, "business-regression-evidence.json"), `${JSON.stringify(sanitize(businessEvidence), null, 2)}\n`);
  fs.writeFileSync(
    path.join(evidenceDir, "bugfix-log.md"),
    failed.length
      ? `# Bugfix Log\n\n${failed.map((item) => `- OPEN: ${item.name} - ${item.error}`).join("\n")}\n`
      : "# Bugfix Log\n\nNo open bugs.\n"
  );
  fs.writeFileSync(
    path.join(evidenceDir, "report.md"),
    [
      "# Service Health Typed Tables E2E",
      "",
      `- Status: ${report.status}`,
      `- Environment: ${environment}`,
      `- Run ID: ${runId}`,
      `- Failed checks: ${failed.length}`,
      `- Evidence: ${evidenceDir}`,
      "",
    ].join("\n")
  );
}

async function main() {
  traceEvent("start", { environment, gatewayBaseUrl, userFrontUrl });
  captureDbSnapshot("before");
  await captureApiSnapshot("before");
  sourceHotPathScan();

  measureSql({
    name: "legacy_kv_baseline",
    sql: "SELECT state_key, payload FROM synapse_runtime_state WHERE state_key LIKE 'service_health_%' ORDER BY state_key ASC",
    countSql: "SELECT count(*) FROM synapse_runtime_state WHERE state_key LIKE 'service_health_%'",
  });
  measureSql({
    name: "typed_runtime",
    compareTo: "legacy_kv_baseline",
    sql: "SELECT service_id, target_url, status, overall_status, last_checked_at, updated_at FROM synapse_service_health_runtime ORDER BY service_id ASC, target_url ASC",
    countSql: "SELECT count(*) FROM synapse_service_health_runtime",
  });
  measureSql({
    name: "typed_events_recent",
    sql: "SELECT service_id, target_url, from_status, to_status, created_at FROM synapse_service_health_events WHERE created_at >= NOW() - INTERVAL '7 days' ORDER BY created_at DESC LIMIT 200",
    countSql: "SELECT count(*) FROM synapse_service_health_events WHERE created_at >= NOW() - INTERVAL '7 days'",
  });

  const before = dbEvidence.snapshots.before;
  const beforeUpdatedAt = maxUpdatedAtMs(before);
  const beforeEvents = Number(before?.typedEventRows || 0);
  for (const label of ["tick1", "tick2", "tick3"]) {
    runLocalHealthRefresh(label);
  }
  const afterRefresh = captureDbSnapshot("after_refresh");
  await captureApiSnapshot("after_refresh");
  addCheck(
    isStaging ? "typed_runtime_present_staging" : "typed_runtime_updated_after_health_refresh",
    isStaging
      ? Number(afterRefresh?.typedRuntimeRows || 0) >= expectedServiceIds.length
      : maxUpdatedAtMs(afterRefresh) >= beforeUpdatedAt,
    { beforeUpdatedAt, afterUpdatedAt: maxUpdatedAtMs(afterRefresh), afterRefresh },
    "Typed runtime rows must exist and local refresh must update runtime timestamps."
  );
  addCheck(
    "same_status_probe_does_not_append_events",
    Number(afterRefresh?.typedEventRows || 0) <= beforeEvents + expectedServiceIds.length,
    { beforeEvents, afterEvents: afterRefresh?.typedEventRows },
    "Continuous same-status probes should not behave like old append-everything history."
  );

  dbEvidence.eventCleanup = runLocalEventCleanupOnce();
  dbEvidence.legacyCleanup = cleanupLocalLegacyKv();
  const afterCleanup = captureDbSnapshot("after_cleanup");
  addCheck(
    "registered_services_survive_cleanup",
    Number(afterCleanup?.expectedManifests || 0) === expectedServiceIds.length,
    afterCleanup || {},
    "Legacy health KV cleanup must not remove registered provider services."
  );

  await runFixedInvoke();
  writeEvidence();

  if (failed.length) {
    console.error(
      `[service-health-typed-tables] failed: ${failed.map((item) => item.name).join(", ")}`
    );
    console.error(`[service-health-typed-tables] evidence: ${evidenceDir}`);
    process.exit(1);
  }
  console.log(`[service-health-typed-tables] evidence written to ${evidenceDir}`);
}

main().catch((error) => {
  addCheck("runner_uncaught_error", false, {}, error?.stack || error?.message || String(error));
  writeEvidence();
  console.error(error);
  process.exit(1);
});
