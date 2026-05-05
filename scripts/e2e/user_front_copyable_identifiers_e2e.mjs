#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const generatedAt = new Date();
const timestamp = generatedAt
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");
const outDir = path.resolve(
  process.env.USER_FRONT_COPYABLE_IDENTIFIERS_EVIDENCE_DIR ||
    path.join(
      ROOT,
      "output/dogfood/user-front-copyable-identifiers",
      `${timestamp}-local`
    )
);
const screenshotsDir = path.join(outDir, "screenshots");

const config = {
  frontendUrl: stripSlash(
    process.env.USER_FRONT_BASE_URL || "http://127.0.0.1:3000"
  ),
  gatewayBase: stripSlash(
    process.env.NEXT_PUBLIC_GATEWAY_BASE_URL ||
      process.env.USER_FRONT_GATEWAY_BASE_URL ||
      "http://127.0.0.1:8000"
  ),
  rpcUrl: stripSlash(process.env.USER_FRONT_RPC_URL || "http://127.0.0.1:8545"),
  headless: process.env.USER_FRONT_COPYABLE_IDENTIFIERS_HEADLESS !== "0",
};

const fixture = {
  ownerAddress: "0x82f1c188327bfc265357a85e8a6b4a34d562d6f8",
  providerAddress: "0xd9e63089bd52304026f9ab55b5b6c9044038971d",
  billingId: "deposit-copyable-transaction-000000000000000000000001",
  billingTxHash:
    "0xb71445aa000000000000000000000000000000000000000000000000000000000001",
  invocationId: "inv-copyable-dom-000000000000000000000001",
  serviceId: "svc_oss_security_healthcheck",
  agentId: "cred-copyable-agent-000000000000000000000001",
  internalAgentPrincipal: "agent:agent:0x82f1c188327bfc265357a85e8a6b4a34d562d6f8",
  issuedToken: "agt_copyable_fixture_full_secret_token_000001",
  endpointUrl:
    "http://127.0.0.1:8100/provider-services/oss-security-healthcheck/invoke",
  settlementRequestId: "req-copyable-settlement-000000000000000000001",
  providerWithdrawalId: "pwd-copyable-withdrawal-000000000000000000001",
  providerWithdrawalTxHash:
    "0xcff7aa0000000000000000000000000000000000000000000000000000000002",
  providerNonce: "987654321",
};

const evidence = {
  environment: "local",
  generatedAt: generatedAt.toISOString(),
  frontendUrl: config.frontendUrl,
  checks: [],
  failed: [],
  dom: [],
  clipboard: [],
  screenshots: [],
  trace: [],
};

fs.mkdirSync(screenshotsDir, { recursive: true });

function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function assertLocalUrl(name, value) {
  const url = new URL(value);
  if (!["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname)) {
    throw new Error(`Refusing ${name}=${value}; this E2E is local-only.`);
  }
}

function redact(value) {
  return String(value ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/0x[a-fA-F0-9]{64,}/g, (match) =>
      match === fixture.billingTxHash || match === fixture.providerWithdrawalTxHash
        ? match
        : "0x[REDACTED]"
    )
    .replace(/agt_(?!copyable_fixture)[A-Za-z0-9._~+/-]+/g, "agt_[REDACTED]");
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, next]) => [
        key,
        /password|privateKey|authorization|bearer|jwt/i.test(key)
          ? "[REDACTED]"
          : sanitize(next),
      ])
    );
  }
  return typeof value === "string" ? redact(value) : value;
}

function addTrace(name, detail = {}) {
  evidence.trace.push(
    sanitize({
      timestamp: new Date().toISOString(),
      name,
      ...detail,
    })
  );
}

function addCheck(name, ok, detail = "", extra = {}) {
  const row = sanitize({ name, ok: Boolean(ok), detail, ...extra });
  evidence.checks.push(row);
  if (!row.ok) evidence.failed.push(row);
  console.log(
    `[copyable-identifiers] ${row.ok ? "PASS" : "FAIL"} ${name}${
      detail ? ` - ${redact(detail)}` : ""
    }`
  );
}

function jsonResponse(payload, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  };
}

function isLocalPortUrl(rawUrl, port) {
  try {
    const parsed = new URL(rawUrl);
    return (
      ["localhost", "127.0.0.1", "0.0.0.0"].includes(parsed.hostname) &&
      parsed.port === String(port)
    );
  } catch {
    return false;
  }
}

