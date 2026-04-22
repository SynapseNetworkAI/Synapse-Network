#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE_ROOT = path.join(ROOT, "docs/evidence/alerts/lark");
const REQUIRED_FILES = [
  "report.json",
  "report.md",
  "environment-manifest.json",
  "sent-messages.json",
];
const REQUIRED_SCENARIOS = [
  "p0-firing",
  "p0-resolved",
  "prod-firing",
  "prod-resolved",
  "staging-firing",
  "staging-resolved",
  "staging-batch-folding",
];
const REQUIRED_ENDPOINTS = [
  "/lark/p0-war-room",
  "/lark/prod-alerts",
  "/lark/staging-drill",
];

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  if (process.env.LARK_ALERT_E2E_EVIDENCE_DIR) {
    return path.resolve(process.env.LARK_ALERT_E2E_EVIDENCE_DIR);
  }
  if (!fs.existsSync(EVIDENCE_ROOT)) return "";
  const dirs = fs
    .readdirSync(EVIDENCE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("-lark-e2e"))
    .map((entry) => path.join(EVIDENCE_ROOT, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0] || "";
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fatal(
      "LARK-E2E-EVIDENCE-002",
      filePath,
      `evidence JSON cannot be parsed: ${error.message}`,
      "Rerun npm run e2e:lark-alerts instead of hand-editing evidence.",
    );
    return null;
  }
}

function allEvidenceText(dir) {
  return REQUIRED_FILES
    .map((fileName) => {
      const filePath = path.join(dir, fileName);
      return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
    })
    .join("\n");
}

function configuredSecretValues() {
  return [
    "LARK_WEBHOOK_P0_WAR_ROOM",
    "LARK_SECRET_P0_WAR_ROOM",
    "LARK_WEBHOOK_PROD_ALERTS",
    "LARK_SECRET_PROD_ALERTS",
    "LARK_WEBHOOK_STAGING_DRILL",
    "LARK_SECRET_STAGING_DRILL",
  ]
    .map((name) => process.env[name])
    .filter((value) => value && value.length >= 8);
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "LARK-E2E-EVIDENCE-001",
    "",
    "Lark alert E2E evidence is missing.",
    "Run npm run e2e:lark-alerts with the Lark webhook environment variables configured.",
  );
}

if (process.exitCode) process.exit(process.exitCode);

