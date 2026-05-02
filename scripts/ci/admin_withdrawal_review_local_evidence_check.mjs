#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BASE = path.join(ROOT, "output/dogfood/admin-withdrawal-review");

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestReportDir() {
  if (process.env.ADMIN_WITHDRAWAL_REVIEW_EVIDENCE_DIR) {
    return path.resolve(process.env.ADMIN_WITHDRAWAL_REVIEW_EVIDENCE_DIR);
  }
  if (!fs.existsSync(BASE)) return "";
  return (
    fs
      .readdirSync(BASE)
      .map((name) => path.join(BASE, name))
      .filter((dir) => fs.existsSync(path.join(dir, "report.json")))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function hasSecretLeak(text) {
  const patterns = [
    ["JWT", /eyJ[A-Za-z0-9._~+/=-]{20,}/],
    ["AUTHORIZATION", /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/i],
    [
      "SENSITIVE_FIELD_VALUE",
      /"(?:[^"]*(?:privateKey|private_key|signature|authorization|token|secret|password)[^"]*)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i,
    ],
    [
      "SENSITIVE_ENV_NAME",
      /\b(?:PRIVATE_KEY|PRIVATEKEY|JWT_SECRET|AUTH_SECRET|ADMIN_TOTP_SECRET|ADMIN_PASSWORD)\b/,
    ],
  ];
  return patterns
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

const dir = latestReportDir();
if (!dir) {
  fatal(
    "ADMIN-WITHDRAWAL-REVIEW-EVIDENCE-001",
    "",
    "No local admin withdrawal review evidence directory was found.",
    "Run npm run e2e:admin-withdrawal-review:local first."
  );
}

if (process.exitCode) process.exit(process.exitCode);

const requiredFiles = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "bugfix-log.md",
  "api-evidence.json",
  "db-evidence.json",
  "chain-evidence.json",
  "screenshot-evidence.json",
];

for (const name of requiredFiles) {
  if (!fs.existsSync(path.join(dir, name))) {
    fatal(
      "ADMIN-WITHDRAWAL-REVIEW-EVIDENCE-002",
      path.join(dir, name),
      "Required admin withdrawal review evidence file is missing.",
      "Rerun the local E2E and do not hand-edit partial evidence directories."
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);

const report = readJson(path.join(dir, "report.json"));
const apiEvidence = readJson(path.join(dir, "api-evidence.json"));
const dbEvidence = readJson(path.join(dir, "db-evidence.json"));
const screenshotEvidence = readJson(path.join(dir, "screenshot-evidence.json"));
const traceText = fs.readFileSync(path.join(dir, "trace.jsonl"), "utf8");
const traceDigest = crypto.createHash("sha256").update(traceText).digest("hex");
const traceRows = traceText.trim()
  ? traceText
      .trim()
      .split("\n")
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch {
          fatal(
            "ADMIN-WITHDRAWAL-REVIEW-EVIDENCE-003",
            path.join(dir, "trace.jsonl"),
            `trace.jsonl line ${index + 1} is not valid JSON.`,
            "Regenerate evidence from the E2E runner."
          );
          return {};
        }
      })
  : [];

if (
  report.status !== "success" ||
  !Array.isArray(report.failed) ||
  report.failed.length !== 0
) {
  fatal(
    "ADMIN-WITHDRAWAL-REVIEW-EVIDENCE-004",
    path.join(dir, "report.json"),
    `E2E report status is ${report.status}; failures=${JSON.stringify(
      report.failed || []
    ).slice(0, 800)}`,
    "Fix the failure, keep bugfix-log.md, and rerun the E2E."
  );
}

if (!report.traceDigest || report.traceDigest !== traceDigest) {
  fatal(
    "ADMIN-WITHDRAWAL-REVIEW-EVIDENCE-005",
    path.join(dir, "report.json"),
    "report.json traceDigest does not match trace.jsonl.",
    "Do not hand-edit evidence; rerun the E2E."
  );
}

for (const scenario of [
  "consumer-approve",
  "consumer-approve:duplicate-decision",
]) {
  if (!traceRows.some((row) => String(row.scenario || "").includes(scenario))) {
    fatal(
      "ADMIN-WITHDRAWAL-REVIEW-EVIDENCE-006",
      path.join(dir, "trace.jsonl"),
      `Required trace scenario is missing: ${scenario}`,
      "Rerun the full admin withdrawal review E2E, not a partial command."
    );
  }
}

const checkpoints = apiEvidence.adminAuthCheckpoints || {};
const sessionCheckpoint =
  checkpoints.login || checkpoints["fixture-admin-session"];
if (!sessionCheckpoint) {
  fatal(
    "ADMIN-WITHDRAWAL-REVIEW-AUTH-000",
    path.join(dir, "api-evidence.json"),
    "No admin session checkpoint proves the browser had a Gateway-admin session.",
    "Record either a fresh /auth/login checkpoint or the fixture-provided admin session checkpoint."
  );
} else if (
  !sessionCheckpoint.sessionCookiePresent ||
  !sessionCheckpoint.csrfTokenPresent
) {
  fatal(
    "ADMIN-WITHDRAWAL-REVIEW-AUTH-000",
    path.join(dir, "api-evidence.json"),
    "Admin session checkpoint did not prove both session cookie and CSRF token presence.",
    "Ensure the E2E logs in or imports a fixture session that includes csrfToken."
  );
}

for (const name of [
  "decision:consumer-approve",
  "decision:consumer-approve:response",
]) {
  const checkpoint = checkpoints[name];
  if (!checkpoint) {
    fatal(
      "ADMIN-WITHDRAWAL-REVIEW-AUTH-001",
      path.join(dir, "api-evidence.json"),
      `Required admin decision auth checkpoint is missing: ${name}`,
      "Record session cookie, CSRF, and OTP presence for the approval decision request."
    );
    continue;
  }
  if (!checkpoint.sessionCookiePresent || !checkpoint.csrfTokenPresent) {
    fatal(
      "ADMIN-WITHDRAWAL-REVIEW-AUTH-002",
      path.join(dir, "api-evidence.json"),
      `Admin auth checkpoint ${name} did not prove cookie + CSRF presence.`,
      "Ensure the E2E logs in through Gateway-admin and persists the admin session cookie and CSRF token."
    );
  }
}

if (!checkpoints["decision:consumer-approve"]?.otpCodePresent) {
  fatal(
    "ADMIN-WITHDRAWAL-REVIEW-AUTH-003",
    path.join(dir, "api-evidence.json"),
    "Approval decision checkpoint does not prove X-Admin-OTP-Code presence.",
    "Generate TOTP and record only otpCodePresent=true, never the raw code."
  );
}

const decisionHttpStatus = Number(
  checkpoints["decision:consumer-approve:response"]?.httpStatus || 0
);
if (decisionHttpStatus < 200 || decisionHttpStatus >= 300) {
  fatal(
    "ADMIN-WITHDRAWAL-REVIEW-AUTH-004",
    path.join(dir, "api-evidence.json"),
    "Approval decision did not return a 2xx response.",
    "Fix session, CSRF, OTP, or approval permission before treating the chain as verified."
  );
}

const requiredScreenshots = [
  "01-admin-login-success.png",
  "02-withdrawal-review-list.png",
  "03-withdrawal-review-detail.png",
  "04-otp-step-up.png",
  "05-approve-success.png",
  "06-review-history.png",
];

for (const screenshotName of requiredScreenshots) {
  const filePath = path.join(dir, "screenshots", screenshotName);
  if (!fs.existsSync(filePath)) {
    fatal(
      "ADMIN-WITHDRAWAL-REVIEW-SCREENSHOT-001",
      filePath,
      `Required screenshot is missing: ${screenshotName}`,
      "Rerun the E2E with Admin-front available."
    );
  }
  const metadata = screenshotEvidence.find((item) =>
    String(item.file || "").endsWith(screenshotName)
  );
  if (
    !metadata ||
    metadata.forbiddenTextAbsent !== true ||
    !metadata.domCheckpoint
  ) {
    fatal(
      "ADMIN-WITHDRAWAL-REVIEW-SCREENSHOT-002",
      path.join(dir, "screenshot-evidence.json"),
      `Screenshot ${screenshotName} lacks DOM checkpoint metadata or forbidden-text proof.`,
      "Capture screenshots only after DOM assertions pass; reject login/401/loading screenshots."
    );
  }
}

const consumerApproveTrace = traceRows.find(
  (row) =>
    String(row.scenario || "") === "consumer-approve" &&
    Number(row.httpStatus || 0) >= 200 &&
    Number(row.httpStatus || 0) < 300
);
const consumerApprove =
  apiEvidence.consumerApprove?.data ||
  apiEvidence.consumerApprove ||
  consumerApproveTrace?.sanitizedResponse?.data ||
  consumerApproveTrace?.sanitizedResponse;
if (consumerApprove?.reviewDecision !== "APPROVE") {
  fatal(
    "ADMIN-WITHDRAWAL-REVIEW-DECISION-001",
    path.join(dir, "api-evidence.json"),
    "consumer approve API evidence does not contain reviewDecision=APPROVE.",
    "Verify the Gateway-admin decision endpoint returned the normalized approval result."
  );
}

if (!dbEvidence.consumerApprove?.rowAfterApprove) {
  fatal(
    "ADMIN-WITHDRAWAL-REVIEW-DB-001",
    path.join(dir, "db-evidence.json"),
    "DB evidence is missing rowAfterApprove for the approved withdrawal.",
    "Record DB state immediately after approval and before completion."
  );
}

const combinedEvidence = requiredFiles
  .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
  .join("\n");
const leaks = hasSecretLeak(combinedEvidence);
if (leaks.length > 0) {
  fatal(
    "ADMIN-WITHDRAWAL-REVIEW-EVIDENCE-SECRET",
    dir,
    `Evidence contains secret-like material: ${leaks.join(", ")}`,
    "Delete the evidence directory, fix redaction, rerun the E2E, and never commit leaked evidence."
  );
}

if (process.exitCode) process.exit(process.exitCode);

console.log(`[ci:admin-withdrawal-review] evidence ok: ${dir}`);
