#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const evidenceRoot = path.join(ROOT, "output/dogfood/email-binding");
const requiredFiles = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "bugfix-log.md",
  "screenshots",
  "screenshot-evidence.json",
  "api-evidence.json",
  "db-evidence.json",
  "email-evidence.json",
];
const requiredScreenshots = [
  "settings-pending-email.png",
  "email-verification-modal.png",
  "settings-email-verified.png",
  "settings-change-pending.png",
  "settings-email-removed.png",
];
const forbiddenPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\b0x[a-fA-F0-9]{64,}\b/,
  /private[_-]?key\s*[:=]/i,
  /signature\s*[:=]/i,
];

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  if (process.env.EMAIL_BINDING_DOGFOOD_EVIDENCE_DIR) {
    return path.resolve(process.env.EMAIL_BINDING_DOGFOOD_EVIDENCE_DIR);
  }
  if (!fs.existsSync(evidenceRoot)) return "";
  return (
    fs
      .readdirSync(evidenceRoot, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && entry.name.endsWith("-local-real")
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
    "EMAIL-BINDING-EVIDENCE-001",
    "",
    "local-real email binding dogfood evidence is missing.",
    "run npm run e2e:email-binding:local-real and rerun this checker."
  );
}
if (process.exitCode) process.exit(process.exitCode);

for (const fileName of requiredFiles) {
  if (!fs.existsSync(path.join(dir, fileName))) {
    fatal(
      "EMAIL-BINDING-EVIDENCE-002",
      path.join(dir, fileName),
      "Email binding evidence bundle is incomplete.",
      "rerun the email binding dogfood after fixing the failed step."
    );
  }
}
if (process.exitCode) process.exit(process.exitCode);

const reportPath = path.join(dir, "report.json");
const report = readJson(reportPath);
if (report.environment !== "local" || report.deliveryMode !== "real") {
  fatal(
    "EMAIL-BINDING-EVIDENCE-003",
    reportPath,
    `Evidence profile mismatch; expected local/real, actual=${report.environment}/${report.deliveryMode}`,
    "rerun npm run e2e:email-binding:local-real."
  );
}
if (
  report.status !== "success" ||
  !Array.isArray(report.failed) ||
  report.failed.length > 0
) {
  fatal(
    "EMAIL-BINDING-EVIDENCE-004",
    reportPath,
    `Evidence status=${report.status}; failed=${JSON.stringify(
      report.failed || []
    ).slice(0, 900)}`,
    "fix the email binding flow, rerun the E2E, and keep iterating until failed.length === 0."
  );
}

const generatedAt = Date.parse(report.generatedAt || "");
const maxAgeHours = Number(
  process.env.EMAIL_BINDING_DOGFOOD_MAX_AGE_HOURS || "168"
);
const ageHours = (Date.now() - generatedAt) / 3_600_000;
if (
  !Number.isFinite(generatedAt) ||
  ageHours < -0.1 ||
  ageHours > maxAgeHours
) {
  fatal(
    "EMAIL-BINDING-EVIDENCE-005",
    reportPath,
    `Evidence is stale or invalid; age=${
      Number.isFinite(ageHours) ? ageHours.toFixed(2) : "invalid"
    }h, max=${maxAgeHours}h.`,
    "rerun the email binding dogfood to produce fresh evidence."
  );
}

const tracePath = path.join(dir, "trace.jsonl");
if (sha256(fs.readFileSync(tracePath)) !== report.traceDigest) {
  fatal(
    "EMAIL-BINDING-EVIDENCE-006",
    tracePath,
    "trace.jsonl digest does not match report.traceDigest.",
    "rerun the E2E and do not edit evidence by hand."
  );
}

for (const screenshot of requiredScreenshots) {
  if (!fs.existsSync(path.join(dir, "screenshots", screenshot))) {
    fatal(
      "EMAIL-BINDING-EVIDENCE-007",
      path.join(dir, "screenshots", screenshot),
      "Required email binding UI screenshot is missing.",
      "rerun the Playwright dogfood and capture pending/modal/success screenshots."
    );
  }
}

