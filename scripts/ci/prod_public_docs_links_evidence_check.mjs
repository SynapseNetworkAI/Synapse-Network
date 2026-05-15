#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE_ROOT = path.join(ROOT, "docs/evidence/prod/public-links");
const REQUIRED_FILES = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "environment-manifest.json",
];
const REQUIRED_CHECKS = [
  "www_home",
  "www_llms",
  "docs_home",
  "docs_api_reference",
  "docs_api_reference_markdown",
  "docs_api_reference_github",
  "docs_api_reference_open_menu",
  "docs_agent_builders_open_menu",
  "gateway_health",
  "admin_gate",
  "admin_api_gate",
];

function fail(code, why, fix) {
  console.error(`FATAL ${code}: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exit(1);
}

function latestEvidenceDir() {
  if (!fs.existsSync(EVIDENCE_ROOT)) return "";
  return (
    fs
      .readdirSync(EVIDENCE_ROOT, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && entry.name.endsWith("-prod-public-links")
      )
      .map((entry) => path.join(EVIDENCE_ROOT, entry.name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

const dir = latestEvidenceDir();
if (!dir) {
  fail(
    "PROD-PUBLIC-DOCS-EVIDENCE-001",
    "prod public docs evidence is missing.",
    "run npm run e2e:prod-public-docs-links and regenerate evidence."
  );
}

for (const fileName of REQUIRED_FILES) {
  const filePath = path.join(dir, fileName);
  if (!fs.existsSync(filePath)) {
    fail(
      "PROD-PUBLIC-DOCS-EVIDENCE-002",
      `required artifact missing: ${fileName}`,
      "rerun npm run e2e:prod-public-docs-links."
    );
  }
}

const report = JSON.parse(
  fs.readFileSync(path.join(dir, "report.json"), "utf8")
);

if (report.environment !== "prod") {
  fail(
    "PROD-PUBLIC-DOCS-EVIDENCE-003",
    `report environment must be prod; got ${report.environment}`,
    "rerun the prod public docs validation against prod URLs."
  );
}

if (report.status !== "success" || (report.failed || []).length > 0) {
  fail(
    "PROD-PUBLIC-DOCS-EVIDENCE-004",
    `report status=${report.status}; failed=${JSON.stringify(
      report.failed || []
    )}`,
    "fix the failing prod public link or gate check and regenerate evidence."
  );
}

const generatedAt = Date.parse(report.generatedAt || "");
const maxAgeHours = Number(process.env.PROD_PUBLIC_DOCS_MAX_AGE_HOURS || "72");
const ageHours = (Date.now() - generatedAt) / 3_600_000;
if (
  !Number.isFinite(generatedAt) ||
  ageHours < -0.1 ||
  ageHours > maxAgeHours
) {
  fail(
    "PROD-PUBLIC-DOCS-EVIDENCE-005",
    `evidence is stale or invalid; age=${
      Number.isFinite(ageHours) ? ageHours.toFixed(2) : "invalid"
    }h`,
    "rerun npm run e2e:prod-public-docs-links."
  );
}

const checks = new Map((report.checks || []).map((item) => [item.name, item]));
for (const name of REQUIRED_CHECKS) {
  const check = checks.get(name);
  if (!check || check.ok !== true) {
    fail(
      "PROD-PUBLIC-DOCS-EVIDENCE-006",
      `required check is missing or failed: ${name}`,
      "fix the prod surface and rerun npm run e2e:prod-public-docs-links."
    );
  }
}

console.log(`[ci:prod-public-docs-links-evidence] validated ${dir}`);
