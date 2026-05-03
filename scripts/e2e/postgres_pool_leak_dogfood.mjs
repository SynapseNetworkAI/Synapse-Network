#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertLocalDsn,
  assertLocalHttpUrl,
  assertStagingHttpUrl,
  assertStagingProxyDsn,
  readDotenvFile,
  requireStagingConfirmation,
  resolveE2eEnvironment,
} from "../lib/e2e_env_guard.mjs";
import { assertSeedEnvironment } from "./seed_env_guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const generatedAt = new Date();
const environment = resolveE2eEnvironment({
  value: process.env.POSTGRES_POOL_LEAK_ENV,
  defaultEnv: "local",
  scriptName: "postgres-pool-leak-dogfood",
});
const isStaging = environment === "staging";
process.env.SYNAPSE_E2E_ENV ||= environment;

const STAGING_CONFIRM =
  "I_UNDERSTAND_THIS_READS_STAGING_DB_AND_MAY_RESTART_GATEWAY";
if (isStaging) {
  requireStagingConfirmation(
    "POSTGRES_POOL_LEAK_STAGING_CONFIRM",
    STAGING_CONFIRM
  );
}

const timestamp = generatedAt
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "Z");
const runId =
  process.env.POSTGRES_POOL_LEAK_RUN_ID ||
  `postgres-pool-leak-${environment}-${Date.now().toString(36)}`;
const evidenceDir = path.resolve(
  process.env.POSTGRES_POOL_LEAK_EVIDENCE_DIR ||
    (isStaging
      ? path.join(
          ROOT,
          "docs/evidence/staging/postgres-pool-leak",
          `${timestamp}-staging`
        )
      : path.join(
          ROOT,
          "output/dogfood/postgres-pool-leak",
          `${timestamp}-local`
        ))
);

const localGatewayEnv = !isStaging
  ? {
      ...readDotenvFile(path.join(ROOT, "services/gateway/.env.local")),
      ...readDotenvFile(path.join(ROOT, "services/gateway/.env.local.private")),
      ...readDotenvFile(path.join(ROOT, "services/gateway/.env.e2e.local")),
      ...process.env,
    }
  : process.env;
const gatewayBaseUrl = trimSlash(
  process.env.GATEWAY_BASE_URL ||
    process.env.POSTGRES_POOL_LEAK_GATEWAY_BASE ||
    (isStaging
      ? "https://api-staging.synapse-network.ai"
      : "http://127.0.0.1:8000")
);
const postgresDsn =
  process.env.POSTGRES_POOL_LEAK_POSTGRES_DSN ||
  process.env.LOCAL_POSTGRES_DSN ||
  process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
  process.env.POSTGRES_DSN ||
  localGatewayEnv.POSTGRES_DSN ||
  (isStaging
    ? ""
    : "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway");
const expectedPoolMax = Number(
  process.env.POSTGRES_POOL_MAX ||
    process.env.POSTGRES_POOL_LEAK_EXPECTED_POOL_MAX ||
    localGatewayEnv.POSTGRES_POOL_MAX ||
    2
);
const restartCount = isStaging
  ? Number(process.env.POSTGRES_POOL_LEAK_STAGING_RESTART_COUNT || 0)
  : Number(process.env.POSTGRES_POOL_LEAK_RESTART_COUNT || 10);
const concurrentRequests = Number(
  process.env.POSTGRES_POOL_LEAK_CONCURRENT_REQUESTS || (isStaging ? 24 : 30)
);
const pressureRounds = Number(
  process.env.POSTGRES_POOL_LEAK_PRESSURE_ROUNDS || 4
);
const longIdleInTxThresholdSec = Number(
  process.env.POSTGRES_POOL_LEAK_IDLE_IN_TX_THRESHOLD_SEC ||
    (isStaging ? 30 : 5)
);
const steadyStateAllowance = Number(
  process.env.POSTGRES_POOL_LEAK_STEADY_STATE_ALLOWANCE || 1
);

