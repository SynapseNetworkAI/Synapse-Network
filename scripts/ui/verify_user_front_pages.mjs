#!/usr/bin/env node

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BASE_URL = process.env.USER_FRONT_BASE_URL || "http://localhost:3000";
const VERIFY_MODE = process.env.USER_FRONT_VERIFY_MODE || (process.env.USER_FRONT_FULLCHAIN_FIXTURE ? "fullchain" : "smoke");
const VERIFY_REAL_BACKEND = process.env.USER_FRONT_VERIFY_REAL_BACKEND === "1";
const EFFECTIVE_REAL_BACKEND = VERIFY_REAL_BACKEND || VERIFY_MODE === "fullchain";
const GATEWAY_HEALTH_URL = process.env.USER_FRONT_GATEWAY_HEALTH_URL || "http://127.0.0.1:8000/health";
const FULLCHAIN_FIXTURE_PATH = process.env.USER_FRONT_FULLCHAIN_FIXTURE
  ? path.resolve(process.env.USER_FRONT_FULLCHAIN_FIXTURE)
  : path.join(ROOT, "tmp/user-front-fullchain/fixture.json");
const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
const OUT_DIR = path.join(ROOT, "output/playwright/user-front-verification", timestamp);
const REGISTRY_PATH = path.join(ROOT, "services/user-front/src/app/user-front-page-registry.json");

const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
const fullchainFixture = VERIFY_MODE === "fullchain"
  ? JSON.parse(fs.readFileSync(FULLCHAIN_FIXTURE_PATH, "utf8"))
  : null;
const screenshotRows = registry.filter((row) => row.visualVerification === "screenshot-required");
const routeRows = registry.filter((row) => row.kind !== "api" && !row.kind.includes("redirect"));
const redirectRows = registry.filter((row) => row.kind.includes("redirect"));

fs.mkdirSync(OUT_DIR, { recursive: true });

const passed = [];
const failed = [];
const blocked = [];
const warnings = [];
const screenshots = [];
const consoleErrors = [];
const backendResponses = [];
let marketplaceRegistryTotal = null;

function pass(name, detail = "") {
  passed.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
}

function fail(name, detail) {
  failed.push({ name, detail });
  console.error(`FAIL ${name} - ${detail}`);
}

function block(name, detail) {
  blocked.push({ name, detail });
  console.warn(`BLOCKED ${name} - ${detail}`);
}

function warn(name, detail) {
  warnings.push({ name, detail });
  console.warn(`WARN ${name} - ${detail}`);
}

async function step(name, fn) {
  try {
    const detail = await fn();
    pass(name, detail);
  } catch (error) {
    fail(name, error instanceof Error ? error.message : String(error));
  }
}

function pageUrl(href) {
  return `${BASE_URL}${href}`;
}

async function goto(page, href) {
  await page.goto(pageUrl(href), { waitUntil: "commit", timeout: 60000 });
}

function canonicalAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function fixtureServices() {
  if (!fullchainFixture) return [];
  if (Array.isArray(fullchainFixture.services) && fullchainFixture.services.length > 0) {
    return fullchainFixture.services;
  }
  return fullchainFixture.service ? [fullchainFixture.service] : [];
}

function fixtureInvocations() {
  if (!fullchainFixture) return [];
  if (Array.isArray(fullchainFixture.invocations) && fullchainFixture.invocations.length > 0) {
    return fullchainFixture.invocations;
  }
  return fullchainFixture.invocation ? [fullchainFixture.invocation] : [];
}

function decimalToAtomic(value, decimals = 6) {
  const normalized = String(value ?? "0").trim().replace(/[$,\s]/g, "");
  const sign = normalized.startsWith("-") ? -1n : 1n;
  const unsigned = normalized.replace(/^[+-]/, "");
  if (!/^\d+(\.\d+)?$/.test(unsigned)) {
    return 0n;
  }
  const [whole, fraction = ""] = unsigned.split(".");
  const atomic = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0").slice(0, decimals));
  return sign * atomic;
}

function atomicToDecimal(value, decimals = 6) {
  const atomic = BigInt(value || 0);
  const scale = 10n ** BigInt(decimals);
  const sign = atomic < 0n ? "-" : "";
  const abs = atomic < 0n ? -atomic : atomic;
  const whole = abs / scale;
  const fraction = String(abs % scale).padStart(decimals, "0");
  return `${sign}${whole}.${fraction}`;
}

function formatMoneyCandidates(value) {
  const exact = String(value ?? "0");
  const atomic = decimalToAtomic(exact);
  const six = atomicToDecimal(atomic);
  const asNumber = Number(atomic) / 1_000_000;
  const two = asNumber.toFixed(2);
  const floorTwo = (Math.floor(asNumber * 100) / 100).toFixed(2);
  const ceilTwo = (Math.ceil(asNumber * 100) / 100).toFixed(2);
  const trimmed = six.replace(/\.?0+$/, "");
  return [...new Set([
    exact,
    six,
    trimmed,
    two,
    floorTwo,
    ceilTwo,
    `$${two}`,
    `$${floorTwo}`,
    `$${ceilTwo}`,
    `${two} USDC`,
    `${floorTwo} USDC`,
    `${ceilTwo} USDC`,
    `${trimmed} USDC`,
  ].filter(Boolean))];
}

