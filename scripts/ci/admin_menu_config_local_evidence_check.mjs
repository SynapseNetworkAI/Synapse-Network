#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  EVIDENCE_ROOT,
  FORBIDDEN_EVIDENCE_PATTERNS,
  REQUIRED_BUSINESS_POLICY_TABS,
  REQUIRED_CHECKS,
  REQUIRED_FILES,
  REQUIRED_MENU_ITEMS,
  REQUIRED_SCREENSHOTS,
} from "../lib/admin_menu_config_local_contract.mjs";

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  if (process.env.ADMIN_MENU_CONFIG_EVIDENCE_DIR) {
    return path.resolve(process.env.ADMIN_MENU_CONFIG_EVIDENCE_DIR);
  }
  if (!fs.existsSync(EVIDENCE_ROOT)) return "";
  return (
    fs
      .readdirSync(EVIDENCE_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(EVIDENCE_ROOT, entry.name))
      .filter((candidate) => fs.existsSync(path.join(candidate, "report.json")))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function requireFile(dir, file) {
  const filePath = path.join(dir, file);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size <= 0) {
    fatal(
      "ADMIN-MENU-CONFIG-FILE",
      filePath,
      "Admin menu config local evidence bundle is incomplete.",
      "rerun npm run e2e:admin-menu-config:local and keep the generated bundle intact."
    );
  }
}

function requireCheck(report, dir, name) {
  const checks = new Map((report.checks || []).map((row) => [row.name, row]));
  if (checks.get(name)?.ok !== true) {
    fatal(
      "ADMIN-MENU-CONFIG-CHECK",
      path.join(dir, "report.json"),
      `Required check missing or failed: ${name}`,
      "fix the local E2E failure and rerun the evidence generator."
    );
  }
}

function requireConfigCenterApi(api, dir, runIndex) {
  const row = api.find((entry) => entry.runIndex === runIndex);
  const requiredItems = new Map(
    (row?.requiredItems || []).map((entry) => [
      entry.expected?.itemId,
      entry.actual,
    ])
  );
  const ok =
    row?.requiredMatch === true &&
    REQUIRED_MENU_ITEMS.every((expected) =>
      menuItemMatches(requiredItems.get(expected.itemId), expected)
    );
  if (!ok) {
    fatal(
      "ADMIN-MENU-CONFIG-API",
      path.join(dir, "api-evidence.json"),
      `Visible menu API did not prove config-center on run ${runIndex}.`,
      "ensure gateway-admin visible menu reads admin_config_documents and backfills config-center."
    );
  }
}

function requireDomProof(dom, dir, route, runIndex) {
  const row = dom.find(
    (entry) => entry.runIndex === runIndex && entry.route === route
  );
  requireBaseDomProof(row, dir, route, runIndex);
  if (route === "/config") requireOverviewSplitProof(row, dir, runIndex);
  if (route === "/config/business-policy")
    requireBusinessTabProof(row, dir, runIndex);
  if (route === "/config/runtime")
    requireRuntimeRedactionProof(row, dir, runIndex);
  if (route === "/config/published")
    requirePublishedCollapseProof(row, dir, runIndex);
}

function menuItemMatches(item, expected) {
  return (
    item?.itemId === expected.itemId &&
    item?.label === expected.label &&
    item?.href === expected.href &&
    item?.parentItemId === expected.parentItemId &&
    item?.nodeType === expected.nodeType
  );
}

function requireBaseDomProof(row, dir, route, runIndex) {
  if (
    row &&
    row.forbiddenTextAbsent === true &&
    Array.isArray(row.missing) &&
    row.missing.length === 0
  ) {
    return;
  }
  fatal(
    "ADMIN-MENU-CONFIG-DOM",
    path.join(dir, "dom-evidence.json"),
    `DOM proof missing or failed for ${route} run ${runIndex}.`,
    "capture sidebar and /config DOM checkpoints after a real password-only login."
  );
}

function requireOverviewSplitProof(row, dir, runIndex) {
  if (
    row.overviewNoBusinessPolicyFields === true &&
    row.overviewNoRawJson === true
  )
    return;
  fatal(
    "ADMIN-MENU-CONFIG-OVERVIEW-SPLIT",
    path.join(dir, "dom-evidence.json"),
    `/config run ${runIndex} did not prove the overview is free of business policy form fields and raw JSON.`,
    "assert the overview page has only status metrics and entry cards before taking screenshots."
  );
}