if (isStaging) {
  assertStagingHttpUrl("GATEWAY_BASE_URL", gatewayBaseUrl);
  assertStagingProxyDsn("POSTGRES_POOL_LEAK_POSTGRES_DSN", postgresDsn, {
    allowEmpty: false,
  });
} else {
  assertLocalHttpUrl("GATEWAY_BASE_URL", gatewayBaseUrl);
  assertLocalDsn("POSTGRES_POOL_LEAK_POSTGRES_DSN", postgresDsn, {
    allowEmpty: false,
  });
  if (process.env.ALLOW_GCP_SECRET_MANAGER === "1") {
    throw new Error("LOCAL_E2E_FORBIDS_GCP_SECRET_MANAGER");
  }
}
process.env.SYNAPSE_SEED_ENV ||= environment;
assertSeedEnvironment({
  scriptName: "postgres-pool-leak-dogfood",
  allowStaging: true,
  runId,
  dsn: postgresDsn,
  urls: [gatewayBaseUrl],
});

const checks = [];
const failed = [];
const trace = [];
const bugs = [];
const readinessSnapshots = [];
const pgSnapshots = [];
const workerEvidence = {
  environment,
  attempted: [],
};

fs.mkdirSync(evidenceDir, { recursive: true });

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function redact(value) {
  return String(value ?? "")
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://[REDACTED]@")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b0x[a-fA-F0-9]{64,}\b/g, "0x[REDACTED]")
    .replace(/agt_[A-Za-z0-9._~+/-]{12,}/g, "agt_[REDACTED]")
    .replace(
      /(password|private[_-]?key|api[_-]?key|secret|signature|token|credential)\s*[:=]\s*[^,\s"']+/gi,
      "$1=[REDACTED]"
    );
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, sanitize(child)])
    );
  }
  if (typeof value === "string") return redact(value);
  return value;
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

function addBug({ scenario, expected, actual, evidence = "" }) {
  bugs.push({
    id: `PPL-${String(bugs.length + 1).padStart(3, "0")}`,
    severity: "P1",
    scenario,
    evidence: redact(evidence),
    reproSteps: `Run npm run e2e:postgres-pool-leak:${environment}`,
    expected,
    actual: redact(actual),
    status: "open",
  });
}

function addCheck(name, ok, details = {}, failure = "") {
  const check = {
    name,
    status: ok ? "passed" : "failed",
    details: sanitize(details),
    failure: ok ? "" : redact(failure),
  };
  checks.push(check);
  traceEvent("check", check);
  if (!ok) {
    failed.push({ name, failure: check.failure });
    addBug({
      scenario: name,
      expected: "pass",
      actual: failure || "check failed",
      evidence: JSON.stringify(details).slice(0, 1000),
    });
  }
  return ok;
}

async function httpJson(url, { timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    return { status: response.status, ok: response.ok, body };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForReadiness(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await httpJson(`${gatewayBaseUrl}/readiness`, { timeoutMs: 3000 });
      if (last.ok && last.body?.status) return last.body;
    } catch (error) {
      last = { error: error.message };
    }
    await sleep(1000);
  }
  throw new Error(
    `Gateway readiness did not recover: ${redact(JSON.stringify(last))}`
  );
}

async function collectReadinessSnapshot(label) {
  const response = await httpJson(`${gatewayBaseUrl}/readiness`, {
    timeoutMs: 5000,
  });
  const snapshot = sanitize({
    label,
    capturedAt: new Date().toISOString(),
    status: response.status,
    ok: response.ok,
    postgresPool: response.body?.postgresPool || null,
    bodyStatus: response.body?.status || null,
  });
  readinessSnapshots.push(snapshot);
  traceEvent("readiness_snapshot", snapshot);
  return snapshot;
}

