#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  addressTail,
  assertLocalOnly,
  collectSqlEvidence,
  createRedactor,
  generateTotpCode,
  normalizeMoney,
  resolveLocalAdminTotpSecret,
  shortAddress,
  stripSlash,
} from "./admin_contract_addresses_readonly_e2e_support.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const generatedAt = new Date();
const timestamp = generatedAt
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");
const OUT_DIR = path.resolve(
  process.env.ADMIN_CONTRACT_ADDRESSES_EVIDENCE_DIR ||
    path.join(ROOT, "output/e2e/admin-contract-addresses", `${timestamp}-local`)
);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");

const config = {
  adminFrontUrl: stripSlash(
    process.env.ADMIN_FRONT_URL || "http://127.0.0.1:3200"
  ),
  adminGatewayUrl: stripSlash(
    process.env.ADMIN_GATEWAY_URL || "http://127.0.0.1:8300"
  ),
  adminCookieName:
    process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session",
  adminEmail: process.env.ADMIN_EMAIL || "cliff@synapse-network.ai",
  adminPassword: process.env.ADMIN_PASSWORD || "qwer@1234",
  adminTotpSecret: process.env.ADMIN_TOTP_SECRET || "",
  adminDsn:
    process.env.ADMIN_DATABASE_DSN ||
    "postgresql://synapse_admin_app:local-dev-admin-app-password@127.0.0.1:15432/synapse_gateway_admin",
  gatewayDsn:
    process.env.GATEWAY_POSTGRES_DSN ||
    process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
    process.env.POSTGRES_DSN ||
    "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway",
  headless: process.env.ADMIN_CONTRACT_ADDRESSES_HEADLESS !== "0",
  allowDegraded: process.env.ADMIN_CONTRACT_ADDRESSES_ALLOW_DEGRADED === "true",
};

const expectedAddresses = {
  ledgerSigner:
    process.env.ADMIN_EXPECTED_LEDGER_SIGNER_ADDRESS ||
    process.env.PLATFORM_TREASURY_LEDGER_SIGNER_ADDRESS ||
    "0x121a2aDbe1b7d3aA41C47058af790439897a9034",
  treasurySafe:
    process.env.ADMIN_EXPECTED_TREASURY_SAFE_ADDRESS ||
    process.env.PLATFORM_TREASURY_SAFE_ADDRESS ||
    "0xA8A49dcd8AC6319ca789316Cc8022e316aF13C33",
  withdrawSigner:
    process.env.ADMIN_EXPECTED_WITHDRAW_SIGNER_ADDRESS ||
    process.env.WITHDRAW_SIGNER_ADDRESS ||
    "0x0d0b4b2F8d49e5210e2f023f0508e2fAB6b6c0Ee",
  synapseCore:
    process.env.ADMIN_EXPECTED_SYNAPSE_CORE_ADDRESS ||
    process.env.SYNAPSE_CORE_ADDRESS ||
    "0x4967d23cAbe3881f809677932Cc30c11de6957B0",
  usdc:
    process.env.ADMIN_EXPECTED_USDC_TOKEN_ADDRESS ||
    process.env.USDC_TOKEN_ADDRESS ||
    "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
};

const requiredPageText = [
  "合约 / 地址",
  "Contract Registry",
  "Production contracts",
  "On-chain Contract Checks",
  "Custody Address Book",
  "Operational wallets",
  "Balances",
  "Platform Fees & Reconciliation",
  "No operational actions here",
];

const forbiddenPageText = [
  "private key",
  "secret value",
  "KMS key material",
  "HTTPException",
  "Traceback",
  "Internal Server Error",
  "Unhandled Runtime Error",
  "SQLSTATE",
  "psycopg",
  "raw RPC",
];

const forbiddenActionText = [
  "Change owner",
  "Change signer",
  "Broadcast",
  "Execute transaction",
  "Transfer funds",
];