const screenshotEvidencePath = path.join(dir, "screenshot-evidence.json");
const screenshotEvidence = readJson(screenshotEvidencePath);
if (!Array.isArray(screenshotEvidence)) {
  fatal(
    "EMAIL-BINDING-SCREENSHOT-EVIDENCE-001",
    screenshotEvidencePath,
    "screenshot-evidence.json must be an array of DOM-verified screenshot checkpoints.",
    "rerun the email binding dogfood with the guarded screenshot helper."
  );
}
if (process.exitCode) process.exit(process.exitCode);
if (
  !Array.isArray(report.screenshots) ||
  report.screenshots.some((item) => typeof item === "string")
) {
  fatal(
    "EMAIL-BINDING-SCREENSHOT-EVIDENCE-002",
    reportPath,
    "report.screenshots must contain checkpoint objects, not bare screenshot paths.",
    "update the dogfood runner to record expected text, forbidden text, DOM checkpoint, and DB checkpoint per screenshot."
  );
}
const screenshotByFile = new Map(
  screenshotEvidence.map((item) => [
    String(item.file || "").replace(/^screenshots\//, ""),
    item,
  ])
);
for (const screenshot of requiredScreenshots) {
  const evidence = screenshotByFile.get(screenshot);
  if (!evidence) {
    fatal(
      "EMAIL-BINDING-SCREENSHOT-EVIDENCE-003",
      path.join(dir, "screenshots", screenshot),
      "Required screenshot is missing its DOM checkpoint metadata.",
      "rerun the dogfood; screenshots without screenshot-evidence.json entries are rejected."
    );
    continue;
  }
  if (evidence.forbiddenTextAbsent !== true) {
    fatal(
      "EMAIL-BINDING-SCREENSHOT-AUTH-MASK",
      path.join(dir, "screenshots", screenshot),
      "Screenshot evidence says forbidden wallet/auth mask text was visible.",
      "fix wallet session setup or page state before accepting this screenshot."
    );
  }
  if (
    !evidence.domCheckpoint?.expectedVisible ||
    !Array.isArray(evidence.expectedText) ||
    evidence.expectedText.length === 0
  ) {
    fatal(
      "EMAIL-BINDING-SCREENSHOT-EVIDENCE-004",
      path.join(dir, "screenshots", screenshot),
      "Screenshot does not prove an expected DOM checkpoint was visible.",
      "capture screenshots only after waiting for the state-specific selector/text."
    );
  }
}

const steps = new Map((report.steps || []).map((step) => [step.name, step]));
for (const name of [
  "gateway_health",
  "restart_user_front_e2e_config",
  "user_front_health",
  "owner_auth",
  "request_email_binding",
  "send_verification_email",
  "verify_email_in_ui",
  "db_email_verified",
  "request_email_change",
  "db_email_change_pending",
  "screenshot_email_change_pending",
  "send_change_verification_email",
  "cancel_email_change",
  "db_email_change_cancelled",
  "remove_email",
  "db_email_removed",
  "screenshot_email_removed",
  "evidence_redaction",
]) {
  if (steps.get(name)?.ok !== true) {
    fatal(
      "EMAIL-BINDING-EVIDENCE-008",
      reportPath,
      `required step is missing or failed: ${name}`,
      "rerun the email binding dogfood after fixing the failing step."
    );
  }
}

const dbEvidence = readJson(path.join(dir, "db-evidence.json"));
const emailEvidence = readJson(path.join(dir, "email-evidence.json"));
if (
  !dbEvidence.pending?.notificationId ||
  dbEvidence.pending?.verificationCode !== "[REDACTED_CODE]"
) {
  fatal(
    "EMAIL-BINDING-EVIDENCE-009",
    path.join(dir, "db-evidence.json"),
    "Pending verification DB evidence is missing or leaked the code.",
    "ensure evidence redacts verificationCode and rerun."
  );
}
if (!dbEvidence.verified?.emailVerified || dbEvidence.verified?.pendingEmail) {
  fatal(
    "EMAIL-BINDING-EVIDENCE-010",
    path.join(dir, "db-evidence.json"),
    "Verified profile evidence does not prove email_verified=true and pending_email cleared.",
    "fix verify-code flow and rerun."
  );
}
const verifiedShot = screenshotByFile.get("settings-email-verified.png");
if (
  verifiedShot?.dbCheckpoint?.emailVerified !== true ||
  dbEvidence.verified?.emailVerified !== true
) {
  fatal(
    "EMAIL-BINDING-SCREENSHOT-DB-001",
    path.join(dir, "screenshots/settings-email-verified.png"),
    "Verified screenshot is not paired with emailVerified=true DB evidence.",
    "attach a screenshot checkpoint and DB checkpoint from the same dogfood run."
  );
}
if (
  !dbEvidence.changePending?.email ||
  !dbEvidence.changePending?.pendingEmail
) {
  fatal(
    "EMAIL-BINDING-EVIDENCE-010A",
    path.join(dir, "db-evidence.json"),
    "Change-pending evidence must prove old verified email remains while pendingEmail is staged.",
    "fix email change flow and rerun."
  );
}
const changeShot = screenshotByFile.get("settings-change-pending.png");
if (
  !changeShot?.dbCheckpoint?.pendingEmailHash ||
  !dbEvidence.changePending?.pendingEmail
) {
  fatal(
    "EMAIL-BINDING-SCREENSHOT-DB-002",
    path.join(dir, "screenshots/settings-change-pending.png"),
    "Change-pending screenshot is not paired with pendingEmail DB evidence.",
    "capture the change-pending screenshot after the DB/API pending state is established."
  );
}
if (
  !dbEvidence.changeCancelled?.email ||
  dbEvidence.changeCancelled?.pendingEmail
) {
  fatal(
    "EMAIL-BINDING-EVIDENCE-010B",
    path.join(dir, "db-evidence.json"),
    "Cancel-change evidence must prove verified email remains and pendingEmail is cleared.",
    "fix cancel-change flow and rerun."
  );
}
if (
  dbEvidence.removed?.email ||
  dbEvidence.removed?.emailVerified ||
  dbEvidence.removed?.pendingEmail
) {
  fatal(
    "EMAIL-BINDING-EVIDENCE-010C",
    path.join(dir, "db-evidence.json"),
    "Remove evidence must prove email/emailVerified/pendingEmail are all cleared.",
    "fix remove email flow and rerun."
  );
}
const removedShot = screenshotByFile.get("settings-email-removed.png");
if (
  removedShot?.dbCheckpoint?.emailVerified !== false ||
  dbEvidence.removed?.email ||
  dbEvidence.removed?.emailVerified
) {
  fatal(
    "EMAIL-BINDING-SCREENSHOT-DB-003",
    path.join(dir, "screenshots/settings-email-removed.png"),
    "Removed-email screenshot is not paired with cleared email DB evidence.",
    "capture the removed-email screenshot only after email/emailVerified/pendingEmail are cleared."
  );
}
if (Number(emailEvidence.delivery?.deliveryCount || 0) < 1) {
  fatal(
    "EMAIL-BINDING-EVIDENCE-011",
    path.join(dir, "email-evidence.json"),
    "Real local Gmail delivery log is missing.",
    "fix Gmail SMTP config/outbox worker and rerun."
  );
}
if (Number(emailEvidence.changeDelivery?.deliveryCount || 0) < 1) {
  fatal(
    "EMAIL-BINDING-EVIDENCE-011A",
    path.join(dir, "email-evidence.json"),
    "Change email verification delivery log is missing.",
    "fix Gmail SMTP config/outbox worker and rerun."
  );
}

const bugfixLog = fs.readFileSync(path.join(dir, "bugfix-log.md"), "utf8");
if (!/No open bugs\./.test(bugfixLog)) {
  fatal(
    "EMAIL-BINDING-EVIDENCE-012",
    path.join(dir, "bugfix-log.md"),
    "bugfix-log.md still has open bugs.",
    "fix recorded bugs, rerun dogfood, and only pass once there are no open bugs."
  );
}

const evidenceText = [
  fs.readFileSync(tracePath, "utf8"),
  fs.readFileSync(path.join(dir, "api-evidence.json"), "utf8"),
  fs.readFileSync(path.join(dir, "db-evidence.json"), "utf8"),
  fs.readFileSync(path.join(dir, "email-evidence.json"), "utf8"),
  fs.readFileSync(screenshotEvidencePath, "utf8"),
].join("\n");
if (
  /SCREENSHOT_BLOCKED_BY_AUTH_MASK|Connect Wallet|Please connect your wallet|Wallet not connected/i.test(
    evidenceText
  )
) {
  fatal(
    "EMAIL-BINDING-SCREENSHOT-AUTH-MASK",
    dir,
    "Evidence contains an auth/wallet mask marker, so UI screenshots cannot prove the target state.",
    "fix the E2E wallet session harness and rerun; blocked screenshots are not accepted."
  );
}
for (const pattern of forbiddenPatterns) {
  if (pattern.test(evidenceText)) {
    fatal(
      "EMAIL-BINDING-EVIDENCE-013",
      dir,
      `Evidence leaks secret-like value matching ${pattern}.`,
      "redact evidence payloads and rerun the email binding dogfood."
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`email binding dogfood evidence passed: ${dir}`);
