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
  "gateway-e2e.log",
  "environment-manifest.json",
  "contract-manifest.json",
  "analytics-clickhouse-summary.json",
  "reconciliation-summary.json",
];

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

function digest(report) {
  return crypto.createHash("sha256").update(JSON.stringify(stable({
    scriptVersion: report.scriptVersion,
    environment: report.environment,
    contract: report.contract,
    analytics: report.analytics,
    pytest: report.pytest,
    comparisons: report.comparisons,
    failed: report.failed,
  }))).digest("hex");
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

if (!report.pytest || report.pytest.tests < 78) {
  fatal(
    "GATEWAY-RELEASE-EVIDENCE-005",
    reportPath,
    `expected at least 78 gateway e2e tests; actual=${report.pytest?.tests}`,
    "rerun the full services/gateway/tests/e2e suite and ensure no test module was filtered out.",
  );
}

if (!report.analytics || Number(report.analytics.totalEvents || 0) <= 0 || (report.analytics.errors || []).length > 0) {
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

if (process.exitCode) process.exit(process.exitCode);

console.log(`[gateway-release-evidence] passed: ${reportPath}`);
console.log(`[gateway-release-evidence] environment=${report.environment?.environment}`);
console.log(`[gateway-release-evidence] tests=${report.pytest.tests} skipped=${report.pytest.skipped}`);
