#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const REQUIRED_FILES = [
  "report.md",
  "report.json",
  "pytest-junit.xml",
  "trace.jsonl",
  "gateway-e2e.log",
  "environment-manifest.json",
  "contract-manifest.json",
  "analytics-clickhouse-summary.json",
  "reconciliation-summary.json",
  "job-execution-summary.json",
];
const REQUIRED_TRACE_SCENARIOS = [
  "deposit",
  "confirm",
  "service_discovery",
  "quote",
  "invoke",
  "provider_credit",
  "receipt",
  "consumer_withdrawal",
  "analytics_kafka_clickhouse",
  "ledger_vault_reconciliation",
];
const MVP_POSTGRES_TRACE_SCENARIOS = REQUIRED_TRACE_SCENARIOS.filter((scenario) => scenario !== "analytics_kafka_clickhouse");

function latestReportPath() {
  if (process.env.GATEWAY_RELEASE_E2E_EVIDENCE_DIR) {
    return path.join(path.resolve(process.env.GATEWAY_RELEASE_E2E_EVIDENCE_DIR), "report.json");
  }
  if (process.env.GATEWAY_RELEASE_E2E_REPORT) {
    return path.resolve(process.env.GATEWAY_RELEASE_E2E_REPORT);
  }
  const base = path.join(ROOT, "docs/evidence/release/gateway-fullchain");
  if (!fs.existsSync(base)) return "";
  return fs.readdirSync(base)
    .map((name) => path.join(base, name, "report.json"))
    .filter((filePath) => fs.existsSync(filePath))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || "";
}

function sha256Json(payload) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload, Object.keys(payload).sort()))
    .digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function digest(report) {
  return crypto.createHash("sha256").update(JSON.stringify(stable({
    scriptVersion: report.scriptVersion,
    profile: report.profile,
    minimumExpectedTests: report.minimumExpectedTests,
    environment: report.environment,
    contract: report.contract,
    analytics: report.analytics,
    jobExecution: report.jobExecution,
    pytest: report.pytest,
    comparisons: report.comparisons,
    traceDigest: report.traceDigest,
    failed: report.failed,
  }))).digest("hex");
}

function scanTraceForSecrets(traceText) {
  const patterns = [
    /\bauthorization\s*[:=]\s*(?!\[REDACTED\])\S+/i,
    /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
    /"(?:privateKey|rawSignature|signature|jwt|adminToken|accessToken|apiKey|secret)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i,
    /\b(?:private[_-]?key|raw[_-]?signature|admin[_-]?token|access[_-]?token|api[_-]?key|secret)\s*[:=]\s*(?!\[REDACTED\])\S+/i,
  ];
  return patterns.filter((pattern) => pattern.test(traceText)).map((pattern) => String(pattern));
}

function parseTraceJsonl(tracePath) {
  return fs.readFileSync(tracePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        fatal(
          "GATEWAY-RELEASE-EVIDENCE-012",
          `${tracePath}:${index + 1}`,
          `trace.jsonl line is not valid JSON: ${error.message}`,
          "rerun the gateway release evidence generator; do not hand-edit trace.jsonl.",
        );
        return null;
      }
    })
    .filter(Boolean);
}

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

const reportPath = latestReportPath();
if (!reportPath) {
  fatal(
    "GATEWAY-RELEASE-EVIDENCE-001",
    "",
    "gateway release full-chain E2E evidence is missing.",
    "run npm run release:evidence:gateway-fullchain:local for rehearsal or release:evidence:gateway-fullchain:staging for release evidence.",
  );
}

if (process.exitCode) process.exit(process.exitCode);

const outDir = path.dirname(reportPath);
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const requiredEnvironment = process.env.GATEWAY_RELEASE_E2E_REQUIRED_ENV;
const profile = report.profile || report.environment?.profile || "full";
const requiredTraceScenarios = profile === "mvp-postgres" ? MVP_POSTGRES_TRACE_SCENARIOS : REQUIRED_TRACE_SCENARIOS;
const minimumExpectedTests = Number(report.minimumExpectedTests || (profile === "mvp-postgres" ? 50 : 78));

for (const name of REQUIRED_FILES) {
  const filePath = path.join(outDir, name);
  if (!fs.existsSync(filePath)) {
    fatal(
      "GATEWAY-RELEASE-EVIDENCE-002",
      filePath,
      `required evidence artifact is missing: ${name}`,
      "rerun the gateway release evidence runner; do not hand-assemble partial evidence.",
    );
  }
}

if (report.status !== "success" || (Array.isArray(report.failed) && report.failed.length > 0)) {
  fatal(
    "GATEWAY-RELEASE-EVIDENCE-003",
    reportPath,
    `report status is ${report.status}; failures=${JSON.stringify(report.failed || []).slice(0, 800)}`,
    "fix the failing gateway E2E chain and regenerate the release evidence report.",
  );
}

if (requiredEnvironment && report.environment?.environment !== requiredEnvironment) {
  fatal(
    "GATEWAY-RELEASE-EVIDENCE-009",
    reportPath,
    `release evidence environment mismatch; required=${requiredEnvironment}, actual=${report.environment?.environment}`,
    "rerun the gateway release evidence runner against the required environment, or set GATEWAY_RELEASE_E2E_EVIDENCE_DIR to the correct report directory.",
  );
}

