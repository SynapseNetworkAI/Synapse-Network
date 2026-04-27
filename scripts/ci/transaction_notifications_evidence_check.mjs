#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ENVIRONMENT = (process.env.TRANSACTION_NOTIFICATIONS_ENV || "local").trim().toLowerCase();
const IS_STAGING = ENVIRONMENT === "staging";
const LOCAL_DELIVERY_MODE = (process.env.TRANSACTION_NOTIFICATIONS_LOCAL_DELIVERY_MODE || "fake").trim().toLowerCase();
const IS_LOCAL_REAL = !IS_STAGING && LOCAL_DELIVERY_MODE === "real";
const EVIDENCE_ROOT = IS_STAGING
  ? path.join(ROOT, "docs/evidence/staging/transaction-notifications")
  : path.join(ROOT, "output/dogfood/transaction-notifications");
const REQUIRED_FILES = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "bugfix-log.md",
  "db-evidence.json",
  "email-evidence.json",
  "lark-evidence.json",
];
const REQUIRED_TEMPLATES = new Set([
  "deposit_confirmed",
  "refund_completed",
]);
const WITHDRAWAL_TEMPLATES = new Set([
  "consumer_withdrawal_ticket_ready",
  "consumer_withdrawal_completed",
  "consumer_withdrawal_failed_expired",
  "provider_withdrawal_ticket_ready",
  "provider_withdrawal_completed",
  "provider_withdrawal_rejected",
]);

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  if (process.env.TRANSACTION_NOTIFICATIONS_EVIDENCE_DIR) {
    return path.resolve(process.env.TRANSACTION_NOTIFICATIONS_EVIDENCE_DIR);
  }
  if (!fs.existsSync(EVIDENCE_ROOT)) return "";
  return (
    fs
      .readdirSync(EVIDENCE_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(IS_STAGING ? "-staging" : IS_LOCAL_REAL ? "-local-real" : "-local"))
      .map((entry) => path.join(EVIDENCE_ROOT, entry.name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "TXN-NOTIFICATION-EVIDENCE-001",
    "",
    `${ENVIRONMENT} transaction notification evidence is missing.`,
    IS_STAGING
      ? "run npm run e2e:transaction-notifications:staging and rerun this checker."
      : "run npm run e2e:transaction-notifications:local and rerun this checker.",
  );
}

if (process.exitCode) process.exit(process.exitCode);

for (const fileName of REQUIRED_FILES) {
  if (!fs.existsSync(path.join(dir, fileName))) {
    fatal(
      "TXN-NOTIFICATION-EVIDENCE-002",
      path.join(dir, fileName),
      "Transaction notification evidence bundle is incomplete.",
      "rerun the transaction notification E2E after fixing the failed step.",
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);

const reportPath = path.join(dir, "report.json");
const report = readJson(reportPath);
if (report.environment !== ENVIRONMENT) {
  fatal(
    "TXN-NOTIFICATION-EVIDENCE-003",
    reportPath,
    `Evidence environment mismatch; expected=${ENVIRONMENT}, actual=${report.environment}`,
    "rerun the matching local or staging transaction notification E2E.",
  );
}
if (report.status !== "success" || !Array.isArray(report.failed) || report.failed.length > 0) {
  fatal(
    "TXN-NOTIFICATION-EVIDENCE-004",
    reportPath,
    `Evidence status=${report.status}; failed=${JSON.stringify(report.failed || []).slice(0, 900)}`,
    "fix the notification path, rerun the E2E, and keep iterating until failed.length === 0.",
  );
}

const generatedAt = Date.parse(report.generatedAt || "");
const maxAgeHours = Number(process.env.TRANSACTION_NOTIFICATIONS_MAX_AGE_HOURS || (IS_STAGING ? "72" : "168"));
const ageHours = (Date.now() - generatedAt) / 3_600_000;
if (!Number.isFinite(generatedAt) || ageHours < -0.1 || ageHours > maxAgeHours) {
  fatal(
    "TXN-NOTIFICATION-EVIDENCE-005",
    reportPath,
    `Evidence is stale or invalid; age=${Number.isFinite(ageHours) ? ageHours.toFixed(2) : "invalid"}h, max=${maxAgeHours}h`,
    "rerun the transaction notification E2E to produce fresh evidence.",
  );
}

const tracePath = path.join(dir, "trace.jsonl");
if (sha256(fs.readFileSync(tracePath)) !== report.traceDigest) {
  fatal(
    "TXN-NOTIFICATION-EVIDENCE-006",
    tracePath,
    "trace.jsonl digest does not match report.traceDigest.",
    "rerun the E2E and do not edit evidence by hand.",
  );
}

const steps = new Map((report.steps || []).map((step) => [step.name, step]));
const commonSteps = [
  "postgres_dsn",
  "test_email",
  "python_probe",
  "in_app_rows",
  "delivery_log",
  "lark_delivery",
  "no_dead_letters",
  "receipt_template",
  "app_action_url",
];
const envSteps = IS_STAGING
  ? ["confirmation", "project_id", "staging_postgres_proxy", "cloud_run_env", "lark_webhook", "run_outbox_job"]
  : IS_LOCAL_REAL
    ? ["local_mode", "local_real_confirmation", "real_test_email", "real_email_config", "real_lark_webhook"]
    : ["local_mode", "fake_lark", "lark_payload_redaction"];
for (const name of [...envSteps, ...commonSteps]) {
  if (steps.get(name)?.ok !== true) {
    fatal(
      "TXN-NOTIFICATION-EVIDENCE-007",
      reportPath,
      `required step is missing or failed: ${name}`,
      "rerun the transaction notification E2E after fixing the failing step.",
    );
  }
}

const dbEvidence = readJson(path.join(dir, "db-evidence.json"));
const larkEvidence = readJson(path.join(dir, "lark-evidence.json"));
const emailEvidence = readJson(path.join(dir, "email-evidence.json"));
const deliveryTemplates = new Set((dbEvidence.deliveries || []).map((row) => row.templateKey));
for (const template of REQUIRED_TEMPLATES) {
  if (!deliveryTemplates.has(template)) {
    fatal(
      "TXN-NOTIFICATION-EVIDENCE-008",
      path.join(dir, "db-evidence.json"),
      `delivery log is missing required template ${template}`,
      "verify the business event enqueued a Gmail outbox row and rerun the outbox drain.",
    );
  }
}
if (![...deliveryTemplates].some((template) => WITHDRAWAL_TEMPLATES.has(template))) {
  fatal(
    "TXN-NOTIFICATION-EVIDENCE-009",
    path.join(dir, "db-evidence.json"),
    "delivery log is missing any withdrawal notification template.",
    "include at least one withdrawal ticket/completed/rejected template in the E2E fixture.",
  );
}
if (!Array.isArray(dbEvidence.inAppRows) || dbEvidence.inAppRows.length < 3) {
  fatal(
    "TXN-NOTIFICATION-EVIDENCE-010",
    path.join(dir, "db-evidence.json"),
    "in-app notification evidence is too thin.",
    "ensure deposit/refund/withdrawal fixtures write product inbox rows.",
  );
}
if (Number(dbEvidence.deadLetters || 0) !== 0) {
  fatal(
    "TXN-NOTIFICATION-EVIDENCE-011",
    path.join(dir, "db-evidence.json"),
    `outbox has dead-letter rows for this run: ${dbEvidence.deadLetters}`,
    "inspect outbox worker errors, fix the template/sender config, and rerun.",
  );
}
const larkCards = larkEvidence.cards || [];
if (!Array.isArray(larkCards) || larkCards.length < 3) {
  fatal(
    "TXN-NOTIFICATION-EVIDENCE-012",
    path.join(dir, "lark-evidence.json"),
    "Lark transaction evidence is missing cards.",
    "verify TRANSACTION_LARK_WEBHOOK_URL and rerun the E2E.",
  );
}
if (IS_STAGING || IS_LOCAL_REAL) {
  if (larkEvidence.marker !== "STAGING_TRANSACTION_EVENT" || larkEvidence.action !== "NO_ACTION_REQUIRED") {
    fatal(
      "TXN-NOTIFICATION-EVIDENCE-013",
      path.join(dir, "lark-evidence.json"),
      "real Lark evidence must include STAGING_TRANSACTION_EVENT and NO_ACTION_REQUIRED markers.",
      "rerun the E2E with the transaction Lark route enabled.",
    );
  }
} else if (
  !larkCards.every((card) => card.markerPresent === true && card.noActionRequired === true)
) {
  fatal(
    "TXN-NOTIFICATION-EVIDENCE-013",
    path.join(dir, "lark-evidence.json"),
    "local fake Lark cards are missing STAGING_TRANSACTION_EVENT or NO_ACTION_REQUIRED.",
    "fix the transaction Lark card renderer and rerun local E2E.",
  );
}
if (!IS_STAGING && !IS_LOCAL_REAL) {
  if (larkEvidence.noSecretLikeText !== true) {
    fatal(
      "TXN-NOTIFICATION-EVIDENCE-014",
      path.join(dir, "lark-evidence.json"),
      "fake Lark payload redaction check failed.",
      "redact webhook URLs, signatures, tokens, and private keys before writing evidence.",
    );
  }
  if (!Array.isArray(emailEvidence.fakeEmailSent) || emailEvidence.fakeEmailSent.length < 3) {
    fatal(
      "TXN-NOTIFICATION-EVIDENCE-015",
      path.join(dir, "email-evidence.json"),
      "local fake email sender did not send enough receipt templates.",
      "rerun local E2E with EMAIL_OUTBOX_ENABLED=true and fake drain mode.",
    );
  }
}
if (IS_LOCAL_REAL) {
  const sent = Number(emailEvidence.drainStats?.sent || 0);
  if (sent < 3) {
    fatal(
      "TXN-NOTIFICATION-EVIDENCE-015",
      path.join(dir, "email-evidence.json"),
      `local-real Gmail SMTP drain did not send enough receipt templates; sent=${sent}`,
      "verify GMAIL_SMTP_USERNAME, GMAIL_SMTP_APP_PASSWORD, EMAIL_FROM, and rerun local-real E2E.",
    );
  }
}

const allText = REQUIRED_FILES
  .map((fileName) => fs.readFileSync(path.join(dir, fileName), "utf8"))
  .join("\n");
const leakPatterns = [
  /postgres(?:ql)?:\/\/[^@\s]+@/i,
  /https:\/\/open\.larksuite\.com\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+/i,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\b0x[a-fA-F0-9]{64,}\b/,
  /"(?:password|secret|token|apiKey|privateKey|webhook)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i,
];
for (const pattern of leakPatterns) {
  if (pattern.test(allText)) {
    fatal(
      "TXN-NOTIFICATION-EVIDENCE-016",
      dir,
      `evidence contains secret-like data matching ${pattern}`,
      "redact DSNs, Lark webhook URLs, bearer tokens, private keys, and secret fields at generation time.",
    );
  }
}

const bugfixLog = fs.readFileSync(path.join(dir, "bugfix-log.md"), "utf8");
if (/\bStatus:\s*(Open|Todo|Fail|Failed)\b/i.test(bugfixLog)) {
  fatal(
    "TXN-NOTIFICATION-EVIDENCE-017",
    path.join(dir, "bugfix-log.md"),
    "bugfix-log still contains an open failure.",
    "fix the bug, rerun the E2E, and close the bugfix entry.",
  );
}

if (process.exitCode) process.exit(process.exitCode);

console.log(`[ci:transaction-notifications-${ENVIRONMENT}-evidence] validated ${dir}`);
