#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const environment = (
  process.env.POSTGRES_POOL_LEAK_ENV ||
  process.env.SYNAPSE_E2E_ENV ||
  "local"
)
  .trim()
  .toLowerCase();

const requiredFiles = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "bugfix-log.md",
  "pg-stat-activity.jsonl",
  "readiness-snapshots.jsonl",
  "worker-evidence.json",
];
const idleInTxThresholdSec = Number(
  process.env.POSTGRES_POOL_LEAK_IDLE_IN_TX_THRESHOLD_SEC ||
    (environment === "staging" ? 30 : 5)
);

function evidenceRoot() {
  if (process.env.POSTGRES_POOL_LEAK_EVIDENCE_DIR) {
    return path.resolve(process.env.POSTGRES_POOL_LEAK_EVIDENCE_DIR);
  }
  if (environment === "staging") {
    return path.join(ROOT, "docs/evidence/staging/postgres-pool-leak");
  }
  return path.join(ROOT, "output/dogfood/postgres-pool-leak");
}

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  const root = evidenceRoot();
  if (process.env.POSTGRES_POOL_LEAK_EVIDENCE_DIR) return root;
  if (!fs.existsSync(root)) return "";
  return (
    fs
      .readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && entry.name.endsWith(`-${environment}`)
      )
      .map((entry) => path.join(root, entry.name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fatal(
      "POSTGRES-POOL-LEAK-EVIDENCE-JSON",
      filePath,
      `cannot parse JSON: ${error.message}`,
      "rerun the dogfood runner; do not hand-edit evidence."
    );
    return null;
  }
}

function readJsonl(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        fatal(
          "POSTGRES-POOL-LEAK-EVIDENCE-JSONL",
          `${filePath}:${index + 1}`,
          `cannot parse JSONL: ${error.message}`,
          "rerun the dogfood runner so JSONL evidence is generated atomically."
        );
        return null;
      }
    })
    .filter(Boolean);
}

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function checkRequiredFiles(dir) {
  for (const fileName of requiredFiles) {
    const filePath = path.join(dir, fileName);
    if (!fs.existsSync(filePath)) {
      fatal(
        "POSTGRES-POOL-LEAK-EVIDENCE-FILE",
        filePath,
        `required artifact is missing: ${fileName}`,
        "rerun the Postgres pool leak dogfood E2E and checker together."
      );
    }
  }
}

function assertCheck(report, name) {
  const check = (report.checks || []).find((item) => item.name === name);
  if (!check || check.status !== "passed") {
    fatal(
      "POSTGRES-POOL-LEAK-EVIDENCE-CHECK",
      "report.json",
      `required check is missing or failed: ${name}`,
      "fix the pool lifecycle behavior or runner checkpoint and regenerate evidence."
    );
  }
}

function validateReadinessSnapshots(rows, expectedPoolMax) {
  if (!rows.length) {
    fatal(
      "POSTGRES-POOL-LEAK-READINESS-MISSING",
      "readiness-snapshots.jsonl",
      "no readiness snapshots were captured.",
      "rerun the dogfood runner after Gateway is reachable."
    );
    return;
  }
  for (const row of rows) {
    const pool = row.postgresPool || {};
    for (const key of [
      "poolMax",
      "poolAvailable",
      "poolSize",
      "requestsWaiting",
      "closed",
    ]) {
      if (!(key in pool)) {
        fatal(
          "POSTGRES-POOL-LEAK-READINESS-POOL-FIELD",
          "readiness-snapshots.jsonl",
          `readiness snapshot ${
            row.label || "<unknown>"
          } missing postgresPool.${key}`,
          "ensure /readiness exposes DatabaseManager.stats()."
        );
      }
    }
    if (pool.closed !== false) {
      fatal(
        "POSTGRES-POOL-LEAK-POOL-CLOSED",
        "readiness-snapshots.jsonl",
        `readiness snapshot ${row.label || "<unknown>"} has closed=${
          pool.closed
        }`,
        "Gateway readiness should be captured while the pool is open."
      );
    }
    if (Number(pool.poolMax) !== Number(expectedPoolMax)) {
      fatal(
        "POSTGRES-POOL-LEAK-POOL-MAX",
        "readiness-snapshots.jsonl",
        `expected poolMax=${expectedPoolMax}, got ${pool.poolMax} at ${
          row.label || "<unknown>"
        }`,
        "rerun with the intended POSTGRES_POOL_MAX or fix settings propagation."
      );
    }
  }
}

