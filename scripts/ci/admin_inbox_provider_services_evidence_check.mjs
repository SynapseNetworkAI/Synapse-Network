#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_ROOT = path.join(
  ROOT,
  "output/e2e/admin-inbox-provider-services"
);
const MAX_AGE_MS = 72 * 60 * 60 * 1000;
const REQUIRED_SCREENSHOTS = [
  "provider-services-before.png",
  "inbox-unread.png",
  "inbox-read.png",
];
const FORBIDDEN_TEXT = [
  "synapse_in_app_notifications",
  "HTTPException",
  "CHAIN_RPC",
  "PROVIDER_",
  "WITHDRAW_",
  "backend",
  "ledger",
  "SQL",
  "RPC Error",
];
const ACCEPTED_EVENT_TYPES = new Set([
  "admin.provider_service.pause",
  "admin.provider_service.action_failed",
]);

function fatal(code, message, fix) {
  console.error(`FATAL ${code}: ${message}`);
  console.error(`Agent fix: ${fix}`);
  process.exit(1);
}

function latestEvidenceDir() {
  if (process.env.ADMIN_INBOX_PROVIDER_SERVICES_EVIDENCE_DIR) {
    return path.resolve(process.env.ADMIN_INBOX_PROVIDER_SERVICES_EVIDENCE_DIR);
  }
  if (!fs.existsSync(DEFAULT_ROOT)) {
    fatal(
      "ADMIN-INBOX-EVIDENCE-001",
      `evidence root missing: ${DEFAULT_ROOT}`,
      "Run npm run e2e:admin-inbox-provider-services."
    );
  }
  const dirs = fs
    .readdirSync(DEFAULT_ROOT)
    .map((entry) => path.join(DEFAULT_ROOT, entry))
    .filter((entry) => fs.existsSync(path.join(entry, "report.json")))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!dirs.length) {
    fatal(
      "ADMIN-INBOX-EVIDENCE-002",
      `no evidence directories found under ${DEFAULT_ROOT}`,
      "Run npm run e2e:admin-inbox-provider-services."
    );
  }
  return dirs[0];
}

function readJson(filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    fatal(
      "ADMIN-INBOX-EVIDENCE-003",
      `required evidence file missing or empty: ${filePath}`,
      "Rerun the E2E; do not hand-build partial evidence."
    );
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertNoForbiddenText(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const hits = FORBIDDEN_TEXT.filter((item) => text.includes(item));
  if (hits.length) {
    fatal(
      "ADMIN-INBOX-EVIDENCE-004",
      `${label} contains user-facing forbidden text: ${hits.join(", ")}`,
      "Map raw/internal strings to business-readable admin inbox copy."
    );
  }
}

function assertNoSecrets(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const patterns = [
    /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/i,
    /"(?:privateKey|private_key|authorization|access_token|token|secret|password)"\s*:\s*"(?!\[REDACTED)[^"]+"/i,
    /0x[a-fA-F0-9]{64}/,
  ];
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      fatal(
        "ADMIN-INBOX-EVIDENCE-SECRET",
        `${label} contains secret-like value matching ${pattern}`,
        "Delete the evidence directory, fix redaction, and rerun."
      );
    }
  }
}

const dir = latestEvidenceDir();
const report = readJson(path.join(dir, "report.json"));
const sqlEvidence = readJson(path.join(dir, "sql-evidence.json"));
const screenshotEvidence = readJson(path.join(dir, "screenshot-evidence.json"));

if (report.status !== "success") {
  fatal(
    "ADMIN-INBOX-EVIDENCE-005",
    `report status is ${report.status}; failed=${JSON.stringify(
      report.failed || []
    ).slice(0, 800)}`,
    "Fix the failed E2E step and rerun."
  );
}
if (Array.isArray(report.failed) && report.failed.length > 0) {
  fatal(
    "ADMIN-INBOX-EVIDENCE-006",
    `report has failed entries: ${JSON.stringify(report.failed).slice(0, 800)}`,
    "Fix the failed E2E step and rerun."
  );
}
if (
  !report.generatedAt ||
  Date.now() - Date.parse(report.generatedAt) > MAX_AGE_MS
) {
  fatal(
    "ADMIN-INBOX-EVIDENCE-007",
    "report is missing generatedAt or is older than 72 hours",
    "Rerun npm run e2e:admin-inbox-provider-services."
  );
}

