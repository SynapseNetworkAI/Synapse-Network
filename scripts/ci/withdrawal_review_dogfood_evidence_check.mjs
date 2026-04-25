#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const MODE = (process.env.WITHDRAWAL_REVIEW_DOGFOOD_ENV || process.argv[2] || "local").toLowerCase();

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestReportDir() {
  if (process.env.WITHDRAWAL_REVIEW_DOGFOOD_EVIDENCE_DIR) {
    return path.resolve(process.env.WITHDRAWAL_REVIEW_DOGFOOD_EVIDENCE_DIR);
  }
  const base = MODE === "staging"
    ? path.join(ROOT, "docs/evidence/staging/withdrawal-review-dogfood")
    : path.join(ROOT, "output/dogfood/withdrawal-review");
  if (!fs.existsSync(base)) return "";
  return fs.readdirSync(base)
    .map((name) => path.join(base, name))
    .filter((dir) => fs.existsSync(path.join(dir, "report.json")))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || "";
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
    ["SENSITIVE_ENV_NAME", /\b(?:PRIVATE_KEY|PRIVATEKEY|JWT_SECRET|AUTH_SECRET|ADMIN_TOTP_SECRET)\b/],
    ["LARK_WEBHOOK", /open\.larksuite\.com\/open-apis\/bot\/v2\/hook/i],
    ["RPC_KEY", /https:\/\/[^/\s]+\/v2\/[A-Za-z0-9._~-]{12,}/i],
  ];
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

const dir = latestReportDir();
if (!dir) {
  fatal(
    "WITHDRAWAL-REVIEW-EVIDENCE-001",
    "",
    `No ${MODE} withdrawal review dogfood evidence directory was found.`,
    `Run npm run e2e:withdrawal-review-dogfood:${MODE} before this evidence gate.`,
  );
}

if (process.exitCode) process.exit(process.exitCode);

const reportPath = path.join(dir, "report.json");
const tracePath = path.join(dir, "trace.jsonl");
const requiredFiles = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "bugfix-log.md",
  "api-evidence.json",
  "db-evidence.json",
  "chain-evidence.json",
];

for (const name of requiredFiles) {
  if (!fs.existsSync(path.join(dir, name))) {
    fatal(
      "WITHDRAWAL-REVIEW-EVIDENCE-002",
      path.join(dir, name),
      "Required withdrawal review dogfood evidence file is missing.",
      "Rerun the dogfood script and do not hand-edit partial evidence directories.",
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);

const report = readJson(reportPath);
const traceText = fs.readFileSync(tracePath, "utf8");
const traceDigest = crypto.createHash("sha256").update(traceText).digest("hex");
const traceRows = traceText.trim()
  ? traceText.trim().split("\n").map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      fatal(
        "WITHDRAWAL-REVIEW-EVIDENCE-003",
        tracePath,
        `trace.jsonl line ${index + 1} is not valid JSON.`,
        "Regenerate trace.jsonl from the dogfood runner.",
      );
      return {};
    }
  })
  : [];

if (report.status !== "success" || !Array.isArray(report.failed) || report.failed.length !== 0) {
  fatal(
    "WITHDRAWAL-REVIEW-EVIDENCE-004",
    reportPath,
    `Dogfood report status is ${report.status}; failures=${JSON.stringify(report.failed || []).slice(0, 800)}`,
    "Fix the failing scenario, record bugfix evidence, then rerun the dogfood.",
  );
}

if (!report.traceDigest || report.traceDigest !== traceDigest) {
  fatal(
    "WITHDRAWAL-REVIEW-EVIDENCE-005",
    reportPath,
    "report.json traceDigest does not match trace.jsonl.",
    "Do not hand-edit evidence; rerun the dogfood script.",
  );
}

if (traceRows.length === 0) {
  fatal(
    "WITHDRAWAL-REVIEW-EVIDENCE-006",
    tracePath,
    "trace.jsonl is empty.",
    "Rerun the dogfood so API, DB, and chain checkpoints are recorded.",
  );
}

for (const scenario of [
  "consumer-reject",
  "consumer-approve",
  "provider-reject",
]) {
  if (!traceRows.some((row) => String(row.scenario || "").includes(scenario))) {
    fatal(
      "WITHDRAWAL-REVIEW-EVIDENCE-007",
      tracePath,
      `Required scenario trace is missing: ${scenario}`,
      "Rerun the full withdrawal review dogfood, not a narrow partial command.",
    );
  }
}

const screenshots = Array.isArray(report.screenshots) ? report.screenshots : [];
for (const fragment of [
  "consumer-reject-before-review-queue.png",
  "consumer-approve-before-review-queue.png",
  "provider-reject-before-review-queue.png",
]) {
  if (!screenshots.some((filePath) => String(filePath).endsWith(fragment) && fs.existsSync(filePath))) {
    fatal(
      "WITHDRAWAL-REVIEW-EVIDENCE-008",
      reportPath,
      `Required screenshot is missing: ${fragment}`,
      "Rerun the dogfood with Admin-front available so screenshot evidence is captured.",
    );
  }
}

const combinedEvidence = requiredFiles
  .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
  .join("\n");
const leaks = hasSecretLeak(combinedEvidence);
if (leaks.length > 0) {
  fatal(
    "WITHDRAWAL-REVIEW-EVIDENCE-SECRET",
    dir,
    `Evidence contains secret-like material: ${leaks.join(", ")}`,
    "Delete the evidence directory, fix redaction, rerun the dogfood, and never commit leaked evidence.",
  );
}

if (process.exitCode) process.exit(process.exitCode);

console.log(`[withdrawal-review-evidence] passed: ${dir}`);
