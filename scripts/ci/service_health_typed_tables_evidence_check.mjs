#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const environment = (
  process.env.SERVICE_HEALTH_TYPED_TABLES_ENV ||
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
  "sql-timing-evidence.json",
  "api-evidence.json",
  "db-evidence.json",
  "business-regression-evidence.json",
];

function evidenceRoot() {
  if (process.env.SERVICE_HEALTH_TYPED_TABLES_EVIDENCE_DIR) {
    return path.resolve(process.env.SERVICE_HEALTH_TYPED_TABLES_EVIDENCE_DIR);
  }
  if (environment === "staging") {
    return path.join(ROOT, "docs/evidence/staging/service-health-typed-tables");
  }
  return path.join(ROOT, "output/dogfood/service-health-typed-tables");
}

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  const root = evidenceRoot();
  if (process.env.SERVICE_HEALTH_TYPED_TABLES_EVIDENCE_DIR) return root;
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
      "SERVICE-HEALTH-TYPED-EVIDENCE-JSON",
      filePath,
      `cannot parse JSON: ${error.message}`,
      "rerun the typed health tables E2E; do not hand-edit evidence."
    );
    return null;
  }
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
        "SERVICE-HEALTH-TYPED-EVIDENCE-FILE",
        filePath,
        `required artifact is missing: ${fileName}`,
        "rerun npm run e2e:service-health-typed-tables:<env>."
      );
    }
  }
}

function assertCheck(report, name) {
  const check = (report.checks || []).find((item) => item.name === name);
  if (!check || check.status !== "passed") {
    fatal(
      "SERVICE-HEALTH-TYPED-CHECK",
      "report.json",
      `required check is missing or failed: ${name}`,
      "fix the typed health table behavior or runner checkpoint and regenerate evidence."
    );
  }
}

function measurementByName(sqlTiming) {
  return new Map(
    (sqlTiming.measurements || []).map((item) => [item.name, item])
  );
}

function assertSqlMeasurementPassed(byName, name) {
  const item = byName.get(name);
  if (!item || Number(item.status) !== 0) {
    fatal(
      "SERVICE-HEALTH-TYPED-SQL-TIMING",
      "sql-timing-evidence.json",
      `missing or failed SQL timing measurement: ${name}`,
      "rerun the E2E with a reachable Postgres DSN and valid typed health schema."
    );
  }
}

function assertTypedRuntimeRows(typed) {
  if (Number(typed.rowCount || 0) <= 0) {
    fatal(
      "SERVICE-HEALTH-TYPED-RUNTIME-EMPTY",
      "sql-timing-evidence.json",
      "typed runtime query returned no rows.",
      "run health refresh or fix typed runtime upsert before comparing performance."
    );
  }
}

function assertTypedRuntimePerformance({ legacy, typed }) {
  const legacyRows = Number(legacy.rowCount || 0);
  const typedDuration = Number(typed.durationMs || 0);
  const legacyDuration = Number(legacy.durationMs || 0);
  const typedWithinBudget =
    typedDuration <= 100 || typedDuration <= legacyDuration * 0.5;

  if (legacyRows > 0 && !typedWithinBudget) {
    fatal(
      "SERVICE-HEALTH-TYPED-PERF-REGRESSION",
      "sql-timing-evidence.json",
      `typed runtime duration ${typedDuration}ms is not <=100ms and not <=50% of legacy ${legacyDuration}ms.`,
      "inspect query plan, typed table indexes, and runtime table row count."
    );
  }
}

function validateSqlTiming(sqlTiming) {
  const byName = measurementByName(sqlTiming);
  for (const name of [
    "legacy_kv_baseline",
    "typed_runtime",
    "typed_events_recent",
  ]) {
    assertSqlMeasurementPassed(byName, name);
  }
  const legacy = byName.get("legacy_kv_baseline") || {};
  const typed = byName.get("typed_runtime") || {};
  assertTypedRuntimeRows(typed);
  assertTypedRuntimePerformance({ legacy, typed });
}

function validateDbEvidence(db) {
  const before = db.snapshots?.before;
  const afterRefresh = db.snapshots?.after_refresh;
  const afterCleanup = db.snapshots?.after_cleanup;
  if (!before || !afterRefresh || !afterCleanup) {
    fatal(
      "SERVICE-HEALTH-TYPED-DB-SNAPSHOTS",
      "db-evidence.json",
      "before/after_refresh/after_cleanup snapshots are required.",
      "rerun the E2E so DB checkpoints are emitted around refresh and cleanup."
    );
    return;
  }
  const expected = Number((db.expectedServiceIds || []).length);
  if (Number(afterRefresh.typedRuntimeRows || 0) < expected) {
    fatal(
      "SERVICE-HEALTH-TYPED-RUNTIME-COUNT",
      "db-evidence.json",
      `expected at least ${expected} typed runtime rows, got ${afterRefresh.typedRuntimeRows}.`,
      "ensure canonical provider services are healthy and health refresh writes typed runtime rows."
    );
  }
  if (Number(afterCleanup.expectedManifests || 0) !== expected) {
    fatal(
      "SERVICE-HEALTH-TYPED-CLEANUP-REGISTRATION-LOSS",
      "db-evidence.json",
      "expected manifests were lost after legacy KV cleanup.",
      "fix cleanup scope; it must delete only service_health_% runtime cache rows."
    );
  }
}