function isGatewayApiUrl(rawUrl) {
  try {
    return new URL(rawUrl).pathname.startsWith("/api/v1/");
  } catch {
    return false;
  }
}

function serviceRows() {
  return [
    {
      id: fixture.serviceId,
      serviceId: fixture.serviceId,
      serviceName: "OSS Security Healthcheck",
      name: "OSS Security Healthcheck",
      role: "provider",
      ownerAddress: fixture.ownerAddress,
      address: fixture.ownerAddress,
      pricing: { currency: "USDC", amount: "0.010000" },
      endpoint: fixture.endpointUrl,
      isActive: true,
      status: "active",
      runtimeAvailable: true,
      invocationCount: 12,
      totalRevenueUsdc: "1.230000",
      health: {
        overallStatus: "healthy",
        healthyTargets: 1,
        totalTargets: 1,
        lastCheckedAt: Math.floor(Date.now() / 1000),
        runtimeAvailable: true,
      },
      invoke: {
        method: "POST",
        url: fixture.endpointUrl,
        timeoutMs: 1500,
        request: { contentType: "application/json", schema: {} },
        response: { schema: {} },
      },
    },
  ];
}

function credentialRows() {
  return [
    {
      id: fixture.agentId,
      ownerAddress: fixture.ownerAddress,
      name: "Copyable QA Agent",
      tokenPrefix: "agt_copy",
      status: "active",
      maxCalls: 1000,
      callsUsed: 7,
      rpm: 600,
      creditLimit: 20,
      resetInterval: "monthly",
      expiresAt: 0,
      createdAt: new Date().toISOString(),
    },
  ];
}

function withdrawalRows() {
  return [
    {
      id: fixture.providerWithdrawalId,
      amountUsdc: "12.340000",
      status: "COMPLETED",
      nonce: Number(fixture.providerNonce),
      deadline: Math.floor(Date.now() / 1000) + 3600,
      txHash: fixture.providerWithdrawalTxHash,
      message: "Completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      ticket: {
        ticketId:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        amount: "12.340000",
        fee: "0.000000",
        nonce: Number(fixture.providerNonce),
        deadline: Math.floor(Date.now() / 1000) + 3600,
        signature: "0x00",
        chainId: 31337,
        contractAddress: "0x0000000000000000000000000000000000000001",
      },
    },
  ];
}

async function fulfillRpc(route) {
  const request = route.request();
  let body = {};
  try {
    body = JSON.parse(request.postData() || "{}");
  } catch {
    body = {};
  }
  if (Array.isArray(body)) {
    await route.fulfill(
      jsonResponse(body.map((item) => buildRpcResponse(item)))
    );
    return;
  }
  await route.fulfill(jsonResponse(buildRpcResponse(body)));
}

