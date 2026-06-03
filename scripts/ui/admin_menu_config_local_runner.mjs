import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

import {
  ROOT,
  REQUIRED_MENU_ITEMS,
  assertLocalOnly,
  buildLocalConfig,
  redactWithConfig,
  sanitizeWithConfig,
} from "../lib/admin_menu_config_local_contract.mjs";
import { runLoginCycle } from "./admin_menu_config_local_pages.mjs";

function buildEvidenceContext(config) {
  const generatedAt = new Date();
  const timestamp = generatedAt
    .toISOString()
    .replace(/[:.]/g, "")
    .replace("Z", "Z");
  const outDir = path.resolve(
    process.env.ADMIN_MENU_CONFIG_EVIDENCE_DIR ||
      path.join(ROOT, "output/e2e/admin-menu-config-local", timestamp)
  );
  const evidence = {
    environment: "local",
    generatedAt: generatedAt.toISOString(),
    adminFrontUrl: config.adminFrontUrl,
    adminGatewayUrl: config.adminGatewayUrl,
    checks: [],
    failed: [],
    authPolicy: null,
    loginRuns: [],
    api: [],
    dom: [],
    db: null,
    screenshots: [],
    trace: [],
  };
  fs.mkdirSync(path.join(outDir, "screenshots"), { recursive: true });
  return { evidence, generatedAt, outDir };
}

function createOps(config, context) {
  const sanitize = (value) => sanitizeWithConfig(value, config);
  const redact = (value) => redactWithConfig(value, config);
  return {
    config,
    evidence: context.evidence,
    sanitize,
    addCheck(name, ok, detail = "", extra = {}) {
      const row = sanitize({ name, ok: Boolean(ok), detail, ...extra });
      context.evidence.checks.push(row);
      if (!row.ok) context.evidence.failed.push(row);
      console.log(
        `[admin-menu-config-local] ${row.ok ? "PASS" : "FAIL"} ${name}${
          detail ? ` - ${redact(detail)}` : ""
        }`
      );
    },
    addTrace(name, detail = {}) {
      context.evidence.trace.push(
        sanitize({ timestamp: new Date().toISOString(), name, ...detail })
      );
    },
    async capture(page, name, metadata = {}) {
      const file = `screenshots/${name}.png`;
      await page.screenshot({
        path: path.join(context.outDir, file),
        fullPage: true,
      });
      const row = sanitize({
        name,
        file,
        url: page.url(),
        capturedAt: new Date().toISOString(),
        ...metadata,
      });
      context.evidence.screenshots.push(row);
      return row;
    },
  };
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", ...(init.headers || {}) },
    ...init,
  });
  const body = await response.json().catch(() => ({}));
  return { body, response };
}

async function preflight(config, ops) {
  assertLocalOnly(config);
  const front = await fetch(config.adminFrontUrl);
  ops.addCheck("preflight:admin-front-local", front.ok, `${front.status}`);
  if (!front.ok) throw new Error(`Admin-front not reachable: ${front.status}`);

  const policyUrl = `${config.adminGatewayUrl}/api/admin/v1/auth/policy`;
  const { body, response } = await fetchJson(policyUrl);
  const policy = body?.data || body;
  ops.evidence.authPolicy = {
    status: response.status,
    loginTotpRequired: policy?.loginTotpRequired,
    highRiskTotpRequired: policy?.highRiskTotpRequired,
  };
  const ok = response.ok && policy?.loginTotpRequired === false;
  ops.addCheck(
    "auth-policy:login-google-fa-disabled",
    ok,
    `loginTotpRequired=${String(policy?.loginTotpRequired)}`
  );
  if (!ok) {
    throw new Error(
      "Local gateway-admin must run with ADMIN_GOOGLE_AUTHENTICATOR_LOGIN_ENABLED=false."
    );
  }
}

function queryDbEvidence(config, ops) {
  const result = spawnSync("psql", dbQueryArgs(config.adminDsn), {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `admin_config_documents query failed: ${redactWithConfig(
        result.stderr || result.stdout,
        config
      )}`
    );
  }
  const parsed = JSON.parse(result.stdout.trim() || "{}");
  ops.evidence.db = ops.sanitize(parsed);
  const ok = dbEvidenceMatches(parsed);
  ops.addCheck("db:admin-menu-config-center-published", ok);
  if (!ok) {
    throw new Error("DB published admin_menu_config does not contain /config.");
  }
}

function dbQueryArgs(adminDsn) {
  return [
    adminDsn,
    "-X",
    "-q",
    "-t",
    "-A",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    dbEvidenceSql(),
  ];
}