const passedNames = new Set((report.passed || []).map((item) => item.name));
for (const name of [
  "postgres schema ready",
  "sql notification unread",
  "admin-front inbox unread DOM",
  "sql notification read",
  "sql notification archived",
  "sql dedupe",
]) {
  if (!passedNames.has(name)) {
    fatal(
      "ADMIN-INBOX-EVIDENCE-008",
      `required passed step missing: ${name}`,
      "Rerun the E2E and keep all SQL/DOM assertions enabled."
    );
  }
}
if (
  !passedNames.has("provider service pause") &&
  !passedNames.has("provider service action failure notification path")
) {
  fatal(
    "ADMIN-INBOX-EVIDENCE-008",
    "required Provider Services action step missing",
    "Rerun the E2E and ensure pause success or action-failure notification path is asserted."
  );
}
if (
  !passedNames.has("provider service resumed") &&
  !passedNames.has("provider service resume skipped")
) {
  fatal(
    "ADMIN-INBOX-EVIDENCE-008",
    "required Provider Services cleanup step missing",
    "Rerun the E2E and ensure resume cleanup runs or is explicitly skipped when pause fails."
  );
}

for (const screenshot of REQUIRED_SCREENSHOTS) {
  const filePath = path.join(dir, "screenshots", screenshot);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size <= 0) {
    fatal(
      "ADMIN-INBOX-EVIDENCE-009",
      `required screenshot missing or empty: ${filePath}`,
      "Rerun the browser E2E and ensure screenshots are captured."
    );
  }
}

const current = sqlEvidence.afterArchive?.current;
if (!current) {
  fatal(
    "ADMIN-INBOX-EVIDENCE-010",
    "SQL evidence missing afterArchive.current notification row",
    "Ensure the E2E records read/archive SQL evidence."
  );
}
if (
  current.recipientAdminId !== report.environment?.adminId &&
  report.environment?.adminId
) {
  fatal(
    "ADMIN-INBOX-EVIDENCE-011",
    "notification recipient does not match logged-in admin",
    "Fix admin inbox scoping before accepting the E2E."
  );
}
if (!ACCEPTED_EVENT_TYPES.has(current.eventType)) {
  fatal(
    "ADMIN-INBOX-EVIDENCE-012",
    `unexpected eventType: ${current.eventType}`,
    "Provider Services action should produce pause or action_failed admin notification evidence."
  );
}
if (!current.actionUrl?.includes("/provider-services?serviceId=")) {
  fatal(
    "ADMIN-INBOX-EVIDENCE-013",
    `unexpected actionUrl: ${current.actionUrl}`,
    "Admin inbox notification must deep-link to Provider Services."
  );
}
if (!current.readAt || !current.archivedAt) {
  fatal(
    "ADMIN-INBOX-EVIDENCE-014",
    "read_at and archived_at must be set after DOM interactions",
    "Fix inbox mark-read/archive behavior."
  );
}
const duplicateCount = Number(
  sqlEvidence.afterArchive?.duplicateCount?.duplicateCount ?? 0
);
if (duplicateCount > 1) {
  fatal(
    "ADMIN-INBOX-EVIDENCE-015",
    `dedupe key has ${duplicateCount} rows`,
    "Fix notification dedupe before accepting the E2E."
  );
}

for (const [label, value] of Object.entries({
  report,
  sqlEvidence,
  screenshotEvidence,
  reportMd: fs.existsSync(path.join(dir, "report.md"))
    ? fs.readFileSync(path.join(dir, "report.md"), "utf8")
    : "",
})) {
  assertNoForbiddenText(value, label);
  assertNoSecrets(value, label);
}

console.log(`[admin-inbox-provider-services-evidence] passed: ${dir}`);