function buildRpcResponse(body) {
  const method = body.method;
  let result = "0x0";
  if (method === "eth_chainId") result = "0x7a69";
  if (method === "eth_blockNumber") result = "0x1";
  if (method === "eth_getLogs") result = [];
  if (method === "eth_getBlockByNumber") {
    result = { number: "0x1", timestamp: "0x65a00000" };
  }
  if (method === "eth_call") {
    result =
      "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  return { jsonrpc: "2.0", id: body.id ?? 1, result };
}

async function fulfillGateway(route) {
  const url = new URL(route.request().url());
  const pathname = url.pathname;
  addTrace("route:gateway", {
    method: route.request().method(),
    pathname,
  });
  if (pathname === "/api/logs") return route.fulfill(jsonResponse({ ok: true }));
  if (pathname === "/api/v1/auth/me") {
    return route.fulfill(
      jsonResponse({
        success: true,
        profile: {
          ownerAddress: fixture.ownerAddress,
          displayName: "Copyable QA Owner",
          email: "copyable@example.test",
          emailVerified: true,
          notifyMarketing: false,
          notifyAlerts: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      })
    );
  }
  if (pathname.startsWith("/api/v1/notifications")) {
    return route.fulfill(
      jsonResponse({ notifications: [], unreadCount: 0, total: 0 })
    );
  }
  if (pathname === "/api/v1/balance") {
    return route.fulfill(
      jsonResponse({
        ownerBalance: "185.990000",
        consumerPendingBalance: "0.000000",
        consumerFrozenBalance: "0.000000",
        providerReceivable: "42.000000",
        platformFeeAccrued: "3.000000",
      })
    );
  }
  if (pathname === "/api/v1/balance/spending-limit") {
    return route.fulfill(
      jsonResponse({
        ownerAddress: fixture.ownerAddress,
        spendingLimitUsdc: "1000.000000",
        allowUnlimited: false,
        cycleInterval: "monthly",
        currentCycleSpendUsdc: "1.230000",
        remainingSpendUsdc: "998.770000",
        updatedAt: new Date().toISOString(),
      })
    );
  }
  if (pathname === "/api/v1/balance/deposit/attempts") {
    return route.fulfill(jsonResponse({ attempts: [] }));
  }
  if (pathname === "/api/v1/balance/deposit/intents") {
    return route.fulfill(
      jsonResponse({
        intents: [
          {
            id: fixture.billingId,
            ownerAddress: fixture.ownerAddress,
            txHash: fixture.billingTxHash,
            amountUsdc: "100.000000",
            status: "CONFIRMED",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      })
    );
  }
  if (pathname === "/api/v1/refunds") return route.fulfill(jsonResponse({ refunds: [] }));
  if (pathname === "/api/v1/balance/consumer/withdrawals") {
    return route.fulfill(jsonResponse({ withdrawals: [] }));
  }
  if (pathname === "/api/v1/usage/logs") {
    return route.fulfill(
      jsonResponse({
        logs: [
          {
            id: fixture.invocationId,
            request_id: fixture.invocationId,
            origin_request_id: fixture.internalAgentPrincipal,
            agent_id: fixture.agentId,
            ownerAddress: fixture.ownerAddress,
            providerAddress: fixture.providerAddress,
            service_id: fixture.serviceId,
            status: "succeeded",
            unit_price: 0.01,
            total_charge: 0.01,
            protocol_fee: 0.001,
            provider_net: 0.009,
            latency_ms: 125,
            created_at: Math.floor(Date.now() / 1000),
          },
        ],
        total: 1,
        page: Number(url.searchParams.get("page") || 1),
        pageSize: Number(url.searchParams.get("pageSize") || 10),
        hasMore: false,
      })
    );
  }
  if (pathname === "/api/v1/credentials/agent/list") {
    return route.fulfill(jsonResponse({ credentials: credentialRows() }));
  }
  if (pathname === "/api/v1/credentials/agent/issue") {
    return route.fulfill(
      jsonResponse({
        credential: {
          ...credentialRows()[0],
          id: "cred-issued-copyable-000000000000000000000001",
          token: fixture.issuedToken,
          tokenPrefix: "agt_copyable",
        },
      })
    );
  }
  if (pathname === "/api/v1/credentials/agent/audit") {
    return route.fulfill(jsonResponse({ logs: [] }));
  }
  if (pathname === "/api/v1/services") {
    return route.fulfill(jsonResponse({ services: serviceRows() }));
  }
  if (pathname.includes("/health/history")) {
    return route.fulfill(
      jsonResponse({
        serviceId: fixture.serviceId,
        retentionHours: 24,
        targets: [
          {
            targetUrl: fixture.endpointUrl,
            points: [
              {
                checkedAt: Date.now(),
                status: "healthy",
                latencyMs: 25,
              },
            ],
          },
        ],
      })
    );
  }
  if (pathname === "/api/v1/providers/earnings/summary") {
    return route.fulfill(
      jsonResponse({
        summary: {
          ownerAddress: fixture.ownerAddress,
          totalApiCalls: 1,
          totalEarned: 0.01,
          totalProtocolFee: 0.001,
          totalRoutingTax: 0,
          providerNetEarned: 0.009,
          providerReceivable: 42,
          duplicateRowsDropped: 0,
          idempotencyKey: "copyable-summary",
          recentCalls: [
            {
              requestId: fixture.settlementRequestId,
              serviceId: fixture.serviceId,
              status: "SETTLED",
              unitPrice: 0.01,
              protocolFee: 0.001,
              routingTax: 0,
              providerNet: 0.009,
              createdAt: Math.floor(Date.now() / 1000),
            },
          ],
        },
      })
    );
  }
  if (pathname === "/api/v1/providers/withdrawals") {
    return route.fulfill(jsonResponse({ withdrawals: withdrawalRows() }));
  }
  if (pathname === "/api/v1/providers/withdrawals/capability") {
    return route.fulfill(
      jsonResponse({
        ticketSigningEnabled: true,
        message: "Provider withdrawal available.",
        contractAddress: "0x0000000000000000000000000000000000000001",
      })
    );
  }
  return route.fulfill(jsonResponse({ ok: true }));
}

async function installFixtureAuth(context) {
  await context.addInitScript(
    ({ ownerAddress }) => {
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
      localStorage.setItem("synapse_lang", "en");
      localStorage.setItem("synapse_e2e_wallet_connected", "1");
      localStorage.setItem("a2a_selected_role", "CONSUMER");
      localStorage.setItem(`a2a_role_${ownerAddress.toLowerCase()}`, "CONSUMER");
      localStorage.setItem(
        "a2a_auth_session",
        JSON.stringify({
          wallet: ownerAddress.toLowerCase(),
          token: "copyable-fixture-token",
          expiresAt,
        })
      );
      localStorage.setItem(
        "wagmi.store",
        JSON.stringify({
          state: {
            connections: {
              __type: "Map",
              value: [
                [
                  "injected",
                  {
                    accounts: [ownerAddress],
                    chainId: 31337,
                    connector: {
                      id: "injected",
                      name: "Injected",
                      type: "injected",
                      uid: "injected",
                    },
                  },
                ],
              ],
            },
            chainId: 31337,
            current: "injected",
            status: "connected",
          },
          version: 2,
        })
      );
      localStorage.setItem("wagmi.recentConnectorId", JSON.stringify("injected"));
      localStorage.setItem("wagmi.injected.connected", JSON.stringify(true));
      window.ethereum = {
        isMetaMask: true,
        selectedAddress: ownerAddress,
        chainId: "0x7a69",
        isConnected: () => true,
        request: async ({ method }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") {
            return [ownerAddress];
          }
          if (method === "eth_chainId") return "0x7a69";
          return null;
        },
        on: () => {},
        removeListener: () => {},
      };
    },
    { ownerAddress: fixture.ownerAddress }
  );
}

async function bodyText(page) {
  return page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
}

async function waitForText(page, text, pageName) {
  const expected = Array.isArray(text) ? text : [text];
  for (let i = 0; i < 40; i += 1) {
    const body = await bodyText(page);
    if (expected.every((item) => body.includes(item))) return;
    await page.waitForTimeout(250);
  }
  const body = await bodyText(page);
  throw new Error(
    `${pageName} missing text: ${expected.join(", ")}; body=${body.slice(0, 800)}`
  );
}

async function assertNoForbidden(page, pageName) {
  const forbiddenTexts = [
    "agent:agent:",
    "Counterparty",
    fixture.providerAddress,
    "Connect Wallet",
    "Loading",
    "Unauthorized",
    "Failed to fetch",
    "Internal Server Error",
  ];
  let body = "";
  let forbidden = [];
  for (let i = 0; i < 20; i += 1) {
    body = await bodyText(page);
    forbidden = forbiddenTexts.filter((text) => body.includes(text));
    if (forbidden.length === 0) break;
    await page.waitForTimeout(250);
  }
  const ok = forbidden.length === 0;
  evidence.dom.push({
    page: pageName,
    forbidden,
    forbiddenTextAbsent: ok,
    bodyExcerpt: body.slice(0, 1200),
  });
  if (!ok) {
    throw new Error(`${pageName} contains forbidden text: ${forbidden.join(", ")}`);
  }
}

async function capture(page, name, expectedText) {
  const file = `screenshots/${name}.png`;
  await page.screenshot({ path: path.join(outDir, file), fullPage: true });
  evidence.screenshots.push({
    file,
    url: page.url(),
    expectedText,
    forbiddenTextAbsent: true,
    domCheckpoint: name,
    apiCheckpoint: "route-fixtures",
    dbCheckpoint: "not-applicable-local-dom-fixture",
    capturedAt: new Date().toISOString(),
  });
}

async function clickCopyAndAssert(
  page,
  pageName,
  label,
  expectedValue,
  options = {}
) {
  const button = page.getByRole("button", { name: `Copy ${label}` }).first();
  const count = await page.getByRole("button", { name: `Copy ${label}` }).count();
  if (count < 1) {
    throw new Error(`${pageName} missing copy button for ${label}`);
  }
  await button.click();
  let clipboardText = "";
  for (let i = 0; i < 20; i += 1) {
    clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    if (clipboardText === expectedValue) break;
    await page.waitForTimeout(100);
  }
  const toastSeen = await page
    .getByText(`${label} copied`)
    .first()
    .isVisible({ timeout: 2_500 })
    .catch(() => false);
  const ok = clipboardText === expectedValue;
  evidence.clipboard.push({
    page: pageName,
    label,
    expectedValue,
    clipboardText,
    toastSeen,
    toastRequired: options.requireToast !== false,
    ok,
  });
  if (!ok) {
    throw new Error(
      `${pageName} copied wrong ${label}: expected ${expectedValue}, got ${clipboardText}`
    );
  }
  if (options.requireToast !== false && !toastSeen) {
    const body = await bodyText(page);
    throw new Error(
      `${pageName} copied ${label}, but copied toast was not visible; body=${body.slice(-500)}`
    );
  }
}

async function visit(page, href, expectedText) {
  const url = `${config.frontendUrl}${href}`;
  let response = null;
  try {
    response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("net::ERR_ABORTED")) {
      throw error;
    }
  }
  await waitForText(page, expectedText, href);
  await assertNoForbidden(page, href);
  addTrace("dom", { href, status: response?.status() || 0 });
}

async function run() {
  assertLocalUrl("USER_FRONT_BASE_URL", config.frontendUrl);
  assertLocalUrl("USER_FRONT_GATEWAY_BASE_URL", config.gatewayBase);
  assertLocalUrl("USER_FRONT_RPC_URL", config.rpcUrl);

  const browser = await chromium.launch({ headless: config.headless });
  try {
    const context = await browser.newContext();
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: config.frontendUrl,
    });
    await installFixtureAuth(context);
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      const postData = route.request().postData() || "";
      if (
        url.startsWith(config.rpcUrl) ||
        isLocalPortUrl(url, 8545) ||
        postData.includes('"jsonrpc"')
      ) {
        return fulfillRpc(route);
      }
      if (
        url.startsWith(config.gatewayBase) ||
        isLocalPortUrl(url, 8000) ||
        isGatewayApiUrl(url) ||
        url.includes("/api/logs")
      ) {
        return fulfillGateway(route);
      }
      return route.continue();
    });
    const page = await context.newPage();

    await visit(page, "/dashboard/billing", ["Payments", "Transaction ID"]);
    await waitForText(page, "de...0001", "billing short id");
    await clickCopyAndAssert(page, "billing", "Transaction ID", fixture.billingId);
    await clickCopyAndAssert(
      page,
      "billing",
      "Transaction hash",
      fixture.billingTxHash
    );
    addCheck("billing:copy", true, "transaction id and tx hash copy");
    await capture(page, "billing-copyable-identifiers", "Transaction ID");

    await visit(page, "/dashboard/invocations", [
      "Invocations",
      "svc_os...heck",
    ]);
    await clickCopyAndAssert(page, "invocations", "Invocation ID", fixture.invocationId);
    await clickCopyAndAssert(page, "invocations", "Service", fixture.serviceId);
    await clickCopyAndAssert(page, "invocations", "Agent", fixture.agentId);
    addCheck("invocations:copy-and-privacy", true, "safe ids copy; internals hidden");
    await capture(page, "invocations-copyable-identifiers", "Invocations");

    await visit(page, "/dashboard/account/settings", [
      "Settings",
      "Wallet",
    ]);
    await clickCopyAndAssert(
      page,
      "account-settings",
      "Wallet",
      fixture.ownerAddress
    );
    addCheck("account-settings:wallet-copy", true, "owner wallet copies");
    await capture(page, "account-settings-copyable-wallet", "Connected wallet");

    await visit(page, "/dashboard/credentials", [
      "Agent Credentials",
      "Universal Key",
    ]);
    await page.getByRole("button", { name: "Issue Credential" }).first().click();
    await page.getByRole("button", { name: "Issue Credential" }).last().click();
    await waitForText(page, "Credential Issued", "credentials issue modal");
    await clickCopyAndAssert(
      page,
      "credentials",
      "Secret API Key",
      fixture.issuedToken
    );
    addCheck("credentials:secret-copy", true, "one-time token copies");
    await capture(page, "credentials-copyable-token", "Credential Issued");
    await page.waitForTimeout(4_200);

    await visit(page, "/dashboard/agents", [
      "Agents",
      "Copyable QA Agent",
    ]);
    await page.getByText("Copyable QA Agent").first().click();
    await waitForText(page, "Agent Credential", "agents detail");
    await clickCopyAndAssert(
      page,
      "agents",
      "Agent ID",
      fixture.agentId,
      { requireToast: false }
    );
    addCheck("agents:agent-id-copy", true, "agent id copies");
    await capture(page, "agents-copyable-agent-id", "Copyable QA Agent");

    await visit(page, "/provider/services", [
      "API Services",
      "OSS Security Healthcheck",
    ]);
    await clickCopyAndAssert(
      page,
      "provider-services",
      "Invoke URL",
      fixture.endpointUrl
    );
    await clickCopyAndAssert(
      page,
      "provider-services",
      "Service ID",
      fixture.serviceId
    );
    addCheck("provider-services:copy", true, "service id and endpoint copy");
    await capture(page, "provider-services-copyable-identifiers", "API Services");

    await visit(page, "/provider/health", [
      "API Service Health",
      fixture.serviceId,
    ]);
    await clickCopyAndAssert(page, "provider-health", "Service ID", fixture.serviceId, {
      requireToast: false,
    });
    addCheck("provider-health:copy", true, "selected service id copies");
    await capture(page, "provider-health-copyable-service-id", "API Service Health");

    await visit(page, "/provider/usage", [
      "Usage Analytics",
      fixture.serviceId,
    ]);
    await clickCopyAndAssert(page, "provider-usage", "Service ID", fixture.serviceId);
    addCheck("provider-usage:copy", true, "usage service id copies");
    await capture(page, "provider-usage-copyable-service-id", "Usage Analytics");

    await visit(page, "/provider/settlements", [
      "Provider Withdraw",
      "WITHDRAWAL ID",
    ]);
    await clickCopyAndAssert(
      page,
      "provider-settlements",
      "Withdrawal ID",
      fixture.providerWithdrawalId
    );
    await clickCopyAndAssert(
      page,
      "provider-settlements",
      "Nonce",
      fixture.providerNonce,
      { requireToast: false }
    );
    await clickCopyAndAssert(
      page,
      "provider-settlements",
      "Tx Hash",
      fixture.providerWithdrawalTxHash
    );
    addCheck(
      "provider-settlements:copy",
      true,
      "settlements alias redirects to withdraw history copy controls"
    );
    await capture(page, "provider-settlements-copyable-identifiers", "Provider Withdraw");

    await visit(page, "/provider/withdraw", [
      "Provider Withdraw",
      "WITHDRAWAL ID",
    ]);
    await clickCopyAndAssert(
      page,
      "provider-withdraw",
      "Withdrawal ID",
      fixture.providerWithdrawalId
    );
    await clickCopyAndAssert(
      page,
      "provider-withdraw",
      "Nonce",
      fixture.providerNonce
    );
    await clickCopyAndAssert(
      page,
      "provider-withdraw",
      "Tx Hash",
      fixture.providerWithdrawalTxHash
    );
    addCheck("provider-withdraw:copy", true, "withdrawal id, nonce, tx hash copy");
    await capture(page, "provider-withdraw-copyable-identifiers", "Provider Withdraw");
  } finally {
    await browser.close();
  }
}