function psqlJson(query) {
  const output = execFileSync(
    "psql",
    [postgresDsn, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", query],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim();
  return output ? JSON.parse(output) : null;
}

function collectPgSnapshot(label) {
  const rows = psqlJson(`
WITH activity AS (
  SELECT
    pid,
    application_name,
    state,
    wait_event_type,
    wait_event,
    COALESCE(EXTRACT(EPOCH FROM now() - xact_start), 0)::numeric(18,3) AS xact_age_sec,
    COALESCE(EXTRACT(EPOCH FROM now() - state_change), 0)::numeric(18,3) AS state_age_sec,
    left(regexp_replace(query, '\\s+', ' ', 'g'), 160) AS query
  FROM pg_stat_activity
  WHERE datname = current_database()
    AND application_name = 'synapse-gateway'
  ORDER BY pid
)
SELECT COALESCE(json_agg(row_to_json(activity)), '[]'::json) FROM activity;
`);
  const byState = {};
  for (const row of rows || []) {
    byState[row.state || "unknown"] =
      (byState[row.state || "unknown"] || 0) + 1;
  }
  const snapshot = sanitize({
    label,
    capturedAt: new Date().toISOString(),
    total: rows?.length || 0,
    byState,
    rows: rows || [],
  });
  pgSnapshots.push(snapshot);
  traceEvent("pg_stat_activity_snapshot", {
    label,
    total: snapshot.total,
    byState,
  });
  return snapshot;
}

function restartGateway(label, env = {}) {
  traceEvent("gateway_restart_begin", { label });
  const command = isStaging
    ? process.env.POSTGRES_POOL_LEAK_RESTART_COMMAND || ""
    : "bash scripts/local/restart_gateway.sh";
  if (!command) {
    traceEvent("gateway_restart_skipped", {
      label,
      reason: "POSTGRES_POOL_LEAK_RESTART_COMMAND not set",
    });
    return { skipped: true };
  }
  const result = spawnSync("bash", ["-lc", command], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf8",
    timeout: isStaging ? 180000 : 90000,
  });
  traceEvent("gateway_restart_end", {
    label,
    status: result.status,
    signal: result.signal,
    stdout: redact((result.stdout || "").slice(-2000)),
    stderr: redact((result.stderr || "").slice(-2000)),
  });
  if (result.status !== 0) {
    throw new Error(
      `Gateway restart failed (${label}): ${redact(
        `${result.stdout || ""}\n${result.stderr || ""}`.slice(-2000)
      )}`
    );
  }
  return { skipped: false, status: result.status };
}

async function pressureReadOnlyEndpoints() {
  const endpoints = [
    "/readiness",
    "/api/v1/services/network-stats",
    "/api/v1/services/health/status",
  ];
  const results = [];
  for (let round = 0; round < pressureRounds; round += 1) {
    const promises = [];
    for (let index = 0; index < concurrentRequests; index += 1) {
      const endpoint = endpoints[index % endpoints.length];
      promises.push(
        httpJson(`${gatewayBaseUrl}${endpoint}`, { timeoutMs: 8000 })
          .then((result) => ({
            endpoint,
            status: result.status,
            ok: result.ok,
          }))
          .catch((error) => ({
            endpoint,
            status: 0,
            ok: false,
            error: error.message,
          }))
      );
    }
    const roundResults = await Promise.all(promises);
    results.push(...roundResults);
    await collectReadinessSnapshot(`pressure_round_${round + 1}`);
    collectPgSnapshot(`pressure_round_${round + 1}`);
  }
  return results;
}

function runWorker(command) {
  const gatewayDir = path.join(ROOT, "services/gateway");
  const args = ["-m", "src.worker", command, "--once"];
  const result = spawnSync(".venv/bin/python", args, {
    cwd: gatewayDir,
    env: {
      ...process.env,
      ENVIRONMENT: environment,
      ...(isStaging ? {} : { ENV_FILE: ".env.local" }),
      POSTGRES_DSN: postgresDsn,
    },
    encoding: "utf8",
    timeout: 60000,
  });
  const evidence = sanitize({
    command,
    status: result.status,
    signal: result.signal,
    stdout: (result.stdout || "").slice(-2000),
    stderr: (result.stderr || "").slice(-2000),
  });
  workerEvidence.attempted.push(evidence);
  traceEvent("worker_once", evidence);
  return evidence;
}

function runGatewayPullHealthDogfood() {
  if (isStaging || process.env.POSTGRES_POOL_LEAK_SKIP_PULL_HEALTH === "1") {
    traceEvent("gateway_pull_health_dogfood_skipped", { environment });
    return { skipped: true };
  }
  const result = spawnSync(
    "npm",
    ["run", "e2e:gateway-pull-health-dogfood:local"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        SYNAPSE_E2E_ENV: "local",
        ALLOW_GCP_SECRET_MANAGER: "0",
        POSTGRES_POOL_MAX: String(expectedPoolMax),
        POSTGRES_POOL_TIMEOUT_SEC: String(
          process.env.POSTGRES_POOL_TIMEOUT_SEC || "2"
        ),
      },
      encoding: "utf8",
      timeout: 240000,
    }
  );
  const evidence = sanitize({
    skipped: false,
    status: result.status,
    signal: result.signal,
    stdoutTail: (result.stdout || "").slice(-2000),
    stderrTail: (result.stderr || "").slice(-2000),
  });
  traceEvent("gateway_pull_health_dogfood", evidence);
  return evidence;
}

