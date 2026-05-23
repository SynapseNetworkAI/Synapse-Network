#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE_ROOT = path.join(ROOT, "output/e2e/admin-contract-addresses");
const MAX_AGE_MS = 72 * 60 * 60 * 1000;

const REQUIRED_FILES = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "bugfix-log.md",
  "api-response.json",
  "sql-evidence.json",
  "dom-evidence.json",
  "screenshot-evidence.json",
];

const REQUIRED_CHECKS = [
  "sql:readonly-evidence",
  "admin:login",
  "api:contract-addresses",
  "api:rpc-healthy",
  "api:expected-addresses",
  "api-sql:finance-reconciliation",
  "dom:required-sections",
  "dom:expected-address-tails",
  "dom:api-money-values",
  "dom:forbidden-text",
  "dom:explorer-links",
  "dom:copy-address",
  "dom:console-errors",
];

const REQUIRED_SCREENSHOTS = [
  "screenshots/contract-addresses-overview.png",
  "screenshots/checks.png",
  "screenshots/address-book.png",
  "screenshots/balances.png",
];

const DEFAULT_EXPECTED_ADDRESSES = [
  "0x121a2aDbe1b7d3aA41C47058af790439897a9034",
  "0xA8A49dcd8AC6319ca789316Cc8022e316aF13C33",
  "0x0d0b4b2F8d49e5210e2f023f0508e2fAB6b6c0Ee",
  "0x4967d23cAbe3881f809677932Cc30c11de6957B0",
  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
];

