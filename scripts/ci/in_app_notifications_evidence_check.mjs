#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_EVIDENCE_ROOT = path.join(ROOT, "output/dogfood/in-app-notifications");
const MAX_AGE_MS = 72 * 60 * 60 * 1000;

function fail(message) {
  console.error(`FATAL INAPP-EVIDENCE-001: ${message}`);
  console.error("Agent fix: rerun npm run e2e:in-app-notifications locally, fix any bugfix-log items, and rerun this evidence gate.");
  process.exit(1);
}

function latestEvidenceDir() {
  if (process.env.INAPP_E2E_EVIDENCE_DIR) {
    return path.resolve(process.env.INAPP_E2E_EVIDENCE_DIR);
  }
  if (!fs.existsSync(DEFAULT_EVIDENCE_ROOT)) {
    fail(`evidence root missing: ${DEFAULT_EVIDENCE_ROOT}`);
  }
  const dirs = fs.readdirSync(DEFAULT_EVIDENCE_ROOT)
    .map((entry) => path.join(DEFAULT_EVIDENCE_ROOT, entry))
    .filter((entry) => fs.statSync(entry).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!dirs.length) {
    fail(`no in-app notification evidence directories found under ${DEFAULT_EVIDENCE_ROOT}`);
  }
  return dirs[0];
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`required evidence file missing: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertNoSecrets(value, label) {
  const text = JSON.stringify(value);
  const patterns = [
    /https:\/\/open\.larksuite\.com\/open-apis\/bot\/v2\/hook\//i,
    /authorization/i,
    /private[_-]?key/i,
    /jwt/i,
    /admin[_-]?token/i,
    /raw[_-]?signature/i,
    /0x[a-fA-F0-9]{64,}/,
  ];
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      fail(`${label} contains secret-like value matching ${pattern}`);
    }
  }
}

const evidenceDir = latestEvidenceDir();
const reportPath = path.join(evidenceDir, "report.json");
const report = readJson(reportPath);

if (report.status !== "success") {
  fail(`report status is not success: ${report.status}`);
}
if (Array.isArray(report.failed) && report.failed.length > 0) {
  fail(`report has failed entries: ${JSON.stringify(report.failed).slice(0, 1000)}`);
}
if (!report.generatedAt || Date.now() - Date.parse(report.generatedAt) > MAX_AGE_MS) {
  fail("report is missing generatedAt or is older than 72 hours");
}

const requiredScreenshots = [
  "01-unread-badge.png",
  "02-dropdown-list.png",
  "03-action-url-opened.png",
  "04-mark-all-read.png",
  "05-empty-state.png",
];
for (const screenshot of requiredScreenshots) {
  const filePath = path.join(evidenceDir, "screenshots", screenshot);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size <= 0) {
    fail(`required screenshot missing or empty: ${filePath}`);
  }
}

const passedNames = new Set((report.passed || []).map((item) => item.name));
for (const name of ["postgres schema ready", "seed representative notifications", "gateway api assertions", "user-front ui assertions"]) {
  if (!passedNames.has(name)) {
    fail(`required passed step missing: ${name}`);
  }
}

for (const fileName of ["report.md", "bugfix-log.md"]) {
  const filePath = path.join(evidenceDir, fileName);
  if (!fs.existsSync(filePath)) {
    fail(`required evidence artifact missing: ${filePath}`);
  }
  assertNoSecrets(fs.readFileSync(filePath, "utf8"), fileName);
}
assertNoSecrets(report, "report.json");

console.log(`[in-app-notifications-evidence] passed: ${evidenceDir}`);