function fixtureUserForAudience(audience) {
  if (!fullchainFixture) {
    return null;
  }
  return audience === "provider" ? fullchainFixture.provider : fullchainFixture.consumer;
}

async function fixtureApi(pathname, { audience = "consumer" } = {}) {
  if (!fullchainFixture) {
    throw new Error("fullchain fixture is not loaded");
  }
  const user = fixtureUserForAudience(audience);
  if (!user?.token || !user?.address) {
    throw new Error(`fullchain fixture missing ${audience} token/address`);
  }
  const baseUrl = fullchainFixture.baseUrls?.gateway || "http://127.0.0.1:8000";
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api${pathname}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${user.token}`,
      "X-User-Address": user.address,
    },
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (!response.ok) {
    throw new Error(`fixture API ${pathname} failed: ${response.status} ${JSON.stringify(payload).slice(0, 500)}`);
  }
  return payload;
}

function buildWagmiStore(address, chainId) {
  return {
    state: {
      connections: {
        __type: "Map",
        value: [
          ["injected", {
            accounts: [address],
            chainId,
            connector: { id: "injected", name: "Injected", type: "injected", uid: "injected" },
          }],
        ],
      },
      chainId,
      current: "injected",
      status: "connected",
    },
    version: 2,
  };
}

async function installFullchainAuth(context, role) {
  if (!fullchainFixture) {
    return;
  }
  const audience = role === "PROVIDER" ? "provider" : "consumer";
  const user = fixtureUserForAudience(audience);
  if (!user?.address || !user?.token) {
    throw new Error(`fullchain fixture missing ${audience} address/token`);
  }
  const chainId = Number(fullchainFixture.chain?.chainId || 31337);
  const chainHex = `0x${chainId.toString(16)}`;
  const rpcUrl = fullchainFixture.baseUrls?.rpc || "http://127.0.0.1:8545";
  const session = {
    token: user.token,
    wallet: canonicalAddress(user.address),
    expiresAt: user.expiresAt || Date.now() + 24 * 60 * 60 * 1000,
  };
  const wagmiStore = buildWagmiStore(user.address, chainId);

  await context.addInitScript(({ address, chainId, chainHex, role, rpcUrl, session, wagmiStore }) => {
    localStorage.setItem("synapse_lang", "en");
    localStorage.setItem("a2a_selected_role", role);
    localStorage.setItem(`a2a_role_${String(address).toLowerCase()}`, role);
    localStorage.setItem("a2a_auth_session", JSON.stringify(session));
    localStorage.setItem("wagmi.store", JSON.stringify(wagmiStore));
    localStorage.setItem("wagmi.recentConnectorId", JSON.stringify("injected"));
    localStorage.setItem("wagmi.injected.connected", JSON.stringify(true));
    localStorage.removeItem("wagmi.injected.disconnected");

    const listeners = {};
    window.ethereum = {
      isMetaMask: true,
      chainId: chainHex,
      networkVersion: String(chainId),
      selectedAddress: address,
      _metamask: { isUnlocked: () => Promise.resolve(true) },
      isConnected: () => true,
      request: async (args) => {
        const method = args?.method;
        const params = args?.params || [];
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
        if (method === "eth_chainId") return chainHex;
        if (method === "net_version") return String(chainId);
        if (method === "wallet_switchEthereumChain") return null;
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }];
        if (method === "personal_sign" || method === "eth_signTypedData_v4") {
          throw new Error("Fullchain verification pre-authenticates the wallet; interactive signing is intentionally disabled.");
        }
        const response = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
        });
        const payload = await response.json();
        if (payload.error) {
          throw new Error(payload.error.message || "RPC request failed");
        }
        return payload.result;
      },
      on: (event, cb) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(cb);
      },
      removeListener: (event, cb) => {
        if (listeners[event]) listeners[event] = listeners[event].filter((listener) => listener !== cb);
      },
      removeAllListeners: () => {},
    };
    setTimeout(() => {
      window.dispatchEvent(new Event("ethereum#initialized"));
    }, 0);
  }, { address: user.address, chainId, chainHex, role, rpcUrl, session, wagmiStore });
}

function resolveVerificationHref(href) {
  if (href === "/docs/api-reference/[id]") {
    return "/docs/api-reference/get-balance";
  }
  const firstService = fixtureServices()[0];
  if (VERIFY_MODE === "fullchain" && href === "/provider/health" && firstService?.id) {
    return `/provider/health?serviceId=${encodeURIComponent(firstService.id)}`;
  }
  return href;
}

async function expectAnyText(page, texts, href) {
  for (const text of texts) {
    const locator = page.getByText(text, { exact: false }).first();
    if (await locator.waitFor({ state: "visible", timeout: 20000 }).then(() => true).catch(() => false)) {
      return text;
    }
  }
  throw new Error(`${href} did not show any expected text: ${texts.join(", ")}`);
}

async function assertNoHorizontalOverflow(page, href) {
  const result = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  const overflow = Math.max(result.scrollWidth, result.bodyWidth) - result.innerWidth;
  if (overflow > 4) {
    throw new Error(`${href} has horizontal overflow ${overflow}px`);
  }
}

async function captureScreenshot(page, name) {
  const out = path.join(OUT_DIR, name);
  await page.screenshot({ path: out, fullPage: false });
  screenshots.push(out);
}

async function verifyGatewayHealth() {
  if (!EFFECTIVE_REAL_BACKEND) {
    warn("backend:real-data", "USER_FRONT_VERIFY_REAL_BACKEND=1 not set; browser checks still run, data truth is not enforced");
    return;
  }
  const response = await fetch(GATEWAY_HEALTH_URL);
  if (!response.ok) {
    throw new Error(`gateway health failed: ${response.status} ${response.statusText}`);
  }
}

async function verifyRegistryJson() {
  const query = VERIFY_MODE === "fullchain" && fullchainFixture?.runId
    ? `?q=${encodeURIComponent(fullchainFixture.runId)}&page=1&pageSize=10`
    : "?page=1&pageSize=10";
  const response = await fetch(`${BASE_URL}/marketplace/registry.json${query}`);
  if (!response.ok) {
    throw new Error(`registry.json failed: ${response.status}`);
  }
  const payload = await response.json();
  if (payload.status !== "success") {
    throw new Error(`registry.json status was ${payload.status}`);
  }
  if (!Array.isArray(payload.services)) {
    throw new Error("registry.json services is not an array");
  }
  if (!payload.pagination || payload.pagination.pageSize !== 10) {
    throw new Error("registry.json pagination metadata missing or wrong");
  }
  const unavailable = payload.services.filter((service) => service.isActive === false || service.runtimeAvailable === false);
  if (unavailable.length > 0) {
    throw new Error(`registry.json returned unavailable services: ${unavailable.map((service) => service.serviceId).join(", ")}`);
  }
  if (VERIFY_MODE === "fullchain") {
    const expectedServices = fixtureServices();
    if (!payload.pagination || Number(payload.pagination.total || 0) < 1) {
      throw new Error("fullchain registry.json did not return any callable services");
    }
    const missing = expectedServices.filter((expectedService) =>
      !payload.services.some((service) => service.serviceId === expectedService.id || service.service_id === expectedService.id)
    );
    if (missing.length > 0) {
      throw new Error(`fullchain registry.json did not include seeded services: ${missing.map((service) => service.id).join(", ")}`);
    }
  }
  marketplaceRegistryTotal = Number(payload.pagination.total || payload.services.length || 0);
  return `${payload.services.length} services returned, total=${payload.pagination.total}`;
}

async function verifyMarketplaceControls(page) {
  await goto(page, "/marketplace");
  const searchVisible = await page
    .getByRole("textbox")
    .first()
    .waitFor({ state: "visible", timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (!searchVisible) {
    throw new Error("marketplace search input is not visible");
  }

  const tagControls = await page.locator("button").filter({ hasText: /All|全部|All tags|标签/i }).count();
  if (tagControls < 1) {
    throw new Error("marketplace tag filter control is not visible");
  }

  const pageStatusVisible = await page
    .getByText(/Showing|Page|当前|显示|页/i)
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false);
  if (!pageStatusVisible && Number(marketplaceRegistryTotal || 0) > 10) {
    warn("marketplace:pagination-copy", "pagination copy not visible; this can be okay when the list is empty, but should be reviewed visually");
  }
}

function isRealBackendRow(row) {
  return ["public-gateway", "authenticated-gateway", "authenticated-gateway-and-chain", "public-gateway-and-chain"].includes(row.dataVerification);
}

function isAuthenticatedRow(row) {
  return String(row.dataVerification || "").startsWith("authenticated")
    || row.dataVerification === "wallet-chain"
    || row.dataVerification === "browser-local-plus-authenticated-gateway";
}

function isPureActionPage(row) {
  const sources = Array.isArray(row.dataSources) ? row.dataSources : [];
  return sources.length > 0 && !sources.some((source) => /^GET/i.test(String(source).trim()));
}

function requiresBackendResponseInFullchain(row) {
  if (!isRealBackendRow(row) && row.dataVerification !== "browser-local-plus-authenticated-gateway") {
    return false;
  }
  if (isPureActionPage(row)) {
    return false;
  }
  return true;
}

function normalizeDataSourcePath(source) {
  const match = source.match(/\/api\/v1\/[^\s,]*/);
  if (!match) {
    return "";
  }
  return match[0].replace(/:\w+/g, "");
}

function summarizeBackendResponsesFor(row) {
  const pageResponses = backendResponses.filter((item) =>
    item.page === row.href && (item.url.includes("/api/") || item.url.includes("/marketplace/registry.json"))
  );
  if (pageResponses.length > 0) {
    return pageResponses;
  }

  const sourcePaths = row.dataSources.map(normalizeDataSourcePath).filter(Boolean);
  if (sourcePaths.length === 0) {
    return [];
  }

  return backendResponses.filter((item) =>
    sourcePaths.some((sourcePath) => item.url.includes(sourcePath))
  );
}

function isDataGatewayResponse(response) {
  const url = response.url();
  return url.includes("/api/v1/") && !url.includes("/api/v1/events") && response.ok();
}

async function waitForPageGatewayEvidence(page, row) {
  if (!requiresBackendResponseInFullchain(row)) {
    return [];
  }
  const immediate = summarizeBackendResponsesFor(row).filter((item) => item.ok && !item.url.includes("/api/v1/events"));
  if (immediate.length > 0) {
    return immediate;
  }

  const response = await page
    .waitForResponse((candidate) => isDataGatewayResponse(candidate), { timeout: 45000 })
    .catch(() => null);
  if (!response) {
    return [];
  }
  const item = {
    page: row.href,
    url: response.url(),
    status: response.status(),
    ok: response.ok(),
  };
  backendResponses.push(item);
  return [item];
}

async function expectFullchainEvidence(page, row) {
  if (!fullchainFixture || !isAuthenticatedRow(row)) {
    return "";
  }

  const services = fixtureServices();
  const invocations = fixtureInvocations();
  const fragments = [
    ...services.flatMap((service) => [service.id, service.name, service.slug]),
    fullchainFixture.credential?.name,
    fullchainFixture.credential?.id,
    fullchainFixture.credential?.tokenPrefix,
    invocations[0]?.invocationId,
    invocations[invocations.length - 1]?.invocationId,
    invocations[0]?.requestId,
    invocations[invocations.length - 1]?.requestId,
    fullchainFixture.deposit?.txHash,
    fullchainFixture.provider?.address,
    fullchainFixture.consumer?.address,
  ].filter(Boolean).map((value) => String(value));

  const matched = await page
    .waitForFunction((candidates) => {
      const bodyText = document.body?.innerText?.toLowerCase() || "";
      return candidates.find((fragment) => bodyText.includes(String(fragment).toLowerCase())) || "";
    }, fragments, { timeout: 30000 })
    .then((handle) => handle.jsonValue())
    .catch(() => "");
  if (matched) {
    return `fixture text matched: ${String(matched).slice(0, 80)}`;
  }

  if (requiresBackendResponseInFullchain(row)) {
    const responses = await waitForPageGatewayEvidence(page, row);
    if (responses.length === 0) {
      throw new Error(`${row.href} did not call a gateway API in fullchain mode`);
    }
    const failedResponses = responses.filter((item) => !item.ok);
    if (failedResponses.length > 0) {
      throw new Error(`${row.href} gateway responses failed: ${failedResponses.map((item) => `${item.status} ${item.url}`).join("; ")}`);
    }
    return `${responses.length} gateway response(s) verified`;
  }

  return "authenticated fixture installed";
}

async function waitForBodyFragment(page, fragments, label, timeout = 30000) {
  const candidates = fragments.filter(Boolean).map((value) => String(value));
  if (candidates.length === 0) {
    throw new Error(`${label} has no candidate fragments`);
  }
  const matched = await page
    .waitForFunction((values) => {
      const bodyText = document.body?.innerText?.toLowerCase() || "";
      return values.find((fragment) => bodyText.includes(String(fragment).toLowerCase())) || "";
    }, candidates, { timeout })
    .then((handle) => handle.jsonValue())
    .catch(() => "");
  if (!matched) {
    throw new Error(`${label} was not visible in page body. Expected one of: ${candidates.slice(0, 8).join(", ")}`);
  }
  return String(matched);
}

function seededUsageRows(payload) {
  const rows = Array.isArray(payload.logs) ? payload.logs : Array.isArray(payload.records) ? payload.records : [];
  const requestIds = new Set(fixtureInvocations().map((item) => String(item.requestId || "")));
  const serviceIds = new Set(fixtureServices().map((item) => String(item.id || "")));
  return rows.filter((row) => {
    const requestId = String(row.requestId || row.request_id || row.originRequestId || row.origin_request_id || "");
    const serviceId = String(row.serviceId || row.service_id || "");
    return requestIds.has(requestId) || serviceIds.has(serviceId);
  });
}

function findSeededCredential(credentialsPayload) {
  const credentials = Array.isArray(credentialsPayload.credentials) ? credentialsPayload.credentials : [];
  return credentials.find((credential) => credential.id === fullchainFixture?.credential?.id);
}

async function verifyFullchainPageData(page, row) {
  if (!fullchainFixture || VERIFY_MODE !== "fullchain" || !isAuthenticatedRow(row)) {
    return "";
  }

  const services = fixtureServices();
  const serviceIds = services.map((service) => service.id);
  const serviceNames = services.map((service) => service.name);
  const invocations = fixtureInvocations();
  const totalCalls = Number(fullchainFixture.invocationPlan?.totalCalls || invocations.length || 0);

  if (row.href === "/dashboard/agents") {
    const credentialsPayload = await fixtureApi("/v1/credentials/agent/list", { audience: "consumer" });
    const credential = findSeededCredential(credentialsPayload);
    if (!credential) {
      throw new Error(`seeded agent credential ${fullchainFixture.credential?.id} was not returned by /credentials/agent/list`);
    }
    if (Number(credential.callsUsed || 0) < totalCalls) {
      throw new Error(`seeded agent callsUsed=${credential.callsUsed}; expected at least ${totalCalls}`);
    }
    const matched = await waitForBodyFragment(
      page,
      [fullchainFixture.credential?.name, fullchainFixture.credential?.id, fullchainFixture.credential?.tokenPrefix],
      "/dashboard/agents seeded credential",
    );
    await page.getByText(fullchainFixture.credential?.name || fullchainFixture.credential?.tokenPrefix, { exact: false }).first().click({ timeout: 10000 }).catch(() => {});
    await waitForBodyFragment(page, [String(totalCalls), String(credential.callsUsed)], "/dashboard/agents calls used", 15000);
    return `agent credential visible (${matched}), callsUsed=${credential.callsUsed}`;
  }

  if (row.href === "/dashboard/credentials") {
    const credentialsPayload = await fixtureApi("/v1/credentials/agent/list", { audience: "consumer" });
    const credential = findSeededCredential(credentialsPayload);
    if (!credential) {
      throw new Error(`seeded credential ${fullchainFixture.credential?.id} missing from credentials API`);
    }
    if (String(credential.status || "").toLowerCase() !== "active") {
      throw new Error(`seeded credential status was ${credential.status}`);
    }
    if (Number(credential.callsUsed || 0) < totalCalls) {
      throw new Error(`seeded credential callsUsed=${credential.callsUsed}; expected at least ${totalCalls}`);
    }
    const matched = await waitForBodyFragment(
      page,
      [fullchainFixture.credential?.tokenPrefix, fullchainFixture.credential?.name, fullchainFixture.credential?.id],
      "/dashboard/credentials seeded credential",
    );
    return `credential visible (${matched}), callsUsed=${credential.callsUsed}, status=${credential.status}`;
  }

  if (row.href === "/dashboard/invocations") {
    const usagePayload = await fixtureApi("/v1/usage/logs?limit=500", { audience: "consumer" });
    const seededRows = seededUsageRows(usagePayload);
    if (seededRows.length < totalCalls) {
      throw new Error(`${row.href} usage API returned ${seededRows.length}/${totalCalls} seeded rows`);
    }
    const latestInvocation = invocations[invocations.length - 1] || invocations[0];
    const matched = await waitForBodyFragment(
      page,
      [latestInvocation?.serviceId, latestInvocation?.invocationId, latestInvocation?.requestId, serviceIds[services.length - 1], serviceNames[services.length - 1]],
      `${row.href} seeded invocation evidence`,
    );
    return `seeded usage rows=${seededRows.length}, UI matched ${matched}`;
  }

  if (row.href === "/dashboard/audit") {
    const auditPayload = await fixtureApi("/v1/finance/audit-logs?limit=10", { audience: "consumer" });
    const riskPayload = await fixtureApi("/v1/finance/risk-overview", { audience: "consumer" });
    return `audit APIs verified (logs=${Array.isArray(auditPayload.logs) ? auditPayload.logs.length : 0}, risk=${riskPayload.status || "success"})`;
  }

  if (row.href === "/dashboard/overview") {
    const balancePayload = await fixtureApi("/v1/balance", { audience: "consumer" });
    const credentialsPayload = await fixtureApi("/v1/credentials/agent/list", { audience: "consumer" });
    const credential = findSeededCredential(credentialsPayload);
    if (!credential || Number(credential.callsUsed || 0) < totalCalls) {
      throw new Error(`/dashboard/overview credential summary API did not include seeded callsUsed=${totalCalls}`);
    }
    const apiBalance = String(balancePayload.balance?.consumerAvailableBalance ?? balancePayload.balance?.ownerBalance ?? "");
    return `overview data APIs verified (balance=${apiBalance}, callsUsed=${credential.callsUsed}); page does not render balance as a primary metric`;
  }

  if (row.href === "/dashboard/billing") {
    const depositAmount = String(fullchainFixture.deposit?.amountUsdc || "");
    const matched = await waitForBodyFragment(page, [...formatMoneyCandidates(depositAmount), fullchainFixture.deposit?.txHash?.slice(-6)], "/dashboard/billing seeded deposit");
    return `payments ledger verified seeded deposit ${depositAmount} USDC (UI matched ${matched})`;
  }

  if (row.href === "/dashboard/billing/credits") {
    const balancePayload = await fixtureApi("/v1/balance", { audience: "consumer" });
    const apiBalance = String(balancePayload.balance?.consumerAvailableBalance ?? balancePayload.balance?.ownerBalance ?? "");
    const expectedBalance = String(
      fullchainFixture.reconciliation?.balanceAfterInvoke?.consumerAvailableBalance ??
      fullchainFixture.reconciliation?.balanceAfterInvoke?.ownerBalance ??
      "",
    );
    if (expectedBalance && decimalToAtomic(apiBalance) !== decimalToAtomic(expectedBalance)) {
      throw new Error(`${row.href} balance API mismatch: api=${apiBalance}, fixture=${expectedBalance}`);
    }
    const matched = await waitForBodyFragment(
      page,
      formatMoneyCandidates(apiBalance),
      `${row.href} final consumer balance`,
      30000,
    );
    return `consumer balance verified at ${apiBalance} (UI matched ${matched})`;
  }

  if (row.href === "/dashboard/discovery") {
    const discoverPayload = await fixtureApi(`/v1/services/discover?intent=${encodeURIComponent(fullchainFixture.runId)}`, { audience: "consumer" });
    const rows = Array.isArray(discoverPayload.services) ? discoverPayload.services : [];
    const missing = services.filter((expectedService) => !rows.some((service) =>
      service.serviceId === expectedService.id || service.service_id === expectedService.id || service.agentToolName === expectedService.id
    ));
    if (missing.length > 0) {
      throw new Error(`${row.href} discovery missing seeded services: ${missing.map((service) => service.id).join(", ")}`);
    }
    const matched = await waitForBodyFragment(page, [serviceNames[0], serviceIds[0]], `${row.href} seeded service`);
    return `seeded services discoverable=${services.length}, UI matched ${matched}`;
  }

  if (row.href === "/dashboard/services") {
    const servicesPayload = await fixtureApi("/v1/services", { audience: "consumer" });
    const rows = Array.isArray(servicesPayload.services) ? servicesPayload.services : [];
    return `consumer-owned services API verified (${rows.length} row(s)); seeded provider services are validated under provider pages`;
  }

  if (row.href === "/provider/console" || row.href === "/provider/services" || row.href === "/provider/health") {
    const servicesPayload = await fixtureApi("/v1/services", { audience: "provider" });
    const rows = Array.isArray(servicesPayload.services) ? servicesPayload.services : [];
    const missing = services.filter((expectedService) => !rows.some((service) =>
      service.serviceId === expectedService.id || service.service_id === expectedService.id || service.agentToolName === expectedService.id
    ));
    if (missing.length > 0) {
      throw new Error(`${row.href} provider services API missing: ${missing.map((service) => service.id).join(", ")}`);
    }
    const unavailable = rows.filter((service) =>
      serviceIds.includes(String(service.serviceId || service.service_id || service.agentToolName || "")) &&
      (service.isActive === false || service.runtimeAvailable === false)
    );
    if (unavailable.length > 0) {
      throw new Error(`${row.href} includes unavailable seeded services: ${unavailable.map((service) => service.serviceId).join(", ")}`);
    }
    if (row.href === "/provider/console") {
      const earningsPayload = await fixtureApi("/v1/providers/earnings/summary?limit=500", { audience: "provider" });
      const providerReceivable = String(earningsPayload.summary?.providerReceivable ?? "0");
      const matched = await waitForBodyFragment(page, formatMoneyCandidates(providerReceivable), "/provider/console provider earnings");
      return `provider services verified=${services.length}, earnings=${providerReceivable} (UI matched ${matched})`;
    }
    const fragments = row.href === "/provider/services" ? [...serviceNames, ...serviceIds] : [serviceNames[0], serviceIds[0]];
    const matched = await waitForBodyFragment(page, fragments, `${row.href} seeded provider service`);
    return `provider services verified=${services.length}, UI matched ${matched}`;
  }

  if (row.href === "/provider/usage" || row.href === "/provider/withdraw/history") {
    const usagePayload = await fixtureApi("/v1/usage/logs?limit=500", { audience: "provider" });
    const seededRows = seededUsageRows(usagePayload);
    if (seededRows.length < totalCalls) {
      throw new Error(`${row.href} returned ${seededRows.length}/${totalCalls} seeded usage rows`);
    }
    const latestInvocation = invocations[invocations.length - 1] || invocations[0];
    const matched = await waitForBodyFragment(
      page,
      [latestInvocation?.serviceId, latestInvocation?.requestId, serviceIds[services.length - 1], serviceNames[services.length - 1]],
      `${row.href} seeded rows`,
    );
    return `provider usage rows=${seededRows.length}, UI matched ${matched}`;
  }

  if (row.href === "/provider/withdraw") {
    const earningsPayload = await fixtureApi("/v1/providers/earnings/summary?limit=500", { audience: "provider" });
    const capabilityPayload = await fixtureApi("/v1/providers/withdrawals/capability", { audience: "provider" });
    const providerReceivable = String(
      earningsPayload.summary?.providerReceivable ??
      earningsPayload.summary?.providerAvailableToWithdrawUsdc ??
      capabilityPayload.availableToWithdrawUsdc ??
      capabilityPayload.availableAmountUsdc ??
      "0",
    );
    const expectedNet = String(fullchainFixture.reconciliation?.totalProviderNetUsdc || "0");
    if (decimalToAtomic(providerReceivable) < decimalToAtomic(expectedNet)) {
      throw new Error(`${row.href} provider receivable ${providerReceivable} is below seeded provider net ${expectedNet}`);
    }
    const matched = await waitForBodyFragment(page, formatMoneyCandidates(providerReceivable), `${row.href} provider earnings`);
    return `provider receivable verified at ${providerReceivable} (UI matched ${matched})`;
  }

  return "";
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

try {
  const contexts = [];

  async function createContext(role = "CONSUMER") {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    contexts.push(context);
    if (VERIFY_MODE === "fullchain") {
      await installFullchainAuth(context, role);
    } else {
      await context.addInitScript((role) => {
        localStorage.setItem("synapse_lang", "en");
        localStorage.setItem("a2a_selected_role", role);
      }, role);
    }
    return context;
  }

  async function createInstrumentedPage(context, pageHref) {
    const page = await context.newPage();
    let pageClosed = false;
    page.on("close", () => {
      pageClosed = true;
    });
    page.on("console", (message) => {
      if (message.type() !== "error") {
        return;
      }
      if (pageClosed) {
        return;
      }
      const text = message.text();
      if (text.includes("Failed to fetch RSC payload") && text.includes("Falling back to browser navigation")) {
        return;
      }
      consoleErrors.push(text);
    });
    page.on("pageerror", (error) => {
      if (pageClosed) {
        return;
      }
      consoleErrors.push(error.message);
    });
    page.on("response", (response) => {
      const url = response.url();
      if (url.includes("/api/v1/") || url.includes("/marketplace/registry.json")) {
        backendResponses.push({
          page: pageHref,
          url,
          status: response.status(),
          ok: response.ok(),
        });
      }
    });
    return page;
  }

  const publicContext = await createContext("CONSUMER");
  const consumerContext = VERIFY_MODE === "fullchain" ? await createContext("CONSUMER") : publicContext;
  const providerContext = VERIFY_MODE === "fullchain" ? await createContext("PROVIDER") : publicContext;

  function contextForRow(row) {
    if (VERIFY_MODE !== "fullchain") {
      return publicContext;
    }
    if (row.audience === "provider") {
      return providerContext;
    }
    if (row.audience === "consumer") {
      return consumerContext;
    }
    return publicContext;
  }

  await step("backend:gateway-health", verifyGatewayHealth);
  await step("api:marketplace-registry-json", verifyRegistryJson);

  for (const row of routeRows) {
    await step(`page:${row.id}`, async () => {
      const context = contextForRow(row);
      const page = await createInstrumentedPage(context, row.href);
      const verificationHref = resolveVerificationHref(row.href);
      try {
        await goto(page, verificationHref);
        const matchedText = await expectAnyText(page, row.expectedTexts, verificationHref);
        await assertNoHorizontalOverflow(page, verificationHref);
        let verificationDetail = `matched "${matchedText}"`;
        if (EFFECTIVE_REAL_BACKEND && isRealBackendRow(row) && row.dataVerification.startsWith("authenticated")) {
          if (VERIFY_MODE === "fullchain") {
            const evidence = await expectFullchainEvidence(page, row);
            const pageData = await verifyFullchainPageData(page, row);
            verificationDetail = `${matchedText}; ${[evidence, pageData].filter(Boolean).join("; ")}`;
          } else {
            block(
              `data:${row.id}`,
              "requires wallet/JWT fixture; unauthenticated smoke render is verified but authenticated data truth is not proven",
            );
          }
        }
        if (EFFECTIVE_REAL_BACKEND && row.dataVerification === "public-gateway") {
          const responses = await waitForPageGatewayEvidence(page, row);
          if (responses.length === 0) {
            throw new Error(`${row.href} did not call a public backend API`);
          }
          const failedResponses = responses.filter((item) => !item.ok);
          if (failedResponses.length > 0) {
            throw new Error(`${row.href} backend responses failed: ${failedResponses.map((item) => `${item.status} ${item.url}`).join("; ")}`);
          }
          verificationDetail = `${matchedText}; ${responses.length} backend response(s) verified`;
        }
        if (VERIFY_MODE === "fullchain" && isAuthenticatedRow(row) && !row.dataVerification.startsWith("authenticated")) {
          const evidence = await expectFullchainEvidence(page, row);
          const pageData = await verifyFullchainPageData(page, row);
          verificationDetail = `${matchedText}; ${[evidence, pageData].filter(Boolean).join("; ")}`;
        }
        const screenshotRow = screenshotRows.find((item) => item.href === row.href);
        if (screenshotRow?.screenshotName) {
          await captureScreenshot(page, screenshotRow.screenshotName);
        }
        return verificationDetail;
      } finally {
        await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
        await page.close().catch(() => {});
      }
    });
  }

  for (const row of redirectRows) {
    await step(`redirect:${row.id}`, async () => {
      const context = contextForRow(row);
      const page = await createInstrumentedPage(context, row.href);
      try {
        await goto(page, row.href);
        await page.waitForURL(`**${row.redirectsTo}`, { timeout: 20000 });
      } finally {
        await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
        await page.close().catch(() => {});
      }
    });
  }

  await step("click:home-launch-console", async () => {
    const page = await createInstrumentedPage(publicContext, "/");
    try {
      await goto(page, "/");
      await page.getByRole("button", { name: /Launch Console/i }).click();
      await page.waitForURL("**/dashboard/overview", { timeout: 20000 });
    } finally {
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
      await page.close().catch(() => {});
    }
  });

  await step("click:home-developer-resources", async () => {
    const page = await createInstrumentedPage(publicContext, "/");
    try {
      await goto(page, "/");
      await page.getByRole("button", { name: /Open Developer Resources/i }).click();
      await page.waitForURL("**/dashboard/developer", { timeout: 20000 });
    } finally {
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
      await page.close().catch(() => {});
    }
  });

  await step("click:docs-concepts-settlement-anchor", async () => {
    const page = await createInstrumentedPage(publicContext, "/docs/concepts");
    try {
      await goto(page, "/docs/concepts#idempotency");
      await page.getByTestId("docs-sidebar").getByRole("button", { name: /How Settlement Works/i }).click();
      await page.waitForURL("**/docs/concepts#settlement", { timeout: 20000 });
    } finally {
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
      await page.close().catch(() => {});
    }
  });

  await step("ui:marketplace-controls", async () => {
    const page = await createInstrumentedPage(publicContext, "/marketplace");
    try {
      await verifyMarketplaceControls(page);
    } finally {
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
      await page.close().catch(() => {});
    }
  });

  if (consoleErrors.length > 0) {
    fail("browser:console-errors", consoleErrors.join("\n"));
  } else {
    pass("browser:console-errors", "no uncaught console errors");
  }
} finally {
  await browser.close();
}

const report = {
  baseUrl: BASE_URL,
  generatedAt: new Date().toISOString(),
  mode: VERIFY_MODE,
  verifyRealBackend: VERIFY_REAL_BACKEND,
  effectiveRealBackend: EFFECTIVE_REAL_BACKEND,
  gatewayHealthUrl: GATEWAY_HEALTH_URL,
  fullchainFixture: fullchainFixture
    ? {
        path: path.relative(ROOT, FULLCHAIN_FIXTURE_PATH),
        runId: fullchainFixture.runId,
        serviceCount: fixtureServices().length,
        serviceIds: fixtureServices().map((service) => service.id),
        credentialId: fullchainFixture.credential?.id,
        invocationCount: fixtureInvocations().length,
        firstInvocationId: fixtureInvocations()[0]?.invocationId,
        lastInvocationId: fixtureInvocations()[fixtureInvocations().length - 1]?.invocationId,
        depositTxHash: fullchainFixture.deposit?.txHash,
        totalConsumerChargeUsdc: fullchainFixture.reconciliation?.totalConsumerChargeUsdc,
        totalPlatformFeeUsdc: fullchainFixture.reconciliation?.totalPlatformFeeUsdc,
        totalProviderNetUsdc: fullchainFixture.reconciliation?.totalProviderNetUsdc,
      }
    : null,
  passed,
  failed,
  blocked,
  warnings,
  screenshots,
  consoleErrors,
  backendResponses,
};

fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));

const reportLines = [
  "# User Front Pages Browser Verification",
  "",
  `- Base URL: ${BASE_URL}`,
  `- Generated at: ${report.generatedAt}`,
  `- Mode: ${VERIFY_MODE}`,
  `- Real backend enforced: ${EFFECTIVE_REAL_BACKEND ? "yes" : "no"}`,
  ...(report.fullchainFixture
    ? [
        `- Fixture: ${report.fullchainFixture.path}`,
        `- Run ID: ${report.fullchainFixture.runId}`,
        `- Seeded services: ${report.fullchainFixture.serviceIds.join(", ")}`,
        `- Invocation count: ${report.fullchainFixture.invocationCount}`,
        `- First invocation ID: ${report.fullchainFixture.firstInvocationId}`,
        `- Last invocation ID: ${report.fullchainFixture.lastInvocationId}`,
        `- Total consumer charge: ${report.fullchainFixture.totalConsumerChargeUsdc} USDC`,
        `- Total platform fee: ${report.fullchainFixture.totalPlatformFeeUsdc} USDC`,
        `- Total provider net: ${report.fullchainFixture.totalProviderNetUsdc} USDC`,
        `- Deposit tx: ${report.fullchainFixture.depositTxHash}`,
      ]
    : []),
  `- Passed: ${passed.length}`,
  `- Failed: ${failed.length}`,
  `- Blocked: ${blocked.length}`,
  `- Warnings: ${warnings.length}`,
  "",
  "## Passed",
  "",
  ...passed.map((item) => `- PASS ${item.name}${item.detail ? ` - ${item.detail}` : ""}`),
  "",
  "## Failed",
  "",
  ...(failed.length === 0 ? ["- None"] : failed.map((item) => `- FAIL ${item.name} - ${item.detail}`)),
  "",
  "## Blocked",
  "",
  ...(blocked.length === 0 ? ["- None"] : blocked.map((item) => `- BLOCKED ${item.name} - ${item.detail}`)),
  "",
  "## Warnings",
  "",
  ...(warnings.length === 0 ? ["- None"] : warnings.map((item) => `- WARN ${item.name} - ${item.detail}`)),
  "",
  "## Screenshots",
  "",
  ...screenshots.map((item) => `- ${path.relative(ROOT, item)}`),
  "",
  "## Backend Responses",
  "",
  ...backendResponses.map((item) => `- ${item.status} ${item.url} (page: ${item.page || "unknown"})`),
  "",
];

fs.writeFileSync(path.join(OUT_DIR, "report.md"), reportLines.join("\n"));

console.log(`\nReport: ${path.join(OUT_DIR, "report.md")}`);

if (failed.length > 0 || (VERIFY_MODE === "fullchain" && blocked.length > 0)) {
  process.exit(1);
}