for (const fileName of REQUIRED_FILES) {
  const filePath = path.join(dir, fileName);
  if (!fs.existsSync(filePath)) {
    fatal(
      "LARK-E2E-EVIDENCE-003",
      filePath,
      `required Lark E2E evidence artifact is missing: ${fileName}`,
      "Rerun npm run e2e:lark-alerts; do not assemble partial evidence by hand.",
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);

const reportPath = path.join(dir, "report.json");
const report = readJson(reportPath);
const manifest = readJson(path.join(dir, "environment-manifest.json"));
const sentMessages = readJson(path.join(dir, "sent-messages.json"));

if (!report || !manifest || !sentMessages) process.exit(process.exitCode || 1);

if (report.status !== "success" || !Array.isArray(report.failed) || report.failed.length > 0) {
  fatal(
    "LARK-E2E-EVIDENCE-004",
    reportPath,
    `report status=${report.status}; failed=${JSON.stringify(report.failed || []).slice(0, 800)}`,
    "Fix the failed Lark delivery path and regenerate evidence.",
  );
}

const generatedAt = Date.parse(report.generatedAt || report.finishedAt || "");
const maxAgeHours = Number(process.env.LARK_ALERT_E2E_MAX_AGE_HOURS || "72");
const ageHours = (Date.now() - generatedAt) / 3_600_000;
if (!Number.isFinite(generatedAt) || ageHours < -0.1 || ageHours > maxAgeHours) {
  fatal(
    "LARK-E2E-EVIDENCE-005",
    reportPath,
    `Lark E2E evidence is stale or invalid; age=${Number.isFinite(ageHours) ? ageHours.toFixed(2) : "invalid"}h, max=${maxAgeHours}h`,
    "Rerun npm run e2e:lark-alerts to produce fresh evidence.",
  );
}

if (!Array.isArray(sentMessages)) {
  fatal(
    "LARK-E2E-EVIDENCE-006",
    path.join(dir, "sent-messages.json"),
    "sent-messages.json must be an array of delivery records.",
    "Regenerate evidence with scripts/e2e/lark_alert_e2e.mjs.",
  );
}

const byName = new Map((Array.isArray(sentMessages) ? sentMessages : []).map((message) => [message.name, message]));
for (const scenario of REQUIRED_SCENARIOS) {
  const message = byName.get(scenario);
  if (!message || message.ok !== true) {
    fatal(
      "LARK-E2E-EVIDENCE-007",
      reportPath,
      `required scenario ${scenario} is missing or failed.`,
      "Rerun npm run e2e:lark-alerts and verify every Lark group accepts firing/resolved probes.",
    );
  }
  if (!message?.businessScenario || !message?.impact) {
    fatal(
      "LARK-E2E-EVIDENCE-013",
      reportPath,
      `required scenario ${scenario} is missing businessScenario or impact context.`,
      "Update the Lark E2E payload so the card explains the business scenario and operator impact.",
    );
  }
}

const prodFiring = byName.get("prod-firing");
if (prodFiring && !/Gateway invoke|核心链路/.test(`${prodFiring.businessScenario} ${prodFiring.impact}`)) {
  fatal(
    "LARK-E2E-EVIDENCE-014",
    reportPath,
    "prod-firing Lark E2E evidence does not describe the Gateway invoke/core-path business scenario.",
    "Replace generic delivery-probe wording with a clear Gateway invoke core-path failure scenario.",
  );
}

for (const endpoint of REQUIRED_ENDPOINTS) {
  const records = sentMessages.filter((message) => message.endpoint === endpoint);
  const hasFiring = records.some((message) => message.status === "firing" && message.ok === true);
  const hasResolved = records.some((message) => message.status === "resolved" && message.ok === true);
  if (!hasFiring || !hasResolved) {
    fatal(
      "LARK-E2E-EVIDENCE-008",
      reportPath,
      `${endpoint} must have both firing and resolved successful delivery records.`,
      "Rerun npm run e2e:lark-alerts; each Lark group needs fault and recovery delivery evidence.",
    );
  }
}

const batch = byName.get("staging-batch-folding");
if (!batch || batch.alertCount !== 100 || batch.foldedCount !== 99) {
  fatal(
    "LARK-E2E-EVIDENCE-009",
    reportPath,
    "batch folding scenario must record alertCount=100 and foldedCount=99.",
    "Fix the Relay batching behavior and regenerate Lark E2E evidence.",
  );
}

const text = allEvidenceText(dir);
const leakPatterns = [
  /https:\/\/(?:open\.)?larksuite\.com\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+/i,
  /https:\/\/(?:open\.)?feishu\.cn\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+/i,
  /\b0x[a-fA-F0-9]{64,}\b/,
  /\bauthorization\s*[:=]\s*(?!\[REDACTED\])\S+/i,
  /\bprivate[_-]?key\s*[:=]\s*(?!\[REDACTED\])\S+/i,
  /"sign"\s*:\s*"[^"]+"/i,
];
for (const pattern of leakPatterns) {
  if (pattern.test(text)) {
    fatal(
      "LARK-E2E-EVIDENCE-010",
      dir,
      `evidence appears to contain a sensitive value matching ${pattern}`,
      "Remove the leaked value, rotate the exposed secret if real, and regenerate redacted evidence.",
    );
  }
}

for (const secret of configuredSecretValues()) {
  if (text.includes(secret)) {
    fatal(
      "LARK-E2E-EVIDENCE-011",
      dir,
      "evidence contains a configured webhook or signing secret value.",
      "Do not write raw Lark webhook URLs or secrets to evidence; regenerate with redacted manifests only.",
    );
  }
}

for (const endpoint of REQUIRED_ENDPOINTS) {
  if (!manifest.endpoints?.[endpoint]?.webhookConfigured) {
    fatal(
      "LARK-E2E-EVIDENCE-012",
      path.join(dir, "environment-manifest.json"),
      `${endpoint} webhookConfigured must be true in successful evidence.`,
      "Configure all three Lark webhook environment variables and rerun npm run e2e:lark-alerts.",
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);

console.log(`[ci:lark-alert-e2e-evidence] validated ${dir}`);
