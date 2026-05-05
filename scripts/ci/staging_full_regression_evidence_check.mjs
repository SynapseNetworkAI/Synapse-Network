#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const REQUIRED_FILES = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "bugfix-log.md",
  "api-evidence.json",
  "db-evidence.json",
  "chain-evidence.json",
  "dom-evidence.json",
  "screenshot-evidence.json",
];

const REQUIRED_CHECKS = [
  "preflight:gateway_health",
  "preflight:gateway_readiness",
  "preflight:gateway_admin_health",
  "preflight:user_front",
  "preflight:docs_front",
  "preflight:admin_front",
  "preflight:chain-config",
  "discovery:canonical-services-visible",
  "discovery:canonical-services-active",
  "dashboard:api-db-owner-balance",
  "credential:matches-staging-wallet",
  "invoke:fixed-price-settled",
  "invoke:llm-token-metered-settled",
  "admin:db-readonly-summary",
  "registry:no-new-service-registration",
];

const REQUIRED_SCREENSHOT_NAMES = [
  "dashboard-overview.png",
  "billing-history.png",
  "billing-credits.png",
  "marketplace-services.png",
  "dashboard-invocations.png",
  "provider-console.png",
];

function latestEvidenceDir() {
  if (process.env.STAGING_FULL_REGRESSION_EVIDENCE_DIR) {
    return path.resolve(process.env.STAGING_FULL_REGRESSION_EVIDENCE_DIR);
  }
  const base = path.join(ROOT, "docs/evidence/staging/full-regression");
  if (!fs.existsSync(base)) return "";
  return (
    fs
      .readdirSync(base)
      .map((name) => path.join(base, name))
      .filter((candidate) => fs.existsSync(path.join(candidate, "report.json")))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function parseJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fatal(
      "STAGING-FULL-JSON",
      filePath,
      `invalid JSON evidence: ${error.message}`,
      "rerun npm run e2e:staging-full-regression; do not hand-edit generated JSON."
    );
    return null;
  }
}

function parseJsonl(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        fatal(
          "STAGING-FULL-TRACE-JSON",
          `${filePath}:${index + 1}`,
          `trace line is invalid JSON: ${error.message}`,
          "rerun the staging full regression runner."
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

function scanForSecrets(text) {
  const patterns = [
    /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
    /agt_(?!\[REDACTED\])[A-Za-z0-9._~+/-]+/i,
    /"(?:password|privateKey|signature|jwt|token|secret|apiKey|authorization|credential)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i,
    /\b(?:private[_-]?key|raw[_-]?signature|admin[_-]?token|access[_-]?token|api[_-]?key|secret|password)\s*[:=]\s*(?!\[REDACTED\])\S+/i,
    /0x[a-fA-F0-9]{64,}/,
  ];
  return patterns.filter((pattern) => pattern.test(text)).map(String);
}

function requireFiles(dir) {
  for (const name of REQUIRED_FILES) {
    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath)) {
      fatal(
        "STAGING-FULL-FILE",
        filePath,
        `required evidence artifact is missing: ${name}`,
        "rerun npm run e2e:staging-full-regression."
      );
    }
  }
}

function reportFailed(report) {
  return report?.status !== "success" || (report?.failed || []).length > 0;
}

function reportFailureSummary(report) {
  return `status=${report?.status} failed=${JSON.stringify(
    report?.failed || []
  ).slice(0, 1000)}`;
}

function validateReport(report, dir) {
  if (report?.environment !== "staging") {
    fatal(
      "STAGING-FULL-ENV",
      path.join(dir, "report.json"),
      `expected environment=staging; got ${report?.environment}`,
      "rerun the gate against staging only."
    );
  }
  if (reportFailed(report)) {
    fatal(
      "STAGING-FULL-STATUS",
      path.join(dir, "report.json"),
      `report is not green: ${reportFailureSummary(report)}`,
      "fix the failed staging scenario, update bugfix-log, and rerun."
    );
  }
  if (report?.traceDigest !== sha256File(path.join(dir, "trace.jsonl"))) {
    fatal(
      "STAGING-FULL-DIGEST",
      path.join(dir, "report.json"),
      "traceDigest does not match trace.jsonl.",
      "rerun the evidence generator; do not hand-edit evidence."
    );
  }
}

function validateChecks(report, dir) {
  const checks = new Map(
    (report?.checks || []).map((check) => [check.name, check])
  );
  for (const name of REQUIRED_CHECKS) {
    const check = checks.get(name);
    if (!check || check.ok !== true) {
      fatal(
        "STAGING-FULL-CHECK",
        path.join(dir, "report.json"),
        `required check did not pass: ${name}`,
        "rerun after fixing the API/DB/DOM/chain checkpoint."
      );
    }
  }
}