function hasLongIdleInTx(snapshot, thresholdSec = longIdleInTxThresholdSec) {
  return (snapshot.rows || []).filter(
    (row) =>
      row.state === "idle in transaction" &&
      Number(row.xact_age_sec || row.state_age_sec || 0) > thresholdSec
  );
}

function assertPoolSnapshot(name, snapshot) {
  const pool = snapshot.postgresPool || {};
  const required = [
    "poolMax",
    "poolAvailable",
    "poolSize",
    "requestsWaiting",
    "closed",
  ];
  const missing = required.filter((key) => !(key in pool));
  const ok =
    snapshot.ok === true &&
    missing.length === 0 &&
    pool.closed === false &&
    Number(pool.poolMax) === expectedPoolMax;
  addCheck(
    name,
    ok,
    { snapshot, expectedPoolMax, missing },
    `readiness pool stats invalid: ${JSON.stringify({ pool, missing })}`
  );
}

function assertNoLongIdle(name, snapshot) {
  const offenders = hasLongIdleInTx(snapshot);
  addCheck(
    name,
    offenders.length === 0,
    {
      thresholdSec: longIdleInTxThresholdSec,
      offenders,
      total: snapshot.total,
    },
    `found long idle-in-transaction connections: ${JSON.stringify(offenders)}`
  );
}

function assertNoMonotonicGrowth() {
  const totals = pgSnapshots
    .filter((item) => /^restart_\d+$/.test(item.label))
    .map((item) => item.total);
  if (totals.length < Math.max(1, restartCount)) {
    addCheck(
      "restart_no_growth",
      false,
      { totals, restartCount },
      "missing restart pg_stat_activity snapshots"
    );
    return;
  }
  let strictlyIncreasing = totals.length > 1;
  for (let index = 1; index < totals.length; index += 1) {
    if (totals[index] <= totals[index - 1]) {
      strictlyIncreasing = false;
      break;
    }
  }
  const first = totals[0] ?? 0;
  const last = totals[totals.length - 1] ?? 0;
  addCheck(
    "restart_no_growth",
    !strictlyIncreasing && last <= first + steadyStateAllowance,
    { totals, first, last, steadyStateAllowance },
    `connection count grew across restarts: ${totals.join(" -> ")}`
  );
}

function assertPoolBound(name, snapshot) {
  const maxExpectedConnections = expectedPoolMax + steadyStateAllowance;
  addCheck(
    name,
    snapshot.total <= maxExpectedConnections,
    { total: snapshot.total, maxExpectedConnections, expectedPoolMax },
    `synapse-gateway connection count exceeded bound: total=${snapshot.total}, bound=${maxExpectedConnections}`
  );
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(sanitize(row))).join("\n") + "\n"
  );
}