function validatePgSnapshots(rows, expectedPoolMax) {
  if (!rows.length) {
    fatal(
      "POSTGRES-POOL-LEAK-PG-ACTIVITY-MISSING",
      "pg-stat-activity.jsonl",
      "no pg_stat_activity snapshots were captured.",
      "ensure psql can connect to the target Postgres DSN."
    );
    return;
  }
  const bound = Number(expectedPoolMax) + 1;
  for (const row of rows) {
    const offenders = (row.rows || []).filter(
      (item) =>
        item.state === "idle in transaction" &&
        Number(item.xact_age_sec || item.state_age_sec || 0) >
          idleInTxThresholdSec
    );
    if (offenders.length) {
      fatal(
        "POSTGRES-POOL-LEAK-IDLE-IN-TX",
        "pg-stat-activity.jsonl",
        `snapshot ${
          row.label || "<unknown>"
        } has idle-in-transaction rows older than ${idleInTxThresholdSec}s: ${JSON.stringify(
          offenders
        ).slice(0, 600)}`,
        "close cursors/transactions and ensure DatabaseManager rolls back before returning connections."
      );
    }
    if (Number(row.total) > bound) {
      fatal(
        "POSTGRES-POOL-LEAK-POOL-BOUND",
        "pg-stat-activity.jsonl",
        `snapshot ${row.label || "<unknown>"} has ${
          row.total
        } synapse-gateway connections; bound is ${bound}`,
        "fix connection returns or lower concurrency; do not increase POSTGRES_POOL_MAX to hide leaks."
      );
    }
  }

  const restartTotals = rows
    .filter((row) => /^restart_\d+$/.test(row.label || ""))
    .map((row) => Number(row.total || 0));
  if (restartTotals.length > 1) {
    let strictlyIncreasing = true;
    for (let index = 1; index < restartTotals.length; index += 1) {
      if (restartTotals[index] <= restartTotals[index - 1]) {
        strictlyIncreasing = false;
        break;
      }
    }
    if (strictlyIncreasing) {
      fatal(
        "POSTGRES-POOL-LEAK-MONOTONIC-GROWTH",
        "pg-stat-activity.jsonl",
        `restart connection counts are strictly increasing: ${restartTotals.join(
          " -> "
        )}`,
        "ensure Gateway shutdown closes storage and psycopg_pool before starting the next process."
      );
    }
  }
}

function validateNoOpenBugs(dir) {
  const bugfix = fs.readFileSync(path.join(dir, "bugfix-log.md"), "utf8");
  if (!/No open bugs\./.test(bugfix) || /Status:\s*open/i.test(bugfix)) {
    fatal(
      "POSTGRES-POOL-LEAK-BUGFIX-OPEN",
      "bugfix-log.md",
      "bugfix log contains open failures or does not explicitly state no open bugs.",
      "fix failures, rerun the dogfood E2E, and regenerate evidence."
    );
  }
}

function validateSecretScan(dir) {
  const text = requiredFiles
    .map((fileName) => fs.readFileSync(path.join(dir, fileName), "utf8"))
    .join("\n");
  const patterns = [
    /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
    /\b0x[a-fA-F0-9]{64,}\b/,
    /agt_[A-Za-z0-9._~+/-]{12,}/i,
    /postgres(?:ql)?:\/\/[^@\s]+@/i,
    /"(?:privateKey|rawSignature|jwt|adminToken|accessToken|apiKey|secret|password|token|credential)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i,
  ];
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      fatal(
        "POSTGRES-POOL-LEAK-EVIDENCE-SECRET",
        dir,
        `evidence appears to contain a secret-like value matching ${pattern}`,
        "redact credentials, private keys, DB URLs, and tokens before writing evidence."
      );
    }
  }
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "POSTGRES-POOL-LEAK-EVIDENCE-MISSING",
    "",
    `no Postgres pool leak dogfood evidence found for environment=${environment}`,
    `run npm run e2e:postgres-pool-leak:${environment} first.`
  );
}
if (process.exitCode) process.exit(process.exitCode);

checkRequiredFiles(dir);
if (process.exitCode) process.exit(process.exitCode);

const report = readJson(path.join(dir, "report.json"));
const readinessRows = readJsonl(path.join(dir, "readiness-snapshots.jsonl"));
const pgRows = readJsonl(path.join(dir, "pg-stat-activity.jsonl"));
const workerEvidence = readJson(path.join(dir, "worker-evidence.json"));
if (!report || !workerEvidence) process.exit(process.exitCode || 1);

if (report.environment !== environment) {
  fatal(
    "POSTGRES-POOL-LEAK-EVIDENCE-ENV",
    "report.json",
    `environment mismatch: expected=${environment}, actual=${report.environment}`,
    "rerun the checker with the same POSTGRES_POOL_LEAK_ENV used by the runner."
  );
}
if (
  report.status !== "passed" ||
  !Array.isArray(report.failed) ||
  report.failed.length > 0
) {
  fatal(
    "POSTGRES-POOL-LEAK-EVIDENCE-FAILED",
    "report.json",
    `report status=${report.status}; failed=${JSON.stringify(
      report.failed || []
    ).slice(0, 800)}`,
    "fix failed checkpoints and regenerate evidence."
  );
}
const tracePath = path.join(dir, "trace.jsonl");
if (!report.traceDigest || report.traceDigest !== sha256File(tracePath)) {
  fatal(
    "POSTGRES-POOL-LEAK-TRACE-DIGEST",
    tracePath,
    "trace digest does not match report.json.",
    "rerun the dogfood runner so trace and report are generated together."
  );
}

for (const checkName of [
  "readiness_pool_stats",
  "restart_no_growth",
  "narrow_pool_pressure",
  "health_monitor_no_overlap",
  "final_no_idle_in_transaction",
  "final_pool_bound",
]) {
  assertCheck(report, checkName);
}
if (environment === "local") {
  assertCheck(report, "worker_notification-outbox_exit_closes_pool");
  assertCheck(report, "worker_in-app-cleanup_exit_closes_pool");
}

validateReadinessSnapshots(readinessRows, report.expectedPoolMax);
validatePgSnapshots(pgRows, report.expectedPoolMax);
validateNoOpenBugs(dir);
validateSecretScan(dir);

if (process.exitCode) process.exit(process.exitCode);
console.log(`[ci:postgres-pool-leak-evidence] validated ${dir}`);