const FORBIDDEN_EVIDENCE_PATTERNS = [
  /private key/i,
  /secret value/i,
  /KMS key material/i,
  /HTTPException/i,
  /Traceback/i,
  /Internal Server Error/i,
  /Unhandled Runtime Error/i,
  /raw RPC/i,
  /SQLSTATE/i,
  /postgres(?:ql)?:\/\/[^@\s]+@/i,
  /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/i,
  /"(?:privateKey|private_key|authorization|access_token|token|secret|password)"\s*:\s*"(?!\[REDACTED)[^"]+"/i,
  /\b0x[a-fA-F0-9]{64}\b/,
];

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  if (process.env.ADMIN_CONTRACT_ADDRESSES_EVIDENCE_DIR) {
    return path.resolve(process.env.ADMIN_CONTRACT_ADDRESSES_EVIDENCE_DIR);
  }
  if (!fs.existsSync(EVIDENCE_ROOT)) return "";
  return (
    fs
      .readdirSync(EVIDENCE_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.endsWith("-local"))
      .map((entry) => path.join(EVIDENCE_ROOT, entry.name))
      .filter((candidate) => fs.existsSync(path.join(candidate, "report.json")))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function readJson(filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    fatal(
      "ADMIN-CONTRACT-ADDRESSES-FILE",
      filePath,
      "Required evidence JSON is missing or empty.",
      "Rerun npm run e2e:admin-contract-addresses-readonly; do not hand-build partial evidence."
    );
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function stringifyEvidence(...values) {
  return values
    .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
    .join("\n");
}

function assertNoForbiddenEvidence(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const hit = FORBIDDEN_EVIDENCE_PATTERNS.find((pattern) => pattern.test(text));
  if (hit) {
    fatal(
      "ADMIN-CONTRACT-ADDRESSES-LEAK",
      label,
      `Evidence contains forbidden internal or secret-like text matching ${hit}.`,
      "Fix redaction/user-facing copy, delete the evidence directory, and rerun the E2E."
    );
  }
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "ADMIN-CONTRACT-ADDRESSES-MISSING",
    "",
    "Admin contract/address evidence is missing.",
    "Run npm run e2e:admin-contract-addresses-readonly before the checker."
  );
}

if (!process.exitCode) {
  for (const file of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(dir, file))) {
      fatal(
        "ADMIN-CONTRACT-ADDRESSES-FILE",
        path.join(dir, file),
        "Evidence bundle is incomplete.",
        "Rerun the E2E; do not hand-assemble partial evidence."
      );
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);

const report = readJson(path.join(dir, "report.json"));
const api = readJson(path.join(dir, "api-response.json"));
const sql = readJson(path.join(dir, "sql-evidence.json"));
const dom = readJson(path.join(dir, "dom-evidence.json"));
const screenshots = readJson(path.join(dir, "screenshot-evidence.json"));
const bugfixLog = fs.readFileSync(path.join(dir, "bugfix-log.md"), "utf8");
const trace = fs.readFileSync(path.join(dir, "trace.jsonl"), "utf8");
const reportMd = fs.readFileSync(path.join(dir, "report.md"), "utf8");

if (
  report.status !== "success" ||
  !Array.isArray(report.failed) ||
  report.failed.length > 0
) {
  fatal(
    "ADMIN-CONTRACT-ADDRESSES-STATUS",
    path.join(dir, "report.json"),
    `Evidence failed: ${JSON.stringify(report.failed || []).slice(0, 1000)}`,
    "Fix the failing API/DOM/SQL checkpoint and rerun the E2E."
  );
}

if (
  !report.generatedAt ||
  Date.now() - Date.parse(report.generatedAt) > MAX_AGE_MS
) {
  fatal(
    "ADMIN-CONTRACT-ADDRESSES-STALE",
    path.join(dir, "report.json"),
    "Evidence is missing generatedAt or is older than 72 hours.",
    "Rerun npm run e2e:admin-contract-addresses-readonly."
  );
}

if (/^\s*-\s*OPEN\b/im.test(bugfixLog)) {
  fatal(
    "ADMIN-CONTRACT-ADDRESSES-BUGFIX",
    path.join(dir, "bugfix-log.md"),
    "Bugfix log contains an open item.",
    "Fix or intentionally close the bug entry before accepting the evidence."
  );
}

if (
  crypto.createHash("sha256").update(trace).digest("hex") !== report.traceDigest
) {
  fatal(
    "ADMIN-CONTRACT-ADDRESSES-DIGEST",
    path.join(dir, "trace.jsonl"),
    "Trace digest does not match report.json.",
    "Rerun the E2E; never edit evidence by hand."
  );
}

const checkMap = new Map((report.checks || []).map((row) => [row.name, row]));
for (const name of REQUIRED_CHECKS) {
  if (checkMap.get(name)?.ok !== true) {
    fatal(
      "ADMIN-CONTRACT-ADDRESSES-CHECK",
      path.join(dir, "report.json"),
      `Required check missing or failed: ${name}`,
      "Rerun the E2E after fixing the contract/address registry path."
    );
  }
}

if (api?.network?.rpcStatus !== "healthy") {
  fatal(
    "ADMIN-CONTRACT-ADDRESSES-RPC",
    path.join(dir, "api-response.json"),
    `Expected healthy local RPC evidence, got ${api?.network?.rpcStatus}.`,
    "Start local chain/RPC or rerun only with explicit degraded evidence if that is intentional."
  );
}

const expectedAddresses = Object.values(
  report.expectedAddresses || DEFAULT_EXPECTED_ADDRESSES
);
const apiText = JSON.stringify(api).toLowerCase();
for (const address of expectedAddresses) {
  if (!apiText.includes(address.toLowerCase())) {
    fatal(
      "ADMIN-CONTRACT-ADDRESSES-ADDRESS",
      path.join(dir, "api-response.json"),
      `Expected address missing from API evidence: ${address}`,
      "Fix config/API aggregation so SynapseCore, USDC, Safe, Ledger, and KMS signer are present."
    );
  }
}

for (const query of sql?.queries || []) {
  if (query.readOnly !== true || !query.sqlSha256) {
    fatal(
      "ADMIN-CONTRACT-ADDRESSES-SQL",
      path.join(dir, "sql-evidence.json"),
      `SQL query evidence is missing readOnly/sqlSha256 metadata: ${query.name}`,
      "Record every SQL query as read-only evidence with a stable hash."
    );
  }
}

for (const key of [
  "adminSchema",
  "financeProjection",
  "reconciliationRuntime",
]) {
  if (!(key in (sql || {}))) {
    fatal(
      "ADMIN-CONTRACT-ADDRESSES-SQL",
      path.join(dir, "sql-evidence.json"),
      `SQL evidence missing ${key}.`,
      "Capture admin schema, finance projection, and reconciliation read-model evidence."
    );
  }
}

if (
  !Array.isArray(dom) ||
  !dom.some((row) => row.route === "/contract-addresses")
) {
  fatal(
    "ADMIN-CONTRACT-ADDRESSES-DOM",
    path.join(dir, "dom-evidence.json"),
    "DOM evidence for /contract-addresses is missing.",
    "Visit the page after API/SQL checkpoints and record DOM assertions."
  );
}

for (const file of REQUIRED_SCREENSHOTS) {
  if (!fs.existsSync(path.join(dir, file))) {
    fatal(
      "ADMIN-CONTRACT-ADDRESSES-SCREENSHOT",
      path.join(dir, "screenshot-evidence.json"),
      `Required screenshot file missing: ${file}`,
      "Capture overview, checks, address book, and balances screenshots."
    );
  }
}

for (const row of screenshots || []) {
  if (
    row.forbiddenTextAbsent !== true ||
    !row.domCheckpoint ||
    !row.apiCheckpoint ||
    !row.sqlCheckpoint ||
    !fs.existsSync(path.join(dir, row.file || ""))
  ) {
    fatal(
      "ADMIN-CONTRACT-ADDRESSES-SCREENSHOT-CHECKPOINT",
      path.join(dir, "screenshot-evidence.json"),
      "Screenshot is missing DOM/API/SQL checkpoint binding or file is missing.",
      "Record screenshot evidence with file/url/expectedText/forbiddenTextAbsent/domCheckpoint/apiCheckpoint/sqlCheckpoint/capturedAt."
    );
  }
}

assertNoForbiddenEvidence(api, path.join(dir, "api-response.json"));
assertNoForbiddenEvidence(dom, path.join(dir, "dom-evidence.json"));
assertNoForbiddenEvidence(
  screenshots,
  path.join(dir, "screenshot-evidence.json")
);
assertNoForbiddenEvidence(trace, path.join(dir, "trace.jsonl"));
assertNoForbiddenEvidence(reportMd, path.join(dir, "report.md"));
assertNoForbiddenEvidence(bugfixLog, path.join(dir, "bugfix-log.md"));
assertNoForbiddenEvidence(
  stringifyEvidence(sql),
  path.join(dir, "sql-evidence.json")
);

if (!process.exitCode) {
  console.log(
    `admin contract/address evidence passed: ${path.relative(ROOT, dir)}`
  );
}

process.exit(process.exitCode || 0);