function requireBusinessTabProof(row, dir, runIndex) {
  const tabProofs = Array.isArray(row.tabProofs) ? row.tabProofs : [];
  const tabsOk = REQUIRED_BUSINESS_POLICY_TABS.every((tab) =>
    tabProofOk(tabProofs, tab)
  );
  if (tabsOk) return;
  fatal(
    "ADMIN-MENU-CONFIG-BUSINESS-TABS",
    path.join(dir, "dom-evidence.json"),
    `/config/business-policy run ${runIndex} did not prove all four tabs render their own fields.`,
    "click Finance, Consumer Withdraw, Risk, and Reconciliation and record field-level DOM proof."
  );
}

function tabProofOk(tabProofs, tab) {
  const proof = tabProofs.find((entry) => entry.tab === tab);
  return (
    proof?.ok === true &&
    Array.isArray(proof.missing) &&
    proof.missing.length === 0 &&
    Array.isArray(proof.expectedTexts) &&
    proof.expectedTexts.length > 0
  );
}

function requireRuntimeRedactionProof(row, dir, runIndex) {
  if (row.runtimeRawValuesAbsent === true) return;
  fatal(
    "ADMIN-MENU-CONFIG-RUNTIME-REDACTION",
    path.join(dir, "dom-evidence.json"),
    `/config/runtime run ${runIndex} did not prove raw secret/DSN values are absent.`,
    "assert runtime only displays source/configured status and redacts sensitive values."
  );
}

function requirePublishedCollapseProof(row, dir, runIndex) {
  if (row.publishedRawJsonCollapsed === true) return;
  fatal(
    "ADMIN-MENU-CONFIG-PUBLISHED-COLLAPSED",
    path.join(dir, "dom-evidence.json"),
    `/config/published run ${runIndex} did not prove raw JSON is collapsed by default.`,
    "assert the raw JSON details element is closed before taking screenshots."
  );
}

function requireScreenshots(dir, screenshots) {
  const screenshotFiles = new Set(screenshots.map((row) => row.file));
  for (const file of REQUIRED_SCREENSHOTS) {
    const filePath = path.join(dir, file);
    if (!screenshotFiles.has(file) || !fs.existsSync(filePath)) {
      fatal(
        "ADMIN-MENU-CONFIG-SCREENSHOT",
        path.join(dir, "screenshot-evidence.json"),
        `Required screenshot is missing: ${file}`,
        "rerun the Playwright E2E; do not hand-assemble screenshot evidence."
      );
      continue;
    }
    if (fs.statSync(filePath).size <= 0) {
      fatal(
        "ADMIN-MENU-CONFIG-SCREENSHOT-EMPTY",
        filePath,
        "Screenshot exists but is empty.",
        "rerun the E2E with a healthy local Admin-front browser session."
      );
    }
  }
  for (const row of screenshots) {
    if (
      row.forbiddenTextAbsent !== true ||
      row.domCheckpoint !== true ||
      !row.apiCheckpoint
    ) {
      fatal(
        "ADMIN-MENU-CONFIG-SCREENSHOT-CHECKPOINT",
        path.join(dir, "screenshot-evidence.json"),
        "Screenshot is not bound to DOM/API checkpoints.",
        "write screenshot evidence only after the matching UI and API assertions pass."
      );
    }
  }
}

function requireDbProof(db, dir) {
  const splitMatches = db.configSplitMatches || {};
  const menuOk = REQUIRED_MENU_ITEMS.every((expected) =>
    dbMenuItemMatches(splitMatches[expected.itemId], expected)
  );
  const dbOk =
    db.documentExists === true &&
    db.configCenterExists === true &&
    db.configCenterMatches === true &&
    menuOk &&
    db.item?.itemId === "config-center" &&
    db.item?.href === "/config";
  if (dbOk) return;
  fatal(
    "ADMIN-MENU-CONFIG-DB",
    path.join(dir, "db-evidence.json"),
    "DB proof does not show published admin_menu_config contains config-center -> /config.",
    "verify admin_config_documents has admin_menu_config published payload after visible menu read."
  );
}

function dbMenuItemMatches(item, expected) {
  return (
    item?.href === expected.href &&
    item?.parentItemId === expected.parentItemId &&
    item?.nodeType === expected.nodeType
  );
}