const evidence = {
  environment: "local",
  generatedAt: generatedAt.toISOString(),
  adminFrontUrl: config.adminFrontUrl,
  adminGatewayUrl: config.adminGatewayUrl,
  checks: [],
  failed: [],
  api: null,
  sql: { queries: [] },
  dom: [],
  screenshots: [],
  trace: [],
};

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
const { redact, sanitize } = createRedactor(config);

function addTrace(name, detail = {}) {
  evidence.trace.push(
    sanitize({ timestamp: new Date().toISOString(), name, ...detail })
  );
}

function addCheck(name, ok, detail = "", extra = {}) {
  const row = sanitize({ name, ok: Boolean(ok), detail, ...extra });
  evidence.checks.push(row);
  if (!row.ok) evidence.failed.push(row);
  console.log(
    `[admin-contract-addresses] ${row.ok ? "PASS" : "FAIL"} ${name}${
      detail ? ` - ${redact(detail)}` : ""
    }`
  );
}

function parseSessionCookie(setCookieHeader) {
  const header = Array.isArray(setCookieHeader)
    ? setCookieHeader.join(",")
    : String(setCookieHeader || "");
  const match = header
    .split(/,(?=\s*[^;,]+=)/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${config.adminCookieName}=`));
  return match
    ? match.split(";")[0].slice(config.adminCookieName.length + 1)
    : "";
}

async function loginAdmin() {
  if (process.env.ADMIN_SESSION_TOKEN) {
    return {
      sessionToken: process.env.ADMIN_SESSION_TOKEN,
      csrfToken: process.env.ADMIN_CSRF_TOKEN || "",
    };
  }
  const totpSecret = resolveLocalAdminTotpSecret({ config, root: ROOT });
  const response = await fetch(
    `${config.adminGatewayUrl}/api/admin/v1/auth/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: config.adminEmail,
        password: config.adminPassword,
        otpCode: process.env.ADMIN_OTP_CODE || generateTotpCode(totpSecret),
      }),
    }
  );
  const body = await response.json().catch(() => ({}));
  const setCookie =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : response.headers.get("set-cookie");
  const sessionToken = parseSessionCookie(setCookie);
  if (!response.ok || !body.success || !sessionToken) {
    throw new Error(
      `Admin login failed: ${response.status} ${redact(
        JSON.stringify(body).slice(0, 800)
      )}`
    );
  }
  return {
    sessionToken,
    csrfToken: body.data?.csrfToken || "",
    adminId: body.data?.admin?.adminId || "",
  };
}

