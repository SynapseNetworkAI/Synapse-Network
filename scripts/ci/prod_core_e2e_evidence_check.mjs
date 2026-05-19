#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE_ROOT = path.join(ROOT, "docs/evidence/prod/core-e2e");
const REQUIRED_FILES = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "environment-manifest.json",
  "api-evidence.json",
  "sql-evidence.json",
  "chain-evidence.json",
];
const REQUIRED_SMOKE_CHECKS = [
  "public:user-front-home",
  "public:gateway-health",
  "public:admin-front-login",
  "public:admin-api-health",
  "public:docs-home",
  "public:docs-llms",
  "public:docs-openapi",
  "sql:canonical-provider-services",
];
const REQUIRED_SMALL_VALUE_CHECKS = [
  ...REQUIRED_SMOKE_CHECKS,
  "auth:siwe-domain",
  "credential:owned-by-test-wallet",
  "money:deposit-confirmed-once",
  "invoke:discover-service-live-price",
  "invoke:settled-db-evidence",
  "withdrawal:t7-not-bypassed",
];
const REQUIRED_FREE_INVOKE_CHECKS = [
  "public:user-front-home",
  "public:gateway-health",
  "public:admin-front-login",
  "public:admin-api-health",
  "public:docs-home",
  "public:docs-llms",
  "public:docs-openapi",
  "auth:siwe-domain",
  "invoke:discover-service-live-price",
  "invoke:free-service-price-zero",
  "invoke:response-has-invocation-id",
];

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  if (process.env.PROD_CORE_E2E_EVIDENCE_DIR) {
    return path.resolve(process.env.PROD_CORE_E2E_EVIDENCE_DIR);
  }
  if (!fs.existsSync(EVIDENCE_ROOT)) return "";
  return (
    fs
      .readdirSync(EVIDENCE_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(EVIDENCE_ROOT, entry.name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fatal(
      "PROD-CORE-E2E-EVIDENCE-002",
      filePath,
      `evidence JSON cannot be parsed: ${error.message}`,
      "rerun npm run e2e:prod-smoke-readonly, npm run e2e:prod-free-invoke, or npm run e2e:prod-core-small-value; do not hand-edit evidence."
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

function allEvidenceText(dir) {
  return REQUIRED_FILES.map((name) => {
    const filePath = path.join(dir, name);
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  }).join("\n");
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "PROD-CORE-E2E-EVIDENCE-001",
    "",
    "production core E2E evidence is missing.",
    "run npm run e2e:prod-smoke-readonly first; run free-invoke/small-value only with the explicit prod mutation confirmation."
  );
}

if (process.exitCode) process.exit(process.exitCode);

for (const fileName of REQUIRED_FILES) {
  const filePath = path.join(dir, fileName);
  if (!fs.existsSync(filePath)) {
    fatal(
      "PROD-CORE-E2E-EVIDENCE-003",
      filePath,
      `required production core artifact is missing: ${fileName}`,
      "rerun the production core E2E runner; do not assemble partial evidence by hand."
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);

const reportPath = path.join(dir, "report.json");
const report = readJson(reportPath);
if (!report) process.exit(process.exitCode || 1);

if (report.environment !== "prod") {
  fatal(
    "PROD-CORE-E2E-EVIDENCE-004",
    reportPath,
    `production core evidence must have environment=prod; actual=${report.environment}`,
    "rerun the prod runner against production endpoints only."
  );
}

if (!["smoke", "free-invoke", "small-value"].includes(report.mode)) {
  fatal(
    "PROD-CORE-E2E-EVIDENCE-005",
    reportPath,
    `invalid prod core evidence mode=${report.mode}`,
    "use npm run e2e:prod-smoke-readonly, npm run e2e:prod-free-invoke, or npm run e2e:prod-core-small-value."
  );
}

if (
  report.status !== "success" ||
  !Array.isArray(report.failed) ||
  report.failed.length > 0
) {
  fatal(
    "PROD-CORE-E2E-EVIDENCE-006",
    reportPath,
    `production core E2E failed; status=${
      report.status
    }; failed=${JSON.stringify(report.failed || []).slice(0, 800)}`,
    "fix the failing prod endpoint, SQL evidence, chain operation, or UI check and regenerate evidence."
  );
}

const generatedAt = Date.parse(report.generatedAt || "");
const maxAgeHours = Number(process.env.PROD_CORE_E2E_MAX_AGE_HOURS || "72");
const ageHours = (Date.now() - generatedAt) / 3_600_000;
if (
  !Number.isFinite(generatedAt) ||
  ageHours < -0.1 ||
  ageHours > maxAgeHours
) {
  fatal(
    "PROD-CORE-E2E-EVIDENCE-007",
    reportPath,
    `production core evidence is stale or invalid; age=${
      Number.isFinite(ageHours) ? ageHours.toFixed(2) : "invalid"
    }h, max=${maxAgeHours}h`,
    "rerun the production core E2E runner to produce fresh evidence."
  );
}

const requiredChecks =
  report.mode === "small-value"
    ? REQUIRED_SMALL_VALUE_CHECKS
    : report.mode === "free-invoke"
    ? REQUIRED_FREE_INVOKE_CHECKS
    : REQUIRED_SMOKE_CHECKS;
const checks = new Map(
  (report.checks || []).map((check) => [check.name, check])
);
for (const name of requiredChecks) {
  const check = checks.get(name);
  if (!check || check.ok !== true) {
    fatal(
      "PROD-CORE-E2E-EVIDENCE-008",
      reportPath,
      `required production core check is missing or failed: ${name}`,
      "rerun the prod runner with all required configuration."
    );
  }
}

const tracePath = path.join(dir, "trace.jsonl");
if (!report.traceDigest || report.traceDigest !== sha256File(tracePath)) {
  fatal(
    "PROD-CORE-E2E-EVIDENCE-009",
    tracePath,
    "trace digest does not match report.json traceDigest.",
    "rerun the production core E2E runner so trace and report are generated together."
  );
}

const traceRows = fs
  .readFileSync(tracePath, "utf8")
  .split(/\r?\n/)
  .filter(Boolean);
if (traceRows.length <= 0) {
  fatal(
    "PROD-CORE-E2E-EVIDENCE-010",
    tracePath,
    "trace.jsonl must contain at least one checkpoint.",
    "rerun the production core E2E runner."
  );
}

const text = allEvidenceText(dir);
const leakPatterns = [
  /\bagt_(?!\[REDACTED\])[A-Za-z0-9._~+/-]{8,}/,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /"(?:privateKey|rawSignature|jwt|adminToken|accessToken|apiKey|secret|password|token|authorization)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i,
];
for (const pattern of leakPatterns) {
  if (pattern.test(text)) {
    fatal(
      "PROD-CORE-E2E-EVIDENCE-011",
      dir,
      `production core evidence appears to contain a secret-like value matching ${pattern}`,
      "redact private keys, agent credentials, tokens, signatures, and passwords at generation time and rerun evidence."
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);

console.log(`[ci:prod-core-e2e-evidence] validated ${dir}`);