function requireAuthPolicy(policy, dir) {
  if (policy.loginTotpRequired !== false) {
    fatal(
      "ADMIN-MENU-CONFIG-AUTH-POLICY",
      path.join(dir, "auth-policy-evidence.json"),
      "Local auth policy still requires Google Authenticator at login.",
      "restart gateway-admin locally with ADMIN_GOOGLE_AUTHENTICATOR_LOGIN_ENABLED=false."
    );
  }
}

function requirePasswordOnlyLoginRuns(report, dir) {
  const runs = Array.isArray(report.loginRuns) ? report.loginRuns : [];
  for (const runIndex of [1, 2]) {
    const row = runs.find((entry) => entry.runIndex === runIndex);
    if (
      !row ||
      row.passwordOnly !== true ||
      row.loginTotpRequired !== false ||
      !String(row.landedUrl || "").includes("/dashboard")
    ) {
      fatal(
        "ADMIN-MENU-CONFIG-PASSWORD-LOGIN",
        path.join(dir, "report.json"),
        `Password-only login run ${runIndex} was not proven.`,
        "rerun the browser E2E and keep loginRuns with passwordOnly=true and loginTotpRequired=false."
      );
    }
  }
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "ADMIN-MENU-CONFIG-MISSING",
    "",
    "Admin menu config local E2E evidence is missing.",
    "run npm run e2e:admin-menu-config:local before this checker."
  );
}

if (!process.exitCode) {
  for (const file of REQUIRED_FILES) requireFile(dir, file);
  for (const file of REQUIRED_SCREENSHOTS) requireFile(dir, file);
}

if (process.exitCode) process.exit(process.exitCode);

const report = readJson(path.join(dir, "report.json"));
const api = readJson(path.join(dir, "api-evidence.json"));
const dom = readJson(path.join(dir, "dom-evidence.json"));
const db = readJson(path.join(dir, "db-evidence.json"));
const screenshots = readJson(path.join(dir, "screenshot-evidence.json"));
const authPolicy = readJson(path.join(dir, "auth-policy-evidence.json"));
const trace = fs.readFileSync(path.join(dir, "trace.jsonl"), "utf8");

if (report.status !== "success" || (report.failed || []).length > 0) {
  fatal(
    "ADMIN-MENU-CONFIG-STATUS",
    path.join(dir, "report.json"),
    `Evidence status is not successful: ${JSON.stringify(report.failed || [])}`,
    "fix the failing checkpoint and rerun the local E2E."
  );
}

if (
  crypto.createHash("sha256").update(trace).digest("hex") !== report.traceDigest
) {
  fatal(
    "ADMIN-MENU-CONFIG-DIGEST",
    path.join(dir, "trace.jsonl"),
    "Trace digest does not match report.json.",
    "rerun the E2E; never edit evidence by hand."
  );
}

for (const name of REQUIRED_CHECKS) requireCheck(report, dir, name);
requireAuthPolicy(authPolicy, dir);
requirePasswordOnlyLoginRuns(report, dir);
requireConfigCenterApi(api, dir, 1);
requireConfigCenterApi(api, dir, 2);
requireDomProof(dom, dir, "/dashboard", 1);
requireDomProof(dom, dir, "/dashboard", 2);
requireDomProof(dom, dir, "/config", 1);
requireDomProof(dom, dir, "/config", 2);
requireDomProof(dom, dir, "/config/business-policy", 1);
requireDomProof(dom, dir, "/config/business-policy", 2);
requireDomProof(dom, dir, "/config/runtime", 1);
requireDomProof(dom, dir, "/config/runtime", 2);
requireDomProof(dom, dir, "/config/published", 1);
requireDomProof(dom, dir, "/config/published", 2);
requireDbProof(db, dir);
requireScreenshots(dir, screenshots);

const evidenceText = [
  JSON.stringify(report),
  JSON.stringify(api),
  JSON.stringify(dom),
  JSON.stringify(db),
  JSON.stringify(screenshots),
  JSON.stringify(authPolicy),
  trace,
].join("\n");
for (const pattern of FORBIDDEN_EVIDENCE_PATTERNS) {
  if (pattern.test(evidenceText)) {
    fatal(
      "ADMIN-MENU-CONFIG-SECRET",
      dir,
      `Evidence contains forbidden secret-like text: ${pattern}`,
      "redact credentials, bearer tokens, cookies, and DSNs before writing evidence."
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`PASS admin menu config local evidence: ${dir}`);