function validateServices(db, dir) {
  const before = db?.serviceBaselineBefore || {};
  const after = db?.serviceBaselineAfter || {};
  const beforeTotal = Number(before.total);
  const afterTotal = Number(after.total);
  if (!Number.isFinite(beforeTotal) || beforeTotal !== afterTotal) {
    fatal(
      "STAGING-FULL-SERVICE-COUNT",
      path.join(dir, "db-evidence.json"),
      `service manifest count changed during regression: before=${before.total} after=${after.total}`,
      "remove any service registration/upsert from this suite; ordinary staging regression must reuse existing providers."
    );
  }
  const canonical = new Set(
    (before.canonical || []).map((row) => row.service_id)
  );
  for (const id of reportCanonical()) {
    if (!canonical.has(id)) {
      fatal(
        "STAGING-FULL-CANONICAL-SERVICE",
        path.join(dir, "db-evidence.json"),
        `canonical service missing from DB baseline: ${id}`,
        "fix staging provider onboarding before running regression; do not register services inside this suite."
      );
    }
  }
}

function reportCanonical() {
  return [
    "svc_web3_sentiment_index",
    "svc_protocol_fundamental_brief",
    "svc_oss_security_healthcheck",
    "svc_deepseek_chat",
  ];
}

function validateScreenshots(screenshots, dir) {
  const byName = new Map(
    (screenshots || []).map((item) => [path.basename(item.file || ""), item])
  );
  for (const name of REQUIRED_SCREENSHOT_NAMES) {
    const row = byName.get(name);
    const filePath = path.join(dir, "screenshots", name);
    if (!row || !fs.existsSync(filePath)) {
      fatal(
        "STAGING-FULL-SCREENSHOT-MISSING",
        filePath,
        `required screenshot is missing: ${name}`,
        "rerun the UI phase after the DOM/API/DB checkpoint passes."
      );
      continue;
    }
    if (
      row.forbiddenTextAbsent !== true ||
      !row.domCheckpoint ||
      !row.apiCheckpoint ||
      !row.dbCheckpoint
    ) {
      fatal(
        "STAGING-FULL-SCREENSHOT-CHECKPOINT",
        path.join(dir, "screenshot-evidence.json"),
        `screenshot ${name} is not bound to DOM/API/DB evidence.`,
        "capture screenshots only after expected DOM text is visible and API/DB checkpoints pass."
      );
    }
  }
}

function validateTrace(trace, dir) {
  if (trace.length === 0) {
    fatal(
      "STAGING-FULL-TRACE-EMPTY",
      path.join(dir, "trace.jsonl"),
      "trace.jsonl has no checkpoints.",
      "rerun staging full regression."
    );
  }
  const scenarios = new Set(trace.map((row) => row.scenario || ""));
  for (const required of [
    "api:GET:/v1/services/discover?pageSize=100",
    "api:POST:/v1/agent/invoke",
  ]) {
    if (![...scenarios].some((scenario) => scenario.startsWith(required))) {
      fatal(
        "STAGING-FULL-TRACE-SCENARIO",
        path.join(dir, "trace.jsonl"),
        `missing trace scenario prefix: ${required}`,
        "ensure discovery and invoke API checkpoints are traced."
      );
    }
  }
}

function validateNoSecrets(dir) {
  const text = REQUIRED_FILES.filter(
    (name) => name.endsWith(".json") || name.endsWith(".jsonl")
  )
    .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
    .join("\n");
  const findings = scanForSecrets(text);
  if (findings.length > 0) {
    fatal(
      "STAGING-FULL-SECRET",
      dir,
      `evidence contains secret-like values: ${findings.join(", ")}`,
      "redact credentials, tokens, signatures, private keys, and raw JWT values before writing evidence."
    );
  }
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "STAGING-FULL-MISSING",
    "",
    "staging full regression evidence directory is missing.",
    "run npm run e2e:staging-full-regression first."
  );
  process.exit(process.exitCode || 1);
}

requireFiles(dir);
if (process.exitCode) process.exit(process.exitCode);

const report = parseJson(path.join(dir, "report.json"));
const db = parseJson(path.join(dir, "db-evidence.json"));
const screenshots = parseJson(path.join(dir, "screenshot-evidence.json"));
const trace = parseJsonl(path.join(dir, "trace.jsonl"));

validateReport(report, dir);
validateChecks(report, dir);
validateServices(db, dir);
validateScreenshots(screenshots, dir);
validateTrace(trace, dir);
validateNoSecrets(dir);

if (process.exitCode) process.exit(process.exitCode);
console.log(`[staging-full-regression-evidence] PASS ${dir}`);