function writeEvidence(status) {
  const traceText = evidence.trace.map((row) => JSON.stringify(row)).join("\n") + "\n";
  const report = {
    status,
    environment: evidence.environment,
    generatedAt: evidence.generatedAt,
    frontendUrl: evidence.frontendUrl,
    checks: evidence.checks,
    failed: evidence.failed,
    screenshots: evidence.screenshots.map((row) => row.file),
    traceDigest: crypto.createHash("sha256").update(traceText).digest("hex"),
  };
  fs.writeFileSync(path.join(outDir, "trace.jsonl"), traceText);
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, "dom-evidence.json"), JSON.stringify(evidence.dom, null, 2));
  fs.writeFileSync(
    path.join(outDir, "clipboard-evidence.json"),
    JSON.stringify(evidence.clipboard, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "screenshot-evidence.json"),
    JSON.stringify(evidence.screenshots, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "bugfix-log.md"),
    evidence.failed.length
      ? evidence.failed.map((row) => `- OPEN ${row.name}: ${row.detail}`).join("\n") + "\n"
      : "# Bugfix Log\n\nNo open bugs.\n"
  );
  fs.writeFileSync(
    path.join(outDir, "report.md"),
    [
      "# User-front Copyable Identifiers E2E",
      "",
      `Status: ${status}`,
      `Generated: ${evidence.generatedAt}`,
      "",
      "## Checks",
      ...evidence.checks.map((row) => `- ${row.ok ? "PASS" : "FAIL"} ${row.name}`),
      "",
    ].join("\n")
  );
}

run()
  .then(() => {
    writeEvidence(evidence.failed.length ? "failed" : "success");
    if (evidence.failed.length) process.exitCode = 1;
  })
  .catch((error) => {
    addCheck("runner:fatal", false, error instanceof Error ? error.message : String(error));
    writeEvidence("failed");
    process.exitCode = 1;
  });