async function adminApi(pathname, auth) {
  const response = await fetch(`${config.adminGatewayUrl}${pathname}`, {
    headers: {
      Accept: "application/json",
      Cookie: `${config.adminCookieName}=${auth.sessionToken}`,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success !== true) {
    throw new Error(
      `Admin API failed ${pathname}: ${response.status} ${redact(
        JSON.stringify(body).slice(0, 800)
      )}`
    );
  }
  return body.data;
}

function allRegistryAddresses(registry) {
  return [
    ...(registry.contracts || []).map((item) => item.address),
    ...(registry.roles || []).map((item) => item.address),
    ...(registry.contractChecks || []).flatMap((item) => [
      item.expected,
      item.actual,
    ]),
  ].filter(Boolean);
}

function assertExpectedRegistryAddresses(registry) {
  const addresses = new Set(
    allRegistryAddresses(registry).map((item) => item.toLowerCase())
  );
  const missing = Object.entries(expectedAddresses)
    .filter(([, address]) => !addresses.has(address.toLowerCase()))
    .map(([key, address]) => `${key}:${address}`);
  addCheck("api:expected-addresses", missing.length === 0, "", { missing });
}

function assertApiSqlConsistency(registry) {
  const finance = evidence.sql.financeProjection || {};
  const reconciliation = evidence.sql.reconciliationRuntime || {};
  const comparisons = [
    [
      "ledgerPlatformFeeUsdc",
      registry.balances.ledgerPlatformFeeUsdc,
      finance.platformFeeBalanceUsdc,
    ],
    [
      "todayPlatformFeeUsdc",
      registry.feeSummary.todayPlatformFeeUsdc,
      finance.todayPlatformFeeEarnedUsdc,
    ],
  ];
  const expectedLedgerObligation = reconciliation.ledgerObligationUsdc ?? null;
  if (expectedLedgerObligation !== null) {
    comparisons.push([
      "ledgerObligationUsdc",
      registry.balances.ledgerObligationUsdc,
      expectedLedgerObligation,
    ]);
  }
  const expectedDelta =
    reconciliation.deltaUsdc ?? finance.vaultLedgerDeltaUsdc ?? null;
  if (expectedDelta !== null) {
    comparisons.push([
      "vaultLedgerDeltaUsdc",
      registry.balances.vaultLedgerDeltaUsdc,
      expectedDelta,
    ]);
  }
  const mismatches = comparisons.filter(
    ([, apiValue, sqlValue]) =>
      normalizeMoney(apiValue) !== normalizeMoney(sqlValue)
  );
  addCheck("api-sql:finance-reconciliation", mismatches.length === 0, "", {
    comparisons: comparisons.map(([field, apiValue, sqlValue]) => ({
      field,
      apiValue,
      sqlValue,
    })),
    mismatches,
  });
}

async function createBrowserContext(auth) {
  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await context.addCookies([
    {
      name: config.adminCookieName,
      value: auth.sessionToken,
      url: config.adminFrontUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await context.route("**/api/admin/v1/**", async (route) => {
    const request = route.request();
    const sourceUrl = new URL(request.url());
    const targetUrl = `${config.adminGatewayUrl}${sourceUrl.pathname}${sourceUrl.search}`;
    const headers = {
      ...request.headers(),
      cookie: `${config.adminCookieName}=${auth.sessionToken}`,
    };
    delete headers.host;
    delete headers["content-length"];
    if (auth.csrfToken && request.method().toUpperCase() !== "GET") {
      headers["x-csrf-token"] = auth.csrfToken;
    }
    const response = await fetch(targetUrl, {
      method: request.method(),
      headers,
      body:
        request.method().toUpperCase() === "GET"
          ? undefined
          : request.postDataBuffer(),
    });
    const responseHeaders = Object.fromEntries(response.headers.entries());
    delete responseHeaders["content-encoding"];
    delete responseHeaders["content-length"];
    delete responseHeaders["transfer-encoding"];
    await route.fulfill({
      status: response.status,
      headers: responseHeaders,
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
  if (auth.csrfToken) {
    await context.addInitScript((csrfToken) => {
      window.sessionStorage.setItem("synapse.admin.csrfToken", csrfToken);
    }, auth.csrfToken);
  }
  return { browser, context };
}

async function capture(page, fileName, checkpoint) {
  const filePath = path.join(SCREENSHOT_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: false });
  const row = {
    file: `screenshots/${fileName}`,
    url: page.url(),
    capturedAt: new Date().toISOString(),
    forbiddenTextAbsent: true,
    ...checkpoint,
  };
  evidence.screenshots.push(sanitize(row));
}

async function verifyDomEvidence(auth, registry) {
  const { browser, context } = await createBrowserContext(auth);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("401")) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText || "";
    if (!failure.includes("net::ERR_ABORTED")) {
      consoleErrors.push(`${request.method()} ${request.url()} ${failure}`);
    }
  });

  try {
    await page.goto(`${config.adminFrontUrl}/contract-addresses`, {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
    await page.waitForFunction(
      ({ expected, forbidden }) => {
        const body = document.body?.innerText || "";
        return (
          expected.some((text) => body.includes(text)) ||
          forbidden.some((text) => body.includes(text))
        );
      },
      { expected: requiredPageText, forbidden: forbiddenPageText },
      { timeout: 45_000 }
    );

    const bodyText = String((await page.textContent("body")) || "");
    const missingRequired = requiredPageText.filter(
      (text) => !bodyText.includes(text)
    );
    const missingAddressTails = Object.values(expectedAddresses)
      .map((address) => addressTail(address))
      .filter((tail) => !bodyText.includes(tail));
    const forbiddenHits = [...forbiddenPageText, ...forbiddenActionText].filter(
      (text) => bodyText.toLowerCase().includes(text.toLowerCase())
    );
    const apiMoneyValues = [
      registry.balances.vaultUsdc,
      registry.balances.platformFeePoolUsdc,
      registry.balances.ledgerPlatformFeeUsdc,
      registry.balances.ledgerObligationUsdc,
      registry.balances.vaultLedgerDeltaUsdc,
      registry.feeSummary.todayPlatformFeeUsdc,
      registry.feeSummary.sevenDayPlatformFeeUsdc,
      registry.feeSummary.thirtyDayPlatformFeeUsdc,
    ].filter(Boolean);
    const missingMoneyValues = apiMoneyValues.filter(
      (value) => !bodyText.includes(String(value))
    );

    addCheck("dom:required-sections", missingRequired.length === 0, "", {
      missingRequired,
    });
    addCheck(
      "dom:expected-address-tails",
      missingAddressTails.length === 0,
      "",
      {
        missingAddressTails,
      }
    );
    addCheck("dom:api-money-values", missingMoneyValues.length === 0, "", {
      missingMoneyValues,
    });
    addCheck("dom:forbidden-text", forbiddenHits.length === 0, "", {
      forbiddenHits,
    });

    const explorerHrefs = await page
      .locator('a[href*="/address/"]')
      .evaluateAll((nodes) => nodes.map((node) => node.href));
    const expectedExplorerUrls = [
      ...(registry.contracts || []).map((item) => item.explorerUrl),
      ...(registry.roles || []).map((item) => item.explorerUrl),
    ].filter(Boolean);
    const missingExplorerUrls = expectedExplorerUrls.filter(
      (url) => !explorerHrefs.includes(url)
    );
    addCheck("dom:explorer-links", missingExplorerUrls.length === 0, "", {
      missingExplorerUrls,
    });

    const firstContract = registry.contracts?.[0];
    let copiedAddress = "";
    if (firstContract?.address) {
      await page.getByRole("button", { name: "Copy" }).first().click();
      copiedAddress = await page.evaluate(() => navigator.clipboard.readText());
    }
    addCheck(
      "dom:copy-address",
      !firstContract?.address || copiedAddress === firstContract.address,
      "",
      { copiedAddress, expected: firstContract?.address || "" }
    );

    const checkpoints = [
      {
        file: "contract-addresses-overview.png",
        text: "Production contracts",
      },
      { file: "checks.png", text: "On-chain Contract Checks" },
      { file: "address-book.png", text: "Custody Address Book" },
      { file: "balances.png", text: "Platform Fees & Reconciliation" },
    ];
    for (const checkpoint of checkpoints) {
      await page
        .getByText(checkpoint.text, { exact: false })
        .first()
        .scrollIntoViewIfNeeded();
      await capture(page, checkpoint.file, {
        expectedText: checkpoint.text,
        domCheckpoint: {
          missingRequired,
          missingAddressTails,
          missingMoneyValues,
        },
        apiCheckpoint: {
          endpoint: "/api/admin/v1/contract-addresses",
          registryDigest: crypto
            .createHash("sha256")
            .update(JSON.stringify(registry))
            .digest("hex"),
        },
        sqlCheckpoint: {
          queries: evidence.sql.queries.map((query) => query.name),
        },
      });
    }

    evidence.dom.push(
      sanitize({
        route: "/contract-addresses",
        url: page.url(),
        requiredPageText,
        missingRequired,
        missingAddressTails,
        missingMoneyValues,
        explorerLinkCount: explorerHrefs.length,
        forbiddenTextAbsent: forbiddenHits.length === 0,
      })
    );
    addCheck("dom:console-errors", consoleErrors.length === 0, "", {
      consoleErrors,
    });
  } finally {
    await browser.close();
  }
}

function writeEvidence(status) {
  const trace =
    evidence.trace.map((row) => JSON.stringify(sanitize(row))).join("\n") +
    "\n";
  const traceDigest = crypto.createHash("sha256").update(trace).digest("hex");
  const report = {
    environment: evidence.environment,
    status,
    generatedAt: evidence.generatedAt,
    failed: evidence.failed,
    checks: evidence.checks,
    traceDigest,
    apiEndpoint: "/api/admin/v1/contract-addresses",
    expectedAddresses,
    screenshots: evidence.screenshots.map((row) => row.file),
  };
  fs.writeFileSync(path.join(OUT_DIR, "trace.jsonl"), trace);
  fs.writeFileSync(
    path.join(OUT_DIR, "api-response.json"),
    `${JSON.stringify(sanitize(evidence.api), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "sql-evidence.json"),
    `${JSON.stringify(sanitize(evidence.sql), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "dom-evidence.json"),
    `${JSON.stringify(sanitize(evidence.dom), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "screenshot-evidence.json"),
    `${JSON.stringify(sanitize(evidence.screenshots), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "bugfix-log.md"),
    evidence.failed.length
      ? [
          "# Bugfix Log",
          "",
          "- OPEN: Admin contract/address registry E2E has failing checkpoints.",
          "  - Symptom: see report.json failed entries.",
          "  - Root cause: pending investigation.",
          "  - Fix plan: fix the failing API, DOM, SQL, or environment checkpoint and rerun.",
          "  - Verification command: npm run e2e:admin-contract-addresses-readonly && npm run ci:admin-contract-addresses-evidence",
          "  - Status: open",
          "",
        ].join("\n")
      : "# Bugfix Log\n\nNo bugs found in this run.\n"
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    [
      "# Admin Contract Addresses Read-only E2E",
      "",
      `- Status: ${status}`,
      `- Failed: ${evidence.failed.length}`,
      `- Generated at: ${evidence.generatedAt}`,
      "",
      "## Checks",
      "",
      ...evidence.checks.map(
        (row) => `- ${row.ok ? "PASS" : "FAIL"} ${row.name}`
      ),
      "",
      "## Screenshots",
      "",
      ...evidence.screenshots.map((row) => `- ${row.file}`),
      "",
    ].join("\n")
  );
  console.log(
    `[admin-contract-addresses] Report: ${path.join(OUT_DIR, "report.md")}`
  );
}

async function main() {
  assertLocalOnly(config);
  addTrace("preflight", {
    adminFrontUrl: config.adminFrontUrl,
    adminGatewayUrl: config.adminGatewayUrl,
  });
  collectSqlEvidence({ config, evidence, root: ROOT, redact });
  addCheck("sql:readonly-evidence", evidence.sql.queries.length === 3, "", {
    queries: evidence.sql.queries,
  });
  const auth = await loginAdmin();
  addCheck("admin:login", true, auth.adminId || "session");
  const registry = await adminApi("/api/admin/v1/contract-addresses", auth);
  evidence.api = registry;
  addCheck("api:contract-addresses", Boolean(registry?.network), "", {
    rpcStatus: registry?.network?.rpcStatus,
  });
  if (registry?.network?.rpcStatus === "degraded" && !config.allowDegraded) {
    addCheck(
      "api:rpc-healthy",
      false,
      "RPC status is degraded; set ADMIN_CONTRACT_ADDRESSES_ALLOW_DEGRADED=true only for degraded evidence runs."
    );
  } else {
    addCheck(
      "api:rpc-healthy",
      registry?.network?.rpcStatus === "healthy",
      "",
      {
        rpcStatus: registry?.network?.rpcStatus,
      }
    );
  }
  assertExpectedRegistryAddresses(registry);
  assertApiSqlConsistency(registry);
  await verifyDomEvidence(auth, registry);
  const status = evidence.failed.length ? "failed" : "success";
  writeEvidence(status);
  if (evidence.failed.length) process.exit(1);
}

main().catch((error) => {
  addCheck(
    "fatal",
    false,
    error instanceof Error ? error.stack || error.message : String(error)
  );
  writeEvidence("failed");
  process.exit(1);
});
