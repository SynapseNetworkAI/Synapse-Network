#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const environment = (
  process.env.SUPPORT_CASE_DOGFOOD_ENV ||
  process.env.SYNAPSE_E2E_ENV ||
  "local"
)
  .trim()
  .toLowerCase();
const isStaging = environment === "staging";
const evidenceRoot = isStaging
  ? path.join(ROOT, "docs/evidence/staging/support-case-dogfood")
  : path.join(ROOT, "output/dogfood/support-case");
const requiredFiles = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "bugfix-log.md",
  "screenshots",
  "api-evidence.json",
  "db-evidence.json",
  "lark-evidence.json",
];
const requiredScreenshots = [
  "support-page.png",
  "support-feedback-drawer.png",
  "support-submit-success.png",
  "admin-support-list.png",
  "admin-support-detail.png",
  "admin-support-replied.png",
];
const forbiddenPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\b0x[a-fA-F0-9]{64,}\b/,
  /private[_-]?key\s*[:=]/i,
  /signature\s*[:=]/i,
  /https:\/\/open\.larksuite\.com\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+/i,
];

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  if (process.env.SUPPORT_CASE_DOGFOOD_EVIDENCE_DIR) {
    return path.resolve(process.env.SUPPORT_CASE_DOGFOOD_EVIDENCE_DIR);
  }
  if (!fs.existsSync(evidenceRoot)) return "";
  return (
    fs
      .readdirSync(evidenceRoot, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.endsWith(isStaging ? "-staging" : "-local")
      )
      .map((entry) => path.join(evidenceRoot, entry.name))
      .sort(
        (left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs
      )[0] || ""
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "SUPPORT-DOGFOOD-EVIDENCE-001",
    "",
    `${environment} support case dogfood evidence is missing.`,
    isStaging
      ? "run npm run e2e:support-case-dogfood:staging and rerun this checker."
      : "run npm run e2e:support-case-dogfood:local and rerun this checker."
  );
}

if (process.exitCode) process.exit(process.exitCode);

