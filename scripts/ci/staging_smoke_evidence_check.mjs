#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE_ROOT = path.join(ROOT, "docs/evidence/staging/smoke");
const REQUIRED_FILES = ["report.json", "report.md", "trace.jsonl", "environment-manifest.json"];
const REQUIRED_CHECKS = [
  "gateway_health",
  "gateway_readiness",
  "gateway_service_discovery",
  "gateway_admin_health",
  "user_front_home",
  "admin_front_login",
  "gateway_cors_user_front",
  "gateway_admin_cors_admin_front",
  "arbitrum_sepolia_rpc",
  "contract_bytecode_SynapseCore",
  "contract_bytecode_MockUSDC",
];

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  if (process.env.STAGING_SMOKE_EVIDENCE_DIR) return path.resolve(process.env.STAGING_SMOKE_EVIDENCE_DIR);
  if (!fs.existsSync(EVIDENCE_ROOT)) return "";
  return fs.readdirSync(EVIDENCE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("-staging-smoke"))
    .map((entry) => path.join(EVIDENCE_ROOT, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || "";
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fatal(
      "STAGING-SMOKE-EVIDENCE-002",
      filePath,
      `evidence JSON cannot be parsed: ${error.message}`,
      "rerun npm run e2e:staging-smoke instead of hand-editing evidence.",
    );
    return null;
  }
}

function allEvidenceText(dir) {
  return REQUIRED_FILES
    .map((name) => {
      const filePath = path.join(dir, name);
      return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
    })
    .join("\n");
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "STAGING-SMOKE-EVIDENCE-001",
    "",
    "staging smoke evidence is missing.",
    "run npm run e2e:staging-smoke and then rerun npm run ci:staging-smoke-evidence.",
  );
}

if (process.exitCode) process.exit(process.exitCode);

for (const fileName of REQUIRED_FILES) {
  const filePath = path.join(dir, fileName);
  if (!fs.existsSync(filePath)) {
    fatal(
      "STAGING-SMOKE-EVIDENCE-003",
      filePath,
      `required staging smoke artifact is missing: ${fileName}`,
      "rerun npm run e2e:staging-smoke; do not assemble partial evidence by hand.",
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);

const reportPath = path.join(dir, "report.json");
const report = readJson(reportPath);
if (!report) process.exit(process.exitCode || 1);

if (report.status !== "success" || !Array.isArray(report.failed) || report.failed.length > 0) {
  fatal(
    "STAGING-SMOKE-EVIDENCE-004",
    reportPath,
    `staging smoke report status=${report.status}; failed=${JSON.stringify(report.failed || []).slice(0, 800)}`,
    "fix the failing staging endpoint, CORS, RPC, or contract bytecode check and regenerate evidence.",
  );
}

const generatedAt = Date.parse(report.generatedAt || "");
const maxAgeHours = Number(process.env.STAGING_SMOKE_MAX_AGE_HOURS || "72");
const ageHours = (Date.now() - generatedAt) / 3_600_000;
if (!Number.isFinite(generatedAt) || ageHours < -0.1 || ageHours > maxAgeHours) {
  fatal(
    "STAGING-SMOKE-EVIDENCE-005",
    reportPath,
    `staging smoke evidence is stale or invalid; age=${Number.isFinite(ageHours) ? ageHours.toFixed(2) : "invalid"}h, max=${maxAgeHours}h`,
    "rerun npm run e2e:staging-smoke to produce fresh staging evidence.",
  );
}

if (report.environment !== "staging") {
  fatal(
    "STAGING-SMOKE-EVIDENCE-006",
    reportPath,
    `staging smoke environment must be staging; actual=${report.environment}`,
    "rerun the staging smoke runner against the staging endpoints.",
  );
}

const checks = new Map((report.checks || []).map((check) => [check.name, check]));
for (const name of REQUIRED_CHECKS) {
  const check = checks.get(name);
  if (!check || check.ok !== true) {
    fatal(
      "STAGING-SMOKE-EVIDENCE-007",
      reportPath,
      `required staging smoke check is missing or failed: ${name}`,
      "fix the staging deployment or smoke runner so all required checks pass.",
    );
  }
}

const tracePath = path.join(dir, "trace.jsonl");
if (!report.traceDigest || report.traceDigest !== sha256File(tracePath)) {
  fatal(
    "STAGING-SMOKE-EVIDENCE-008",
    tracePath,
    "trace digest does not match report.json traceDigest.",
    "rerun npm run e2e:staging-smoke so report.json and trace.jsonl are generated together.",
  );
}

const traceRows = fs.readFileSync(tracePath, "utf8").split(/\r?\n/).filter(Boolean);
if (traceRows.length <= 0) {
  fatal(
    "STAGING-SMOKE-EVIDENCE-009",
    tracePath,
    "trace.jsonl must contain at least one checkpoint.",
    "rerun npm run e2e:staging-smoke.",
  );
}

const leakPatterns = [
  /https:\/\/[^/\s]+\/v2\/(?!\[REDACTED\])[A-Za-z0-9_-]{12,}/,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\b0x[a-fA-F0-9]{64,}\b/,
  /"(?:privateKey|rawSignature|jwt|adminToken|accessToken|apiKey|secret|password|token)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i,
];
const text = allEvidenceText(dir);
for (const pattern of leakPatterns) {
  if (pattern.test(text)) {
    fatal(
      "STAGING-SMOKE-EVIDENCE-010",
      dir,
      `staging smoke evidence appears to contain a secret-like value matching ${pattern}`,
      "redact RPC keys, tokens, private keys, signatures, and passwords at generation time and rerun evidence.",
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);

console.log(`[ci:staging-smoke-evidence] validated ${dir}`);