if (!report.pytest || report.pytest.skipped !== 0) {
  fatal(
    "GATEWAY-RELEASE-EVIDENCE-004",
    reportPath,
    `release gateway E2E must have zero skipped tests; actual=${report.pytest?.skipped}`,
    "start missing live services or fix release-mode pytest gates so failures fail closed instead of skip.",
  );
}

if (!report.jobExecution || typeof report.jobExecution !== "object") {
  fatal(
    "GATEWAY-RELEASE-EVIDENCE-011",
    reportPath,
    "job execution evidence is missing from report.json.",
    "rerun the gateway release evidence reporter so deposit indexing SLA and scheduled job lock skip summary are captured.",
  );
}

if (!report.pytest || report.pytest.tests < minimumExpectedTests) {
  fatal(
    "GATEWAY-RELEASE-EVIDENCE-005",
    reportPath,
    `expected at least ${minimumExpectedTests} gateway e2e tests for profile=${profile}; actual=${report.pytest?.tests}`,
    "rerun the full services/gateway/tests/e2e suite and ensure no test module was filtered out.",
  );
}

if (profile === "mvp-postgres") {
  if (!report.analytics || report.analytics.mode !== "postgres-outbox" || (report.analytics.errors || []).length > 0) {
    fatal(
      "GATEWAY-RELEASE-EVIDENCE-006",
      reportPath,
      "Postgres outbox analytics evidence is missing or errored for mvp-postgres profile.",
      "rerun the gateway release evidence with GATEWAY_RELEASE_E2E_PROFILE=mvp-postgres and verify Postgres outbox/projection mode.",
    );
  }
} else if (!report.analytics || Number(report.analytics.totalEvents || 0) <= 0 || (report.analytics.errors || []).length > 0) {
  fatal(
    "GATEWAY-RELEASE-EVIDENCE-006",
    reportPath,
    "ClickHouse analytics evidence is missing or errored.",
    "start Kafka and ClickHouse, run with ANALYTICS_TEST_E2E=true, and regenerate evidence.",
  );
}

if (!Array.isArray(report.comparisons) || report.comparisons.some((row) => row.pass !== true)) {
  fatal(
    "GATEWAY-RELEASE-EVIDENCE-007",
    reportPath,
    "one or more expected-vs-actual comparisons failed.",
    "inspect report.md, fix the underlying gateway full-chain break, and rerun the evidence runner.",
  );
}

if (!report.evidenceDigest || report.evidenceDigest !== digest(report)) {
  fatal(
    "GATEWAY-RELEASE-EVIDENCE-008",
    reportPath,
    "evidence digest cannot be recomputed from report payload.",
    "do not hand-edit report.json; rerun the gateway release evidence generator.",
  );
}

const tracePath = path.join(outDir, "trace.jsonl");
const traceText = fs.readFileSync(tracePath, "utf8");
const traceDigest = sha256File(tracePath);
if (!report.traceDigest || report.traceDigest !== traceDigest) {
  fatal(
    "GATEWAY-RELEASE-EVIDENCE-010",
    tracePath,
    "trace digest does not match report.json traceDigest.",
    "rerun the gateway release evidence generator so report.json and trace.jsonl are bound together.",
  );
}

const secretFindings = scanTraceForSecrets(traceText);
if (secretFindings.length > 0) {
  fatal(
    "GATEWAY-RELEASE-EVIDENCE-011",
    tracePath,
    `trace.jsonl contains secret-like values: ${secretFindings.join(", ")}`,
    "redact authorization headers, private keys, raw signatures, API keys, and tokens before writing release evidence.",
  );
}

const traceRows = parseTraceJsonl(tracePath);
if (traceRows.length <= 0) {
  fatal(
    "GATEWAY-RELEASE-EVIDENCE-013",
    tracePath,
    "trace.jsonl must contain at least one evidence checkpoint.",
    "rerun the gateway release evidence generator with trace output enabled.",
  );
}

const traceScenarios = new Set(traceRows.map((row) => String(row.scenario || "")));
for (const scenario of requiredTraceScenarios) {
  if (!traceScenarios.has(scenario)) {
    fatal(
      "GATEWAY-RELEASE-EVIDENCE-014",
      tracePath,
      `trace.jsonl is missing a checkpoint for core scenario ${scenario}.`,
      "ensure the gateway release evidence reporter writes one trace row for every core scenario.",
    );
  }
}

const failedTrace = traceRows.filter((row) => String(row.reconciliationStatus || "").toLowerCase() === "failed");
if (failedTrace.length > 0) {
  fatal(
    "GATEWAY-RELEASE-EVIDENCE-015",
    tracePath,
    `trace.jsonl contains failed reconciliation checkpoints: ${failedTrace.slice(0, 5).map((row) => row.scenario).join(", ")}`,
    "fix the expected-vs-actual mismatch and regenerate gateway release evidence.",
  );
}

if (process.exitCode) process.exit(process.exitCode);

console.log(`[gateway-release-evidence] passed: ${reportPath}`);
console.log(`[gateway-release-evidence] environment=${report.environment?.environment}`);
console.log(`[gateway-release-evidence] profile=${profile}`);
console.log(`[gateway-release-evidence] tests=${report.pytest.tests} skipped=${report.pytest.skipped}`);