function writeBugfixLog() {
  if (bugs.length === 0) {
    fs.writeFileSync(
      path.join(evidenceDir, "bugfix-log.md"),
      "# Postgres Pool Leak Dogfood Bugfix Log\n\nNo open bugs.\n"
    );
    return;
  }
  const lines = ["# Postgres Pool Leak Dogfood Bugfix Log", ""];
  for (const bug of bugs) {
    lines.push(`## ${bug.id} / ${bug.severity}`);
    lines.push(`- Scenario: ${bug.scenario}`);
    lines.push(`- Evidence: ${bug.evidence}`);
    lines.push(`- Repro Steps: ${bug.reproSteps}`);
    lines.push(`- Expected: ${bug.expected}`);
    lines.push(`- Actual: ${bug.actual}`);
    lines.push(`- Status: ${bug.status}`);
    lines.push("");
  }
  fs.writeFileSync(path.join(evidenceDir, "bugfix-log.md"), lines.join("\n"));
}

function writeEvidence(extra = {}) {
  writeJsonl(path.join(evidenceDir, "trace.jsonl"), trace);
  writeJsonl(
    path.join(evidenceDir, "readiness-snapshots.jsonl"),
    readinessSnapshots
  );
  writeJsonl(path.join(evidenceDir, "pg-stat-activity.jsonl"), pgSnapshots);
  fs.writeFileSync(
    path.join(evidenceDir, "worker-evidence.json"),
    `${JSON.stringify(sanitize(workerEvidence), null, 2)}\n`
  );
  writeBugfixLog();
  const traceDigest = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(evidenceDir, "trace.jsonl")))
    .digest("hex");
  const report = sanitize({
    runId,
    environment,
    status: failed.length === 0 ? "passed" : "failed",
    generatedAt: generatedAt.toISOString(),
    gatewayBaseUrl,
    expectedPoolMax,
    restartCount,
    concurrentRequests,
    pressureRounds,
    checks,
    failed,
    traceDigest,
    ...extra,
  });
  fs.writeFileSync(
    path.join(evidenceDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(evidenceDir, "report.md"),
    [
      "# Postgres Pool Leak Dogfood Report",
      "",
      `- Environment: ${environment}`,
      `- Status: ${report.status}`,
      `- Gateway: ${gatewayBaseUrl}`,
      `- Expected pool max: ${expectedPoolMax}`,
      `- Restarts: ${restartCount}`,
      `- Checks: ${checks.filter((item) => item.status === "passed").length}/${
        checks.length
      } passed`,
      "",
      "## Failed",
      ...(failed.length
        ? failed.map((item) => `- ${item.name}: ${item.failure}`)
        : ["- None"]),
      "",
    ].join("\n")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  traceEvent("start", {
    environment,
    gatewayBaseUrl,
    expectedPoolMax,
    restartCount,
    concurrentRequests,
    pressureRounds,
  });

  if (!isStaging) {
    restartGateway("initial_narrow_pool", {
      POSTGRES_POOL_MAX: String(expectedPoolMax),
      POSTGRES_POOL_TIMEOUT_SEC: String(
        process.env.POSTGRES_POOL_TIMEOUT_SEC || "2"
      ),
    });
    await waitForReadiness();
  }

  const baselineReadiness = await collectReadinessSnapshot("baseline");
  const baselinePg = collectPgSnapshot("baseline");
  assertPoolSnapshot("readiness_pool_stats", baselineReadiness);
  assertNoLongIdle("baseline_no_idle_in_transaction", baselinePg);
  assertPoolBound("baseline_pool_bound", baselinePg);

  for (let index = 0; index < restartCount; index += 1) {
    const restart = restartGateway(`restart_${index + 1}`, {
      POSTGRES_POOL_MAX: String(expectedPoolMax),
      POSTGRES_POOL_TIMEOUT_SEC: String(
        process.env.POSTGRES_POOL_TIMEOUT_SEC || "2"
      ),
    });
    if (restart.skipped) break;
    await waitForReadiness();
    await sleep(1000);
    const readiness = await collectReadinessSnapshot(`restart_${index + 1}`);
    const pg = collectPgSnapshot(`restart_${index + 1}`);
    assertPoolSnapshot(`restart_${index + 1}_pool_stats`, readiness);
    assertNoLongIdle(`restart_${index + 1}_no_idle_in_transaction`, pg);
    assertPoolBound(`restart_${index + 1}_pool_bound`, pg);
  }
  if (restartCount > 0) assertNoMonotonicGrowth();

  const pressureResults = await pressureReadOnlyEndpoints();
  const failedPressure = pressureResults.filter((item) => !item.ok);
  const finalPressurePg = collectPgSnapshot("pressure_final");
  addCheck(
    "narrow_pool_pressure",
    failedPressure.length === 0 &&
      finalPressurePg.total <= expectedPoolMax + steadyStateAllowance,
    {
      totalRequests: pressureResults.length,
      failedPressure: failedPressure.slice(0, 10),
      pgTotal: finalPressurePg.total,
      expectedPoolMax,
    },
    `read-only pressure failed or exceeded pool bound; failures=${failedPressure.length}, pgTotal=${finalPressurePg.total}`
  );
  assertNoLongIdle("pressure_no_idle_in_transaction", finalPressurePg);

  const pullHealthEvidence = runGatewayPullHealthDogfood();
  const afterPullHealthPg = collectPgSnapshot("after_gateway_pull_health");
  const pullHealthText = `${pullHealthEvidence.stdoutTail || ""}\n${
    pullHealthEvidence.stderrTail || ""
  }`;
  const onlyCredentialFixtureFailure =
    pullHealthEvidence.status !== 0 &&
    /local_agent_credential_available, llm_unavailable_no_hold/.test(
      pullHealthText
    );
  addCheck(
    "health_monitor_no_overlap",
    pullHealthEvidence.skipped === true ||
      pullHealthEvidence.status === 0 ||
      onlyCredentialFixtureFailure,
    pullHealthEvidence,
    "Gateway Pull Health dogfood failed before exercising the health monitor leak checkpoint."
  );
  assertNoLongIdle(
    "after_pull_health_no_idle_in_transaction",
    afterPullHealthPg
  );
  assertPoolBound("after_pull_health_pool_bound", afterPullHealthPg);

  for (const command of ["notification-outbox", "in-app-cleanup"]) {
    const before = collectPgSnapshot(`worker_${command}_before`);
    const result = runWorker(command);
    await sleep(1000);
    const after = collectPgSnapshot(`worker_${command}_after`);
    addCheck(
      `worker_${command}_exit_closes_pool`,
      [0, 1].includes(Number(result.status)) &&
        after.total <= before.total + expectedPoolMax + steadyStateAllowance,
      { beforeTotal: before.total, afterTotal: after.total, result },
      `worker ${command} did not exit cleanly or left unexpected connections.`
    );
    assertNoLongIdle(`worker_${command}_no_idle_in_transaction`, after);
  }

  await sleep(5000);
  const finalReadiness = await collectReadinessSnapshot("final");
  const finalPg = collectPgSnapshot("final");
  assertPoolSnapshot("final_readiness_pool_stats", finalReadiness);
  assertNoLongIdle("final_no_idle_in_transaction", finalPg);
  assertPoolBound("final_pool_bound", finalPg);
}

try {
  await main();
} catch (error) {
  addCheck(
    "runner_completed",
    false,
    { error: redact(error.stack || error.message) },
    error.message
  );
} finally {
  writeEvidence();
}

if (failed.length > 0) {
  console.error(
    `[postgres-pool-leak-dogfood] failed: ${failed
      .map((item) => item.name)
      .join(", ")}`
  );
  process.exit(1);
}

console.log(`[postgres-pool-leak-dogfood] evidence written to ${evidenceDir}`);
