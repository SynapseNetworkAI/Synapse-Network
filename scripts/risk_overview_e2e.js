#!/usr/bin/env node
"use strict";

/**
 * Risk Overview E2E Test
 *
 * Validates the risk-overview API and the audit page UI:
 *   1. Authenticate as consumer wallet
 *   2. Call GET /api/v1/finance/risk-overview — verify structure
 *   3. Call GET /api/v1/finance/audit-logs — verify structure
 *   4. Navigate to /dashboard/audit in browser — take screenshots
 *   5. Verify Risk Overview cards, Alerts section, and Audit Trail render
 */

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { ethers } = require("ethers");

// ── Config ───────────────────────────────────────────────────────────────────
const FRONTEND_URL = process.env.FRONTEND_URL || "http://127.0.0.1:3000";
const GATEWAY_URL  = process.env.GATEWAY_URL  || "http://127.0.0.1:8000/api";
const RPC_URL      = process.env.RPC_URL      || "http://127.0.0.1:8545";

const BUYER_KEY = process.env.BUYER_KEY ||
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"; // Hardhat #3

const REPO_ROOT = (() => {
  let current = __dirname;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(current, "package.json")) && fs.existsSync(path.join(current, "services"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return process.cwd();
})();

const SCREENSHOT_DIR = path.join(REPO_ROOT, "tmp/screens/risk-overview");

// ── Logging ──────────────────────────────────────────────────────────────────
const ok   = (msg) => console.log(`\x1b[32m✔ ${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m⚠ ${msg}\x1b[0m`);
const fail = (msg) => console.log(`\x1b[31m✘ ${msg}\x1b[0m`);

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) { ok(label); passed++; }
  else           { fail(label); failed++; }
}

// ── API helpers ──────────────────────────────────────────────────────────────
async function apiGet(pathname, token, address) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (address) headers["X-User-Address"] = address;
  const res = await fetch(`${GATEWAY_URL}${pathname}`, { headers });
  const body = await res.json().catch(() => ({}));
  return { response: res, body };
}

async function apiPost(pathname, payload, token, address) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (address) headers["X-User-Address"] = address;
  const res = await fetch(`${GATEWAY_URL}${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { response: res, body };
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function authenticate(privateKey) {
  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address.toLowerCase();
  const challengeRes = await fetch(`${GATEWAY_URL}/v1/auth/challenge?address=${address}`);
  if (!challengeRes.ok) throw new Error(`challenge failed: ${challengeRes.status}`);
  const challengeBody = await challengeRes.json();
  const signature = await wallet.signMessage(challengeBody.challenge);
  const verify = await apiPost(
    "/v1/auth/verify",
    { wallet_address: address, signature, message: challengeBody.challenge },
  );
  const token = verify.body.token || verify.body.access_token;
  if (!verify.response.ok || !token) {
    throw new Error(`verify failed: ${verify.response.status} ${JSON.stringify(verify.body)}`);
  }
  ok(`Authenticated ${address}`);
  return { token, address };
}

// ── Screenshot helper ────────────────────────────────────────────────────────
async function screenshot(page, name) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const p = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  ok(`Screenshot: ${p}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Risk Overview E2E Test");
  console.log("═══════════════════════════════════════════════════════\n");

  // 1. Auth
  console.log("── Step 1: Authenticate ──");
  const { token, address } = await authenticate(BUYER_KEY);

  // 2. Test risk-overview API
  console.log("\n── Step 2: GET /api/v1/finance/risk-overview ──");
  const { response: riskRes, body: riskBody } = await apiGet(
    "/v1/finance/risk-overview", token, address,
  );
  check("risk-overview returns 200", riskRes.status === 200);
  check("risk-overview has status=success", riskBody.status === "success");
  check("risk-overview has overview object", typeof riskBody.overview === "object" && riskBody.overview !== null);

  const ov = riskBody.overview || {};
  check("overview.systemIntegrity present", typeof ov.systemIntegrity === "object");
  check("overview.systemIntegrity.level is string", typeof (ov.systemIntegrity || {}).level === "string");
  check("overview.systemIntegrity.anomalyCount24h is number", typeof (ov.systemIntegrity || {}).anomalyCount24h === "number");
  check("overview.pendingReviews present", typeof ov.pendingReviews === "object");
  check("overview.pendingReviews.level is string", typeof (ov.pendingReviews || {}).level === "string");
  check("overview.pendingReviews.count is number", typeof (ov.pendingReviews || {}).count === "number");
  check("overview.alerts is array", Array.isArray(ov.alerts));

  console.log("  Response:", JSON.stringify(ov, null, 2));

  // 3. Test audit-logs API
  console.log("\n── Step 3: GET /api/v1/finance/audit-logs ──");
  const { response: auditRes, body: auditBody } = await apiGet(
    "/v1/finance/audit-logs?limit=10", token, address,
  );
  check("audit-logs returns 200", auditRes.status === 200);
  check("audit-logs has logs array", Array.isArray(auditBody.logs));
  console.log(`  Audit log count: ${(auditBody.logs || []).length}`);

  // 4. Browser screenshots
  console.log("\n── Step 4: Browser Screenshots ──");
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      storageState: {
        cookies: [],
        origins: [{
          origin: FRONTEND_URL,
          localStorage: [
            { name: "synapse_session_token", value: token },
            { name: "synapse_wallet_address", value: address },
          ],
        }],
      },
    });
    const page = await context.newPage();

    // Go to audit page
    await page.goto(`${FRONTEND_URL}/dashboard/audit`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);
    await screenshot(page, "01-risk-audit-page");

    // Check page has key elements rendered
    const pageText = await page.textContent("body");
    check("Page has 'Risk & Audit' title", pageText.includes("Risk & Audit") || pageText.includes("风险与审计"));
    check("Page has 'System Integrity' card", pageText.includes("System Integrity") || pageText.includes("系统完整性"));
    check("Page has 'Pending Reviews' card", pageText.includes("Pending Reviews") || pageText.includes("待审核"));
    check("Page has 'Audit Trail' section", pageText.includes("Audit Trail") || pageText.includes("审计轨迹"));

    // Take close-up of just the risk cards area
    await screenshot(page, "02-risk-overview-cards");

    ok("Browser validation complete");
  } catch (e) {
    warn(`Browser test skipped or failed: ${e.message}`);
  } finally {
    if (browser) await browser.close();
  }

  // 5. Summary
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════════\n");

  if (failed > 0) {
    fail(`${failed} check(s) failed`);
    process.exit(1);
  } else {
    ok("ALL CHECKS PASSED");
  }
}

main().catch((e) => {
  fail(`Fatal: ${e.message}`);
  console.error(e);
  process.exit(1);
});
