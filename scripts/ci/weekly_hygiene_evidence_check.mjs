#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const OUT_ROOT = path.join(ROOT, "output", "weekly-hygiene");
const REQUIRED_FILES = ["report.json", "report.md", "issue.md"];
const REQUIRED_CHECK_IDS = [
  "code-quality-budget",
  "code-architecture-quality",
  "code-format-check",
  "code-diff-coverage",
  "docs-governance",
  "money-state-idempotency",
  "money-finance-approval",
  "schema-created-at-indexes",
  "evidence-withdrawal-idempotency",
  "evidence-admin-regression",
  "evidence-user-front-deposit-balance",
  "evidence-admin-pagination-sorting",
  "evidence-backup-restore",
];

function fail(message, fix) {
  console.error(`FATAL WEEKLY-HYGIENE-EVIDENCE-001: ${message}`);
  if (fix) console.error(`Agent fix: ${fix}`);
  process.exit(1);
}

function latestDir() {
  if (process.env.WEEKLY_HYGIENE_EVIDENCE_DIR) {
    return path.resolve(process.env.WEEKLY_HYGIENE_EVIDENCE_DIR);
  }
  const pointer = path.join(OUT_ROOT, "latest.json");
  if (fs.existsSync(pointer)) {
    const parsed = readJson(pointer);
    if (parsed.reportDir) return path.resolve(ROOT, parsed.reportDir);
  }
  if (!fs.existsSync(OUT_ROOT)) {
    fail(
      "output/weekly-hygiene does not exist",
      "Run npm run weekly:hygiene -- --dry-run first."
    );
  }
  const dirs = fs
    .readdirSync(OUT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(OUT_ROOT, entry.name))
    .sort();
  if (dirs.length === 0) {
    fail(
      "no weekly hygiene evidence directory exists",
      "Run npm run weekly:hygiene -- --dry-run first."
    );
  }
  return dirs.at(-1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(
      `${filePath} is not valid JSON: ${error.message}`,
      "Regenerate weekly hygiene evidence."
    );
  }
}

function containsSecretLikeMaterial(text) {
  return [
    /postgres(?:ql)?:\/\/[^/\s]+:[^@\s]+@/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b(?:sk|pk|agt|ghp|github_pat)_[A-Za-z0-9_=-]{16,}\b/,
    /\b0x[a-fA-F0-9]{64}\b/,
    /(password|secret|token|private[_-]?key)=(?!\[REDACTED\])([^\s&\]]+)/i,
  ].some((pattern) => pattern.test(text));
}

const dir = latestDir();
for (const fileName of REQUIRED_FILES) {
  if (!fs.existsSync(path.join(dir, fileName))) {
    fail(
      `missing ${fileName} in ${dir}`,
      "Regenerate the weekly hygiene bundle."
    );
  }
}

const reportPath = path.join(dir, "report.json");
const report = readJson(reportPath);
if (report.schemaVersion !== "weekly-hygiene:v1") {
  fail(
    "report schemaVersion is not weekly-hygiene:v1",
    "Use scripts/ops/weekly_hygiene.mjs to generate the report."
  );
}
if (!["success", "attention_required"].includes(report.status)) {
  fail(
    `invalid report status ${report.status}`,
    "Report status must be success or attention_required."
  );
}
const generatedAt = Date.parse(report.generatedAt || "");
if (!Number.isFinite(generatedAt)) {
  fail(
    "report.generatedAt is missing or invalid",
    "Write an ISO generatedAt timestamp."
  );
}
const maxAgeHours = Number(process.env.WEEKLY_HYGIENE_MAX_AGE_HOURS || "72");
const ageHours = (Date.now() - generatedAt) / 3_600_000;
if (ageHours < -0.1 || ageHours > maxAgeHours) {
  fail(
    `weekly hygiene evidence is stale (${ageHours.toFixed(2)}h old)`,
    "Rerun npm run weekly:hygiene."
  );
}
if (report.mode !== "report+issue") {
  fail(
    "report mode is not report+issue",
    "Weekly hygiene must remain in Report + Issue mode by default."
  );
}
if (
  report.safety?.productionMutationAllowed !== false ||
  report.safety?.trackedDeletionAllowed !== false
) {
  fail(
    "safety flags allow production mutation or tracked deletion",
    "Keep weekly hygiene report-only for production and tracked files."
  );
}
const commandIds = new Set(
  (report.commandResults || []).map((item) => item.id)
);
for (const id of REQUIRED_CHECK_IDS) {
  if (!commandIds.has(id)) {
    fail(
      `report is missing check id ${id}`,
      "Keep the weekly hygiene command matrix complete."
    );
  }
}
for (const candidate of report.cleanupCandidates || []) {
  if (candidate.tracked && candidate.action !== "report-only") {
    fail(
      `tracked cleanup candidate ${candidate.path} is not report-only`,
      "Tracked files must never be auto-deleted."
    );
  }
}
if (report.status === "success" && report.issueRequired !== false) {
  fail(
    "successful report still requires an issue",
    "Only attention_required reports should request GitHub issue output."
  );
}
if (
  report.status === "attention_required" &&
  !report.dryRun &&
  report.issueRequired !== true
) {
  fail(
    "attention_required non-dry-run report does not request an issue",
    "Set issueRequired=true for weekly failures or warnings."
  );
}

const combined = REQUIRED_FILES.map((fileName) =>
  fs.readFileSync(path.join(dir, fileName), "utf8")
).join("\n");
if (containsSecretLikeMaterial(combined)) {
  fail(
    "weekly hygiene evidence contains secret-like or raw identity material",
    "Redact DSNs, tokens, emails, private keys, and 64-byte hex values."
  );
}

console.log(
  `[ci:weekly-hygiene-evidence] validated ${path.relative(ROOT, dir)}`
);