function dbEvidenceSql() {
  return `
    WITH menu_doc AS (
      SELECT config_key, published_payload_json, updated_at
      FROM admin_config_documents
      WHERE config_key = 'admin_menu_config'
      LIMIT 1
    ),
    config_items AS (
      SELECT item
      FROM menu_doc, jsonb_array_elements(published_payload_json -> 'items') AS item
      WHERE item ->> 'itemId' IN (
        'config-center',
        'business-policy-config',
        'runtime-config',
        'published-config'
      )
    )
    SELECT json_build_object(
      'configKey', (SELECT config_key FROM menu_doc),
      'documentExists', EXISTS(SELECT 1 FROM menu_doc),
      'configCenterExists', EXISTS(SELECT 1 FROM config_items WHERE item ->> 'itemId' = 'config-center'),
      'configCenterMatches', EXISTS(
        SELECT 1
        FROM config_items
        WHERE item ->> 'itemId' = 'config-center'
          AND item ->> 'href' = '/config'
          AND item ->> 'parentItemId' = 'business-control'
      ),
      'configSplitMatches', (SELECT jsonb_object_agg(item ->> 'itemId', item) FROM config_items),
      'item', (SELECT item FROM config_items WHERE item ->> 'itemId' = 'config-center'),
      'updatedAt', (SELECT updated_at::text FROM menu_doc)
    );
  `;
}

function dbEvidenceMatches(parsed) {
  return (
    parsed.documentExists === true &&
    parsed.configCenterExists === true &&
    parsed.configCenterMatches === true &&
    REQUIRED_MENU_ITEMS.every((expected) => {
      const item = parsed.configSplitMatches?.[expected.itemId];
      return (
        item?.href === expected.href &&
        item?.parentItemId === expected.parentItemId &&
        item?.nodeType === expected.nodeType
      );
    })
  );
}

function writeJson(context, ops, name, data) {
  fs.writeFileSync(
    path.join(context.outDir, name),
    `${JSON.stringify(ops.sanitize(data), null, 2)}\n`
  );
}

function writeReport(context, ops, status) {
  const traceText = ops.evidence.trace
    .map((row) => JSON.stringify(row))
    .join("\n");
  fs.writeFileSync(path.join(context.outDir, "trace.jsonl"), `${traceText}\n`);
  const traceDigest = crypto
    .createHash("sha256")
    .update(`${traceText}\n`)
    .digest("hex");
  const report = {
    status,
    generatedAt: context.generatedAt.toISOString(),
    traceDigest,
    checks: ops.evidence.checks,
    failed: ops.evidence.failed,
    loginRuns: ops.evidence.loginRuns,
    screenshots: ops.evidence.screenshots.map((row) => row.file),
  };
  writeJson(context, ops, "report.json", report);
  writeJson(context, ops, "api-evidence.json", ops.evidence.api);
  writeJson(context, ops, "dom-evidence.json", ops.evidence.dom);
  writeJson(context, ops, "db-evidence.json", ops.evidence.db || {});
  writeJson(context, ops, "screenshot-evidence.json", ops.evidence.screenshots);
  writeJson(
    context,
    ops,
    "auth-policy-evidence.json",
    ops.evidence.authPolicy || {}
  );
  fs.writeFileSync(
    path.join(context.outDir, "report.md"),
    reportMarkdown(context, ops, status)
  );
}

function reportMarkdown(context, ops, status) {
  return `${[
    "# Admin Menu Config Local E2E Evidence",
    "",
    `- Status: ${status}`,
    `- Generated at: ${context.generatedAt.toISOString()}`,
    `- Admin-front: ${ops.config.adminFrontUrl}`,
    `- Gateway-admin: ${ops.config.adminGatewayUrl}`,
    `- Login cycles: ${ops.evidence.loginRuns.length}`,
    `- Screenshots: ${ops.evidence.screenshots.length}`,
    `- Failed checks: ${ops.evidence.failed.length}`,
    "",
    "## Required Proof",
    "",
    "- Google FA login policy disabled locally.",
    "- Two fresh password-only logins completed.",
    "- Visible menu API returned config-center and split config subentries on both runs.",
    "- Sidebar, /config, /config/business-policy, /config/runtime, and /config/published screenshots were captured after DOM/API checks.",
    "- admin_config_documents published payload contains the split config menu tree.",
  ].join("\n")}\n`;
}

export async function runAdminMenuConfigLocalE2e() {
  const config = buildLocalConfig();
  const context = buildEvidenceContext(config);
  const ops = createOps(config, context);
  let status = "success";
  try {
    await preflight(config, ops);
    const browser = await chromium.launch({ headless: config.headless });
    try {
      await runLoginCycle(browser, 1, ops);
      await runLoginCycle(browser, 2, ops);
    } finally {
      await browser.close();
    }
    queryDbEvidence(config, ops);
  } catch (error) {
    status = "failed";
    ops.addCheck(
      "runner:completed",
      false,
      error instanceof Error ? error.message : String(error)
    );
    process.exitCode = 1;
  } finally {
    writeReport(context, ops, status);
    console.log(`[admin-menu-config-local] Evidence: ${context.outDir}`);
  }
}