function validateBusinessEvidence(business) {
  const fixed = business.fixedInvoke || {};
  if (
    fixed.attempted &&
    String(fixed.response?.status || "").toUpperCase() !== "SUCCEEDED"
  ) {
    fatal(
      "SERVICE-HEALTH-TYPED-FIXED-INVOKE",
      "business-regression-evidence.json",
      `fixed invoke was attempted but did not succeed: ${JSON.stringify(
        fixed.response || {}
      ).slice(0, 300)}`,
      "fix provider health/discovery/invoke billing regression and rerun the gate."
    );
  }
  if (!fixed.attempted && !fixed.skippedWithReason) {
    fatal(
      "SERVICE-HEALTH-TYPED-FIXED-INVOKE-MISSING",
      "business-regression-evidence.json",
      "fixed invoke neither ran nor recorded an explicit skip reason.",
      "set a staging/local E2E agent credential or record why invoke is intentionally skipped."
    );
  }
}

function validateSecretLeak(dir) {
  const combined = requiredFiles
    .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
    .join("\n");
  const patterns = [
    /postgres(?:ql)?:\/\/[^@\s]+@/i,
    /Bearer\s+[A-Za-z0-9._~+/-]+=*/i,
    /\bagt_[A-Za-z0-9._~+/-]{16,}/i,
    /\b0x[a-fA-F0-9]{64}\b/,
    /"(?:password|privateKey|apiKey|secret|token|credential)"\s*:\s*"(?!\[REDACTED\])/i,
  ];
  for (const pattern of patterns) {
    if (pattern.test(combined)) {
      fatal(
        "SERVICE-HEALTH-TYPED-SECRET-LEAK",
        dir,
        `evidence appears to contain secret-like material matching ${pattern}.`,
        "redact the runner output and regenerate evidence; never commit raw secrets."
      );
    }
  }
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "SERVICE-HEALTH-TYPED-EVIDENCE-MISSING",
    evidenceRoot(),
    "no service health typed tables evidence directory found.",
    `run npm run e2e:service-health-typed-tables:${environment} first.`
  );
  process.exit(process.exitCode || 1);
}

checkRequiredFiles(dir);
const report = readJson(path.join(dir, "report.json")) || {};
const sqlTiming = readJson(path.join(dir, "sql-timing-evidence.json")) || {};
const db = readJson(path.join(dir, "db-evidence.json")) || {};
const business =
  readJson(path.join(dir, "business-regression-evidence.json")) || {};
const traceDigest = sha256File(path.join(dir, "trace.jsonl"));
const bugfixLog = fs.readFileSync(path.join(dir, "bugfix-log.md"), "utf8");

if (report.traceDigest !== traceDigest) {
  fatal(
    "SERVICE-HEALTH-TYPED-TRACE-DIGEST",
    "report.json",
    "report traceDigest does not match trace.jsonl.",
    "rerun the E2E; do not hand-edit report.json or trace.jsonl independently."
  );
}
if ((report.failed || []).length > 0 || report.status !== "success") {
  fatal(
    "SERVICE-HEALTH-TYPED-FAILED",
    "report.json",
    `runner reported failed checks: ${(report.failed || [])
      .map((item) => item.name)
      .join(", ")}`,
    "fix failing checks and regenerate evidence."
  );
}
if (/OPEN:/i.test(bugfixLog)) {
  fatal(
    "SERVICE-HEALTH-TYPED-BUGFIX-OPEN",
    "bugfix-log.md",
    "bugfix log contains open items.",
    "fix or explicitly close all bugfix-log items before accepting evidence."
  );
}

for (const name of [
  "health_hot_path_legacy_kv_absent",
  environment === "staging"
    ? "typed_runtime_present_staging"
    : "typed_runtime_updated_after_health_refresh",
  "same_status_probe_does_not_append_events",
  "registered_services_survive_cleanup",
]) {
  assertCheck(report, name);
}

validateSqlTiming(sqlTiming);
validateDbEvidence(db);
validateBusinessEvidence(business);
validateSecretLeak(dir);

if (process.exitCode) process.exit(process.exitCode);
console.log(`[ci:service-health-typed-tables-evidence] validated ${dir}`);