for (const fileName of requiredFiles) {
  if (!fs.existsSync(path.join(dir, fileName))) {
    fatal(
      "SUPPORT-DOGFOOD-EVIDENCE-002",
      path.join(dir, fileName),
      "Support case evidence bundle is incomplete.",
      "rerun the support case dogfood after fixing the failed step."
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);

const reportPath = path.join(dir, "report.json");
const report = readJson(reportPath);
if (report.environment !== environment) {
  fatal(
    "SUPPORT-DOGFOOD-EVIDENCE-003",
    reportPath,
    `Evidence environment mismatch; expected=${environment}, actual=${report.environment}`,
    "rerun the matching local or staging support case dogfood command."
  );
}
if (
  report.status !== "success" ||
  !Array.isArray(report.failed) ||
  report.failed.length > 0
) {
  fatal(
    "SUPPORT-DOGFOOD-EVIDENCE-004",
    reportPath,
    `Evidence status=${report.status}; failed=${JSON.stringify(
      report.failed || []
    ).slice(0, 900)}`,
    "fix the support workflow, rerun the E2E, and keep iterating until failed.length === 0."
  );
}

const generatedAt = Date.parse(report.generatedAt || "");
const maxAgeHours = Number(
  process.env.SUPPORT_CASE_DOGFOOD_MAX_AGE_HOURS || (isStaging ? "72" : "168")
);
const ageHours = (Date.now() - generatedAt) / 3_600_000;
if (
  !Number.isFinite(generatedAt) ||
  ageHours < -0.1 ||
  ageHours > maxAgeHours
) {
  fatal(
    "SUPPORT-DOGFOOD-EVIDENCE-005",
    reportPath,
    `Evidence is stale or invalid; age=${
      Number.isFinite(ageHours) ? ageHours.toFixed(2) : "invalid"
    }h, max=${maxAgeHours}h.`,
    "rerun the support case dogfood to produce fresh evidence."
  );
}

const tracePath = path.join(dir, "trace.jsonl");
if (sha256(fs.readFileSync(tracePath)) !== report.traceDigest) {
  fatal(
    "SUPPORT-DOGFOOD-EVIDENCE-006",
    tracePath,
    "trace.jsonl digest does not match report.traceDigest.",
    "rerun the E2E and do not edit evidence by hand."
  );
}

for (const screenshot of requiredScreenshots) {
  if (!fs.existsSync(path.join(dir, "screenshots", screenshot))) {
    fatal(
      "SUPPORT-DOGFOOD-EVIDENCE-007",
      path.join(dir, "screenshots", screenshot),
      "Required UI dogfood screenshot is missing.",
      "rerun the Playwright dogfood and capture support/admin screenshots."
    );
  }
}

const steps = new Map((report.steps || []).map((step) => [step.name, step]));
const commonSteps = [
  "gateway_health",
  "admin_api_health",
  "user_front_health",
  "admin_front_health",
  "user_auth",
  "verified_owner_email",
  "ui_submit_billing_support",
  "db_billing_support_case",
  "api_submit_bug_report",
  "api_submit_docs_issue",
  "api_submit_product_feedback_raw_only",
  "lark_support_case_created",
  "admin_login",
  "admin_front_reply",
  "db_reply_notifications",
  "evidence_redaction",
];
for (const name of commonSteps) {
  if (steps.get(name)?.ok !== true) {
    fatal(
      "SUPPORT-DOGFOOD-EVIDENCE-008",
      reportPath,
      `required step is missing or failed: ${name}`,
      "rerun the support case dogfood after fixing the failing step."
    );
  }
}

const apiEvidence = readJson(path.join(dir, "api-evidence.json"));
const dbEvidence = readJson(path.join(dir, "db-evidence.json"));
const larkEvidence = readJson(path.join(dir, "lark-evidence.json"));
if (
  !apiEvidence.billingFeedback?.feedbackId ||
  !apiEvidence.billingFeedback?.supportTaskId
) {
  fatal(
    "SUPPORT-DOGFOOD-EVIDENCE-009",
    path.join(dir, "api-evidence.json"),
    "Billing support API evidence is missing feedbackId/supportTaskId.",
    "ensure /api/v1/feedback returns support case metadata and rerun."
  );
}
if (dbEvidence.billingCase?.taskStatus !== "awaiting_response") {
  fatal(
    "SUPPORT-DOGFOOD-EVIDENCE-010",
    path.join(dir, "db-evidence.json"),
    "Billing support case was not created in the response queue before reply.",
    "verify synapse_feedback_reports and synapse_forum_response_tasks writes."
  );
}
if (
  dbEvidence.bugReport?.priority !== "high" ||
  dbEvidence.bugReport?.classification !== "bug"
) {
  fatal(
    "SUPPORT-DOGFOOD-EVIDENCE-011",
    path.join(dir, "db-evidence.json"),
    "Bug report did not become a high-priority support task.",
    "fix support category routing and rerun."
  );
}
if (dbEvidence.docsIssue?.classification !== "docs_issue") {
  fatal(
    "SUPPORT-DOGFOOD-EVIDENCE-012",
    path.join(dir, "db-evidence.json"),
    "Docs issue did not become a docs support task.",
    "fix support category routing and rerun."
  );
}
if (dbEvidence.productFeedback?.responseTaskId) {
  fatal(
    "SUPPORT-DOGFOOD-EVIDENCE-013",
    path.join(dir, "db-evidence.json"),
    "Product feedback unexpectedly entered the manual support queue.",
    "product_feedback must remain raw intake unless explicitly escalated."
  );
}
if (
  dbEvidence.reply?.taskStatus !== "responded" ||
  !dbEvidence.reply?.replyId ||
  Number(dbEvidence.reply?.inAppCount || 0) < 1 ||
  Number(dbEvidence.reply?.supportReplyOutboxCount || 0) +
    Number(dbEvidence.reply?.supportReplyDeliveryCount || 0) <
    1
) {
  fatal(
    "SUPPORT-DOGFOOD-EVIDENCE-014",
    path.join(dir, "db-evidence.json"),
    "Admin reply did not produce responded task, reply row, in-app notification, and support_reply email evidence.",
    "fix forum-support reply persistence/notification enqueue and rerun."
  );
}

const larkText = JSON.stringify(larkEvidence);
if (!larkText.includes("SUPPORT_CASE_CREATED")) {
  fatal(
    "SUPPORT-DOGFOOD-EVIDENCE-015",
    path.join(dir, "lark-evidence.json"),
    "Lark evidence is missing SUPPORT_CASE_CREATED marker.",
    "verify SUPPORT_LARK_* config and rerun."
  );
}
if (
  !isStaging &&
  larkEvidence.mode !== "local-real" &&
  !(larkEvidence.statuses || []).includes(500)
) {
  fatal(
    "SUPPORT-DOGFOOD-EVIDENCE-016",
    path.join(dir, "lark-evidence.json"),
    "Local dogfood did not exercise Lark failure best-effort behavior.",
    "make fake Lark return 500 for one support submission and rerun."
  );
}

const bugfixLog = fs.readFileSync(path.join(dir, "bugfix-log.md"), "utf8");
if (!/No open bugs\./.test(bugfixLog)) {
  fatal(
    "SUPPORT-DOGFOOD-EVIDENCE-017",
    path.join(dir, "bugfix-log.md"),
    "bugfix-log.md still has open bugs.",
    "fix recorded bugs, rerun dogfood, and only pass once there are no open bugs."
  );
}

const evidenceText = [
  fs.readFileSync(tracePath, "utf8"),
  fs.readFileSync(path.join(dir, "api-evidence.json"), "utf8"),
  fs.readFileSync(path.join(dir, "db-evidence.json"), "utf8"),
  fs.readFileSync(path.join(dir, "lark-evidence.json"), "utf8"),
].join("\n");
for (const pattern of forbiddenPatterns) {
  if (pattern.test(evidenceText)) {
    fatal(
      "SUPPORT-DOGFOOD-EVIDENCE-018",
      dir,
      `Evidence leaks secret-like value matching ${pattern}.`,
      "redact evidence payloads and rerun the support case dogfood."
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`support case dogfood evidence passed: ${dir}`);
