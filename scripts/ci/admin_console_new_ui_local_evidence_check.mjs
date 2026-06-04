#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { adminConsoleRouteSpecs } from "../lib/admin_console_new_ui_contract.mjs";
import {
  FORBIDDEN_EVIDENCE_PATTERNS,
  ROOT,
} from "../lib/admin_menu_config_local_contract.mjs";

const evidenceRoot = path.join(ROOT, "output/e2e/admin-console-new-ui-local");
const requiredFiles = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "api-evidence.json",
  "db-evidence.json",
  "dom-evidence.json",
  "screenshot-evidence.json",
];

function fail(file, message, hint = "") {
  console.error(`[admin-console-new-ui-evidence] FAIL ${file}: ${message}`);
  if (hint) console.error(`hint: ${hint}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  const explicit = process.env.ADMIN_CONSOLE_NEW_UI_EVIDENCE_DIR;
  if (explicit) return path.resolve(explicit);
  if (!fs.existsSync(evidenceRoot)) {
    return null;
  }
  const entries = fs
    .readdirSync(evidenceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(evidenceRoot, entry.name),
      mtimeMs: fs.statSync(path.join(evidenceRoot, entry.name)).mtimeMs,
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return entries[0]?.path || null;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(file, error instanceof Error ? error.message : String(error));
    return null;
  }
}

function requireFiles(dir) {
  for (const file of requiredFiles) {
    const fullPath = path.join(dir, file);
    if (!fs.existsSync(fullPath)) {
      fail(
        fullPath,
        "required evidence file missing",
        "rerun npm run e2e:admin-console-new-ui:local"
      );
    }
  }
}

function requireReport(report, routes) {
  if (!report) return;
  if (report.status !== "success") {
    fail("report.json", `expected success, got ${String(report.status)}`);
  }
  if (Array.isArray(report.failed) && report.failed.length > 0) {
    fail("report.json", `failed checks present: ${report.failed.length}`);
  }
  if (report.routeCount !== routes.length) {
    fail(
      "report.json",
      `routeCount ${report.routeCount} does not match ${routes.length}`
    );
  }
}

function requireApi(api) {
  if (!Array.isArray(api)) {
    fail("api-evidence.json", "API evidence must be an array");
    return;
  }
  const policy = api.find((row) => row.route === "/api/admin/v1/auth/policy");
  if (policy?.loginTotpRequired !== false) {
    fail(
      "api-evidence.json",
      "loginTotpRequired must be false for local evidence"
    );
  }
  const menu = api.find(
    (row) => row.route === "/api/admin/v1/config/menu-items/visible"
  );
  if (!menu?.ok || !Array.isArray(menu.itemIds) || menu.itemIds.length === 0) {
    fail("api-evidence.json", "visible menu API evidence is missing item ids");
  }
}

function requireDb(db) {
  if (!Array.isArray(db)) {
    fail("db-evidence.json", "DB evidence must be an array");
    return;
  }
  const published = db.find((row) => row.source === "admin_config_documents");
  if (
    !published ||
    !Array.isArray(published.items) ||
    published.items.length === 0
  ) {
    fail(
      "db-evidence.json",
      "published admin_menu_config items were not proven from DB"
    );
  }
  const comparison = db.find((row) => row.source === "visible-menu-vs-db");
  if (
    !comparison ||
    !Array.isArray(comparison.mismatches) ||
    comparison.mismatches.length > 0
  ) {
    fail(
      "db-evidence.json",
      "visible menu API was not proven to match published DB menu"
    );
  }
}

function hasNewShellProof(row) {
  return (
    row.uiSystem === "shadcn-token-console" &&
    row.shellOk === true &&
    row.sidebarOk === true &&
    row.topbarOk === true
  );
}

function hasExpectedTextProof(row) {
  return Array.isArray(row.expectedTexts) && row.expectedTexts.length > 0;
}

function hasMissingTexts(row) {
  return Array.isArray(row.missingTexts) && row.missingTexts.length > 0;
}

function requireDomRoute(row, spec) {
  if (!hasNewShellProof(row)) {
    fail(
      "dom-evidence.json",
      `route ${spec.route} did not prove the new UI shell`
    );
  }
  if (
    row.expectedPath !== spec.expectedPath ||
    row.actualPath !== spec.expectedPath
  ) {
    fail(
      "dom-evidence.json",
      `route ${spec.route} expected final path ${spec.expectedPath}, got ${row.actualPath}`
    );
  }
  if (!hasExpectedTextProof(row)) {
    fail("dom-evidence.json", `route ${spec.route} lacks expected text proof`);
  }
  if (row.navigation !== "sidebar-row-click") {
    fail(
      "dom-evidence.json",
      `route ${spec.route} was not reached by sidebar row click`
    );
  }
  if (hasMissingTexts(row)) {
    fail(
      "dom-evidence.json",
      `route ${spec.route} has missing texts: ${row.missingTexts.join(", ")}`
    );
  }
  for (const text of spec.expectedTexts) {
    if (!row.expectedTexts?.includes(text)) {
      fail(
        "dom-evidence.json",
        `route ${spec.route} omitted expected text ${text}`
      );
    }
  }
}

function requireDom(dom, routeSpecs) {
  if (!Array.isArray(dom)) {
    fail("dom-evidence.json", "DOM evidence must be an array");
    return;
  }
  const byRoute = new Map(dom.map((row) => [row.route, row]));
  for (const spec of routeSpecs) {
    const row = byRoute.get(spec.route);
    if (!row) {
      fail("dom-evidence.json", `missing DOM checkpoint for ${spec.route}`);
      continue;
    }
    requireDomRoute(row, spec);
  }
}

function isLoginScreenshot(row) {
  return row.name === "login-no-google-fa";
}

function requireScreenshotFile(dir, file) {
  const fullPath = path.join(dir, file);
  if (!file.startsWith("screenshots/") || !fs.existsSync(fullPath)) {
    fail("screenshot-evidence.json", `missing screenshot file ${file}`);
    return;
  }
  if (fs.statSync(fullPath).size <= 1024) {
    fail(fullPath, "screenshot file is empty or too small");
  }
}

function requireScreenshotRouteProof(row, file) {
  if (!isLoginScreenshot(row) && row.uiSystem !== "shadcn-token-console") {
    fail(
      "screenshot-evidence.json",
      `screenshot ${file} is not bound to the tokenized UI shell`
    );
  }
  if (!isLoginScreenshot(row) && !hasExpectedTextProof(row)) {
    fail(
      "screenshot-evidence.json",
      `screenshot ${file} is not bound to route function text proof`
    );
  }
  if (!isLoginScreenshot(row) && row.navigation !== "sidebar-row-click") {
    fail(
      "screenshot-evidence.json",
      `screenshot ${file} is not bound to sidebar row click navigation`
    );
  }
  if (hasMissingTexts(row)) {
    fail("screenshot-evidence.json", `screenshot ${file} has missing texts`);
  }
}

function requireScreenshots(dir, screenshots, routes) {
  if (!Array.isArray(screenshots)) {
    fail("screenshot-evidence.json", "screenshot evidence must be an array");
    return;
  }
  const expectedMin = routes.length + 1;
  if (screenshots.length < expectedMin) {
    fail(
      "screenshot-evidence.json",
      `expected at least ${expectedMin} screenshots`
    );
  }
  for (const row of screenshots) {
    const file = String(row.file || "");
    requireScreenshotFile(dir, file);
    requireScreenshotRouteProof(row, file);
  }
}

function requireNoSecrets(dir) {
  const combined = requiredFiles
    .map((file) => fs.readFileSync(path.join(dir, file), "utf8"))
    .join("\n");
  for (const pattern of FORBIDDEN_EVIDENCE_PATTERNS) {
    if (pattern.test(combined)) {
      fail(dir, `forbidden evidence pattern matched: ${pattern}`);
    }
  }
}

const dir = latestEvidenceDir();
if (!dir) {
  fail(
    evidenceRoot,
    "no evidence directory found",
    "run npm run e2e:admin-console-new-ui:local first"
  );
} else {
  const routeSpecs = adminConsoleRouteSpecs();
  requireFiles(dir);
  const report = readJson(path.join(dir, "report.json"));
  const api = readJson(path.join(dir, "api-evidence.json"));
  const db = readJson(path.join(dir, "db-evidence.json"));
  const dom = readJson(path.join(dir, "dom-evidence.json"));
  const screenshots = readJson(path.join(dir, "screenshot-evidence.json"));
  requireReport(report, routeSpecs);
  requireApi(api);
  requireDb(db);
  requireDom(dom, routeSpecs);
  requireScreenshots(dir, screenshots, routeSpecs);
  requireNoSecrets(dir);
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log("[admin-console-new-ui-evidence] PASS");
