#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE_ROOT = path.join(
  ROOT,
  "output/dogfood/user-front-copyable-identifiers"
);
const REQUIRED_FILES = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "bugfix-log.md",
  "dom-evidence.json",
  "clipboard-evidence.json",
  "screenshot-evidence.json",
];
const REQUIRED_CHECKS = [
  "billing:copy",
  "invocations:copy-and-privacy",
  "account-settings:wallet-copy",
  "credentials:secret-copy",
  "agents:agent-id-copy",
  "provider-services:copy",
  "provider-health:copy",
  "provider-usage:copy",
  "provider-settlements:copy",
  "provider-withdraw:copy",
];
const REQUIRED_CLIPBOARD = [
  ["billing", "Transaction ID"],
  ["billing", "Transaction hash"],
  ["invocations", "Invocation ID"],
  ["invocations", "Service"],
  ["invocations", "Agent"],
  ["account-settings", "Wallet"],
  ["credentials", "Secret API Key"],
  ["agents", "Agent ID"],
  ["provider-services", "Invoke URL"],
  ["provider-services", "Service ID"],
  ["provider-health", "Service ID"],
  ["provider-usage", "Service ID"],
  ["provider-settlements", "Withdrawal ID"],
  ["provider-settlements", "Nonce"],
  ["provider-settlements", "Tx Hash"],
  ["provider-withdraw", "Withdrawal ID"],
  ["provider-withdraw", "Nonce"],
  ["provider-withdraw", "Tx Hash"],
];

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  if (process.env.USER_FRONT_COPYABLE_IDENTIFIERS_EVIDENCE_DIR) {
    return path.resolve(
      process.env.USER_FRONT_COPYABLE_IDENTIFIERS_EVIDENCE_DIR
    );
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function secretLeakText(...values) {
  return values
    .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
    .join("\n");
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "USER-FRONT-COPYABLE-MISSING",
    "",
    "Copyable identifier E2E evidence is missing.",
    "run npm run e2e:user-front-copyable-identifiers before the checker."
  );
}

if (!process.exitCode) {
  for (const file of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(dir, file))) {
      fatal(
        "USER-FRONT-COPYABLE-FILE",
        path.join(dir, file),
        "Evidence bundle is incomplete.",
        "rerun the E2E; do not hand-assemble partial evidence."
      );
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);

const report = readJson(path.join(dir, "report.json"));
const dom = readJson(path.join(dir, "dom-evidence.json"));
const clipboard = readJson(path.join(dir, "clipboard-evidence.json"));
const screenshots = readJson(path.join(dir, "screenshot-evidence.json"));
const bugfixLog = fs.readFileSync(path.join(dir, "bugfix-log.md"), "utf8");
const trace = fs.readFileSync(path.join(dir, "trace.jsonl"), "utf8");

if (
  report.status !== "success" ||
  !Array.isArray(report.failed) ||
  report.failed.length > 0
) {
  fatal(
    "USER-FRONT-COPYABLE-STATUS",
    path.join(dir, "report.json"),
    `Evidence failed: ${JSON.stringify(report.failed || []).slice(0, 800)}`,
    "fix the failing DOM/clipboard case and rerun the E2E."
  );
}

if (/^\s*-\s*OPEN\b/im.test(bugfixLog)) {
  fatal(
    "USER-FRONT-COPYABLE-BUGFIX",
    path.join(dir, "bugfix-log.md"),
    "Bugfix log contains an open item.",
    "fix or intentionally close the bug entry before accepting the evidence."
  );
}

if (
  crypto.createHash("sha256").update(trace).digest("hex") !== report.traceDigest
) {
  fatal(
    "USER-FRONT-COPYABLE-DIGEST",
    path.join(dir, "trace.jsonl"),
    "Trace digest does not match report.json.",
    "rerun the E2E; never edit evidence by hand."
  );
}

const checkMap = new Map((report.checks || []).map((row) => [row.name, row]));
for (const name of REQUIRED_CHECKS) {
  if (checkMap.get(name)?.ok !== true) {
    fatal(
      "USER-FRONT-COPYABLE-CHECK",
      path.join(dir, "report.json"),
      `Required check missing or failed: ${name}`,
      "rerun the copyable identifier E2E after fixing the page."
    );
  }
}

const clipboardMap = new Map(
  clipboard.map((row) => [`${row.page}::${row.label}`, row])
);
for (const [page, label] of REQUIRED_CLIPBOARD) {
  const row = clipboardMap.get(`${page}::${label}`);
  if (!row || row.ok !== true || row.clipboardText !== row.expectedValue) {
    fatal(
      "USER-FRONT-COPYABLE-CLIPBOARD",
      path.join(dir, "clipboard-evidence.json"),
      `Clipboard checkpoint missing or wrong for ${page} / ${label}`,
      "click the copy button, read browser clipboard, and record expected/full value equality."
    );
  }
  if (row.toastRequired !== false && row.toastSeen !== true) {
    fatal(
      "USER-FRONT-COPYABLE-TOAST",
      path.join(dir, "clipboard-evidence.json"),
      `Copied toast missing for ${page} / ${label}`,
      "ensure the shared CopyableValue copied toast is visible after clicking the copy button."
    );
  }
}

for (const row of dom) {
  if (row.forbiddenTextAbsent !== true) {
    fatal(
      "USER-FRONT-COPYABLE-PRIVACY",
      path.join(dir, "dom-evidence.json"),
      `Forbidden text appeared on ${row.page}: ${JSON.stringify(
        row.forbidden
      )}`,
      "keep internal principals, counterparty labels, provider wallet addresses, and auth blockers out of user pages."
    );
  }
}

if (!Array.isArray(screenshots) || screenshots.length < 6) {
  fatal(
    "USER-FRONT-COPYABLE-SCREENSHOTS",
    path.join(dir, "screenshot-evidence.json"),
    "Screenshot evidence is missing or too sparse.",
    "capture screenshots after DOM and clipboard checkpoints pass."
  );
}

for (const row of screenshots) {
  if (
    row.forbiddenTextAbsent !== true ||
    !row.domCheckpoint ||
    !fs.existsSync(path.join(dir, row.file || ""))
  ) {
    fatal(
      "USER-FRONT-COPYABLE-SCREENSHOT-CHECKPOINT",
      path.join(dir, "screenshot-evidence.json"),
      "A screenshot is missing its DOM checkpoint, forbidden-text proof, or file.",
      "bind every screenshot to a DOM checkpoint and write the PNG under screenshots/."
    );
  }
}

const evidenceText = secretLeakText(report, dom, clipboard, screenshots, trace);
for (const pattern of [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /agent:agent:/,
  /Counterparty/,
]) {
  if (pattern.test(evidenceText)) {
    fatal(
      "USER-FRONT-COPYABLE-SECRET-OR-PRIVACY-LEAK",
      dir,
      `Evidence matched forbidden pattern ${pattern}.`,
      "redact tokens and ensure internal runtime principals/counterparty labels do not appear in DOM evidence."
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log("[user-front-copyable-identifiers] evidence passed");
