#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const RUN_ID = process.env.ADMIN_ANALYTICS_LOAD_RUN_ID || `aal-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
const OUT_DIR = path.resolve(ROOT, process.env.ADMIN_ANALYTICS_LOAD_OUTPUT_DIR || `output/analytics-load/${RUN_ID}`);
const FIXTURE_PATH = path.resolve(process.env.ADMIN_ANALYTICS_LOAD_FIXTURE || path.join(OUT_DIR, "fixture.json"));

const GATEWAY_BASE_URL = (process.env.GATEWAY_BASE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const API_BASE = `${GATEWAY_BASE_URL}/api`;
const RPC_URL = process.env.ADMIN_ANALYTICS_RPC_URL || "http://127.0.0.1:8545";
const CLICKHOUSE_URL = (process.env.ANALYTICS_CLICKHOUSE_URL || "http://127.0.0.1:8123").replace(/\/+$/, "");
const CHAIN_ID = Number.parseInt(process.env.CHAIN_ID || "31337", 10);
const TOTAL_CALLS = Number.parseInt(process.env.ADMIN_ANALYTICS_LOAD_TOTAL || "10000", 10);
const CONCURRENCY = Number.parseInt(process.env.ADMIN_ANALYTICS_LOAD_CONCURRENCY || "32", 10);
const PER_SERVICE_CONCURRENCY = Number.parseInt(process.env.ADMIN_ANALYTICS_LOAD_PER_SERVICE_CONCURRENCY || "1", 10);
const MOCK_PORT_BASE = Number.parseInt(process.env.ADMIN_ANALYTICS_LOAD_MOCK_PORT || "20876", 10);
const DEPOSIT_USDC = process.env.ADMIN_ANALYTICS_LOAD_DEPOSIT_USDC || "10000.000000";
const CONSUMER_ETH_TARGET = process.env.ADMIN_ANALYTICS_LOAD_CONSUMER_ETH || "10.0";
const LOAD_TIMEOUT_MS = Number.parseInt(process.env.ADMIN_ANALYTICS_LOAD_TIMEOUT_MS || "30000", 10);
const WAIT_CLICKHOUSE_TIMEOUT_SEC = Number.parseInt(process.env.ADMIN_ANALYTICS_LOAD_CH_TIMEOUT_SEC || "180", 10);
const FORCE_PROBE_KEEPALIVE_SEC = Number.parseInt(process.env.ADMIN_ANALYTICS_LOAD_FORCE_PROBE_KEEPALIVE_SEC || "45", 10);

const DEFAULT_KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  consumer: "0x7c852118294f1a460a80c7c33d7409ea91c8436518e91e202d1f5f9e3544eb07",
  provider: "0x47e179ec197488bf6f785afa0fc15f4dee1a74f3f44fffedce27f84d349a926a",
};

const DEPLOYER_KEY = process.env.DEPLOYER_KEY || DEFAULT_KEYS.deployer;
const CONSUMER_KEY = process.env.CONSUMER_KEY || DEFAULT_KEYS.consumer;
const PROVIDER_KEY = process.env.PROVIDER_KEY || DEFAULT_KEYS.provider;

const SERVICE_SPECS = [
  { slug: "tenk-echo-lite", label: "10k Echo Lite", priceUsdc: "0.100000", port: MOCK_PORT_BASE },
  { slug: "tenk-echo-core", label: "10k Echo Core", priceUsdc: "1.000000", port: MOCK_PORT_BASE + 1 },
  { slug: "tenk-echo-pro", label: "10k Echo Pro", priceUsdc: "1.500000", port: MOCK_PORT_BASE + 2 },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const forceProbeLastRunAt = new Map();
const forceProbeInFlight = new Map();

function log(message) {
  console.log(`[analytics-10k] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function readDotenv(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return Object.fromEntries(
      content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
        })
    );
  } catch {
    return {};
  }
}

function localGatewayEnv() {
  return readDotenv(path.join(ROOT, "services/gateway/.env.local"));
}

function internalGatewayConfig() {
  const localEnv = localGatewayEnv();
  return {
    jwtSecret: process.env.GATEWAY_INTERNAL_JWT_SECRET || localEnv.GATEWAY_INTERNAL_JWT_SECRET || "",
    issuer: process.env.GATEWAY_INTERNAL_TOKEN_ISSUER || localEnv.GATEWAY_INTERNAL_TOKEN_ISSUER || "gateway-admin",
    audience: process.env.GATEWAY_INTERNAL_TOKEN_AUDIENCE || localEnv.GATEWAY_INTERNAL_TOKEN_AUDIENCE || "gateway-internal",
    subject: process.env.GATEWAY_INTERNAL_SERVICE_SUBJECT || localEnv.GATEWAY_INTERNAL_SERVICE_SUBJECT || "service:gateway-admin",
    adminWallet: process.env.GATEWAY_INTERNAL_ADMIN_WALLET || "0xA0f67a47D9eF18183Cd113eD85A654E2772c5901",
  };
}

function gatewayAnalyticsConfig() {
  const localEnv = localGatewayEnv();
  return {
    environment: process.env.ENVIRONMENT || localEnv.ENVIRONMENT || "local",
    kafkaBootstrapServers: process.env.ANALYTICS_KAFKA_BOOTSTRAP_SERVERS || localEnv.ANALYTICS_KAFKA_BOOTSTRAP_SERVERS || "",
    fallbackFile: path.resolve(
      ROOT,
      process.env.ANALYTICS_FALLBACK_FILE
        || localEnv.ANALYTICS_FALLBACK_FILE
        || "services/gateway/logs/analytics_events.jsonl",
    ),
  };
}

function shouldImportGatewayFallbackEvents() {
  const flag = String(process.env.ADMIN_ANALYTICS_LOAD_IMPORT_GATEWAY_FILE_EVENTS || "auto").toLowerCase();
  if (["1", "true", "yes"].includes(flag)) {
    return true;
  }
  if (["0", "false", "no"].includes(flag)) {
    return false;
  }
  const config = gatewayAnalyticsConfig();
  return config.environment === "local" || !config.kafkaBootstrapServers;
}

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function buildInternalGatewayToken({ scope, requestId, bodySha256 }) {
  const config = internalGatewayConfig();
  if (!config.jwtSecret) {
    return "";
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: config.issuer,
    aud: config.audience,
    sub: config.subject,
    adminWallet: config.adminWallet,
    scope,
    requestId,
    bodySha256,
    actorAdminId: "admin-analytics-10k-dogfood",
    actorRole: "super_admin",
    iat: now,
    exp: now + 120,
    jti: randomUUID().replace(/-/g, ""),
  };
  const encoded = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", config.jwtSecret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function payloadDigest(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

function assertLocalOnly() {
  const usesDefaultKey = [DEPLOYER_KEY, CONSUMER_KEY, PROVIDER_KEY].some((key) =>
    Object.values(DEFAULT_KEYS).includes(key),
  );
  if (usesDefaultKey && CHAIN_ID !== 31337) {
    fail("Refusing to use default local test keys outside CHAIN_ID=31337.");
  }
  if (usesDefaultKey && (!isLocalUrl(RPC_URL) || !isLocalUrl(GATEWAY_BASE_URL))) {
    fail("Refusing to use default local test keys against non-localhost endpoints.");
  }
  if (!Number.isInteger(TOTAL_CALLS) || TOTAL_CALLS < 1) {
    fail("ADMIN_ANALYTICS_LOAD_TOTAL must be a positive integer.");
  }
  if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1 || CONCURRENCY > 256) {
    fail("ADMIN_ANALYTICS_LOAD_CONCURRENCY must be between 1 and 256.");
  }
  if (!Number.isInteger(PER_SERVICE_CONCURRENCY) || PER_SERVICE_CONCURRENCY < 1 || PER_SERVICE_CONCURRENCY > 64) {
    fail("ADMIN_ANALYTICS_LOAD_PER_SERVICE_CONCURRENCY must be between 1 and 64.");
  }
}

async function assertReachable(name, url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= (options.attempts || 3); attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
    try {
      const response = await fetch(url, { method: options.method || "GET", signal: controller.signal });
      if (!response.ok && !options.allowNonOk) {
        fail(`${name} not ready: ${response.status} ${response.statusText} at ${url}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < (options.attempts || 3)) {
        log(`${name} reachability retry ${attempt}: ${error.message}`);
        await sleep(1000);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  fail(`${name} not reachable at ${url}. ${lastError?.message || "unknown error"}`);
}

async function api(pathname, { method = "GET", token, address, body, headers = {}, timeoutMs = LOAD_TIMEOUT_MS } = {}) {
  const requestHeaders = { Accept: "application/json", ...headers };
  if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
  }
  if (token) {
    requestHeaders.Authorization = `Bearer ${token}`;
  }
  if (address) {
    requestHeaders["X-User-Address"] = address;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${pathname}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
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
      fail(`${method} ${pathname} failed: ${response.status} ${JSON.stringify(payload).slice(0, 1000)}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function decimalToAtomic(value, decimals = 6) {
  const normalized = String(value ?? "0").trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return 0n;
  }
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0").slice(0, decimals));
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

function moneyFromObject(object, keys, fallback = "0") {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) {
      return String(object[key]);
    }
  }
  return fallback;
}

function invocationDistribution(totalCalls = TOTAL_CALLS) {
  if (totalCalls === 10000) {
    return [4000, 3000, 3000];
  }
  const first = Math.floor(totalCalls * 0.4);
  const second = Math.floor(totalCalls * 0.3);
  return [first, second, totalCalls - first - second];
}

function summarizePlan(services, distribution) {
  const perService = {};
  let gmvAtomic = 0n;
  for (let i = 0; i < services.length; i += 1) {
    const service = services[i];
    const count = distribution[i] || 0;
    const unitAtomic = decimalToAtomic(service.priceUsdc);
    const grossAtomic = unitAtomic * BigInt(count);
    gmvAtomic += grossAtomic;
    perService[service.id || service.slug] = {
      serviceId: service.id || "",
      serviceSlug: service.slug,
      priceUsdc: service.priceUsdc,
      callCount: count,
      grossAtomic: grossAtomic.toString(),
      grossUsdc: atomicToDecimal(grossAtomic),
    };
  }
  return {
    totalCalls: distribution.reduce((sum, count) => sum + count, 0),
    distribution,
    expectedGmvAtomic: gmvAtomic.toString(),
    expectedGmvUsdc: atomicToDecimal(gmvAtomic),
    perService,
  };
}

async function clickhouseQuery(sql) {
  const response = await fetch(`${CLICKHOUSE_URL}/`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: `${sql.trim()}\nFORMAT JSONEachRow\n`,
  });
  const text = await response.text();
  if (!response.ok) {
    fail(`ClickHouse query failed: ${response.status} ${text.slice(0, 1000)}`);
  }
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function clickhouseExec(sql) {
  const response = await fetch(`${CLICKHOUSE_URL}/`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: sql.trim(),
  });
  const text = await response.text();
  if (!response.ok) {
    fail(`ClickHouse exec failed: ${response.status} ${text.slice(0, 1000)}`);
  }
}

function sqlString(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function rawWindowSnapshot() {
  const rows = await clickhouseQuery(`
    SELECT
      countIf(event_name = 'quote_generated') AS quoteGenerated,
      countIf(event_name = 'invoke_started') AS invokeStarted,
      countIf(event_name = 'invoke_completed') AS invokeCompleted,
      countIf(event_name = 'invoke_failed') AS invokeFailed,
      countIf(event_name = 'budget_blocked') AS budgetBlocked,
      countIf(event_name = 'risk_rule_triggered' AND lower(JSONExtractString(properties, 'severity')) IN ('critical','high')) AS criticalRiskEvents,
      countIf(event_name = 'provider_health_degraded') AS providerHealthDegraded,
      sumIf(JSONExtractFloat(properties, 'price_usdc'), event_name = 'invoke_completed') AS gmvUsdc,
      sumIf(JSONExtractFloat(properties, 'platform_fee_usdc'), event_name = 'provider_revenue_received') AS platformFeeUsdc,
      sumIf(JSONExtractFloat(properties, 'provider_net_usdc'), event_name = 'provider_revenue_received') AS providerNetUsdc,
      sumIf(JSONExtractFloat(properties, 'gross_usdc'), event_name = 'provider_revenue_received') AS providerGrossUsdc,
      sumIf(JSONExtractFloat(properties, 'amount_usdc'), event_name = 'deposit_completed') AS depositUsdc,
      countIf(event_name = 'deposit_failed') AS depositFailed,
      sumIf(JSONExtractFloat(properties, 'amount_usdc'), event_name = 'withdrawal_completed') AS withdrawalUsdc,
      countIf(event_name = 'withdrawal_failed') AS withdrawalFailed,
      sumIf(JSONExtractFloat(properties, 'amount_usdc'), event_name = 'refund_completed') AS refundUsdc,
      count() AS eventCount
    FROM synapse_analytics.events
    WHERE timestamp >= now() - INTERVAL 24 HOUR
  `);
  return rows[0] || {};
}

async function rawRunSnapshot({ serviceIds, runId }) {
  const serviceIdList = serviceIds.map((id) => `'${sqlString(id)}'`).join(",");
  const runIdSql = sqlString(runId);
  const rows = await clickhouseQuery(`
    SELECT
      event_name AS eventName,
      count() AS count,
      uniqExact(event_id) AS uniqueEventIds,
      sum(JSONExtractFloat(properties, 'price_usdc')) AS priceUsdc,
      sum(JSONExtractFloat(properties, 'gross_usdc')) AS grossUsdc,
      sum(JSONExtractFloat(properties, 'platform_fee_usdc')) AS platformFeeUsdc,
      sum(JSONExtractFloat(properties, 'provider_net_usdc')) AS providerNetUsdc,
      sum(JSONExtractFloat(properties, 'amount_usdc')) AS amountUsdc,
      countIf(startsWith(distinct_id, '0x') OR length(distinct_id) = 42) AS rawWalletDistinctIds
    FROM synapse_analytics.events
    WHERE timestamp >= now() - INTERVAL 24 HOUR
      AND (
        JSONExtractString(properties, 'e2e_marker') = '${runIdSql}'
        ${serviceIds.length ? `OR JSONExtractString(properties, 'service_id') IN (${serviceIdList})` : ""}
      )
    GROUP BY event_name
    ORDER BY event_name ASC
  `);
  return rows;
}

async function getChainContext() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== CHAIN_ID) {
    fail(`RPC chainId mismatch. Expected ${CHAIN_ID}, got ${chainId}.`);
  }
  const contractConfig = readJson("services/user-front/src/contract-config.json");
  return {
    provider,
    chainId,
    coreAddress: ethers.getAddress(contractConfig.SynapseCore),
    usdcAddress: ethers.getAddress(contractConfig.MockUSDC),
    coreAbi: readJson("services/user-front/src/SynapseCoreABI.json"),
    usdcAbi: readJson("services/user-front/src/MockUSDCABI.json"),
  };
}

async function sendWithRetry(label, makeTx, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await makeTx();
    } catch (error) {
      lastError = error;
      if (!/nonce|replacement|underpriced|already known/i.test(error.message || "")) {
        throw error;
      }
      log(`${label} retry ${i + 1}/${attempts}: ${error.message}`);
      await sleep(1000);
    }
  }
  throw lastError;
}

async function authenticate(privateKey, label) {
  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address;
  const challenge = await api(`/v1/auth/challenge?address=${encodeURIComponent(address)}`);
  const message = challenge.challenge || challenge.message;
  if (!message) {
    fail(`${label} auth challenge missing message`);
  }
  const signature = await wallet.signMessage(message);
  const verified = await api("/v1/auth/verify", {
    method: "POST",
    body: { wallet_address: address, message, signature },
  });
  const token = verified.access_token || verified.token || verified.accessToken;
  if (!token) {
    fail(`${label} auth verification did not return a token`);
  }
  log(`${label} authenticated as ${address}`);
  return { address, token, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
}

async function fundAndDeposit({ consumerAddress }) {
  const { provider, coreAbi, usdcAbi, usdcAddress, coreAddress } = await getChainContext();
  const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
  const consumer = new ethers.Wallet(CONSUMER_KEY, provider);
  const usdcDeployer = new ethers.Contract(usdcAddress, usdcAbi, deployer);
  const usdcConsumer = new ethers.Contract(usdcAddress, usdcAbi, consumer);
  const coreConsumer = new ethers.Contract(coreAddress, coreAbi, consumer);
  const decimals = Number(await usdcDeployer.decimals());
  const amountAtomic = ethers.parseUnits(DEPOSIT_USDC, decimals);

  const ethBalance = await provider.getBalance(consumerAddress);
  const targetEth = ethers.parseEther(CONSUMER_ETH_TARGET);
  if (ethBalance < targetEth) {
    const delta = targetEth - ethBalance;
    const tx = await sendWithRetry("eth-topup", async () => deployer.sendTransaction({ to: consumerAddress, value: delta }));
    await tx.wait();
    log(`consumer ETH top-up confirmed to target ${CONSUMER_ETH_TARGET} ETH`);
  }

  const mintTx = await sendWithRetry("mint-usdc", async () => usdcDeployer.mint(consumerAddress, amountAtomic));
  await mintTx.wait();
  log(`${DEPOSIT_USDC} MockUSDC minted for consumer`);

  const approveTx = await sendWithRetry("approve-usdc", async () => usdcConsumer.approve(coreAddress, amountAtomic));
  await approveTx.wait();

  const depositTx = await sendWithRetry("deposit", async () => coreConsumer.deposit(amountAtomic));
  const receipt = await depositTx.wait();
  if (receipt?.status !== 1) {
    fail(`deposit transaction failed: ${depositTx.hash}`);
  }
  log(`chain deposit confirmed: ${depositTx.hash}`);
  return { txHash: depositTx.hash, amountUsdc: DEPOSIT_USDC, decimals, coreAddress, usdcAddress };
}

async function registerDepositIntent({ token, address, txHash, amountUsdc }) {
  const payload = await api("/v1/balance/deposit/intent", {
    method: "POST",
    token,
    address,
    headers: { "X-Idempotency-Key": `analytics-10k-deposit-${txHash.replace(/^0x/, "").slice(0, 80)}` },
    body: { txHash, amountUsdc },
  });
  return payload;
}

async function confirmLocalDepositIntent({ token, address, depositIntent, txHash }) {
  const depositIntentId = depositIntent.intent?.id || depositIntent.id;
  if (!depositIntentId) {
    fail(`deposit intent response missing id: ${JSON.stringify(depositIntent).slice(0, 600)}`);
  }
  return api(`/v1/balance/deposit/intents/${encodeURIComponent(depositIntentId)}/confirm`, {
    method: "POST",
    token,
    address,
    body: { eventKey: `analytics-load:${String(txHash).toLowerCase()}`, confirmations: 1 },
  });
}

async function waitForBalanceAtLeast({ token, address, expectedUsdc, txHash }) {
  const expected = decimalToAtomic(expectedUsdc);
  let lastBalance = "0";
  for (let i = 0; i < 60; i += 1) {
    if (txHash) {
      await api(`/v1/balance/deposit/sync?txHash=${encodeURIComponent(String(txHash).toLowerCase())}`, {
        token,
        address,
      }).catch((error) => log(`deposit sync poll failed: ${error.message}`));
    }
    const payload = await api("/v1/balance", { token, address });
    const balance = payload.balance || {};
    lastBalance = String(balance.consumerAvailableBalance ?? balance.ownerBalance ?? "0");
    if (decimalToAtomic(lastBalance) >= expected) {
      log(`consumer gateway balance synced: ${lastBalance} USDC`);
      return payload;
    }
    await sleep(2000);
  }
  fail(`consumer balance did not reach ${expectedUsdc} USDC; last=${lastBalance}`);
}

async function ensureMockUpstream(spec) {
  const healthUrl = `http://127.0.0.1:${spec.port}/health`;
  const existing = await fetch(healthUrl).then((res) => res.ok).catch(() => false);
  if (existing) {
    log(`mock upstream ${spec.slug} already running on ${healthUrl}`);
    return { url: `http://127.0.0.1:${spec.port}`, pid: null, reused: true, slug: spec.slug };
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const logPath = path.join(OUT_DIR, `mock-upstream-${spec.slug}.log`);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--mock-upstream", String(spec.port), spec.slug], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", fs.openSync(logPath, "a"), fs.openSync(logPath, "a")],
  });
  child.unref();
  for (let i = 0; i < 30; i += 1) {
    if (await fetch(healthUrl).then((res) => res.ok).catch(() => false)) {
      log(`mock upstream ${spec.slug} started on ${healthUrl} (pid ${child.pid})`);
      return { url: `http://127.0.0.1:${spec.port}`, pid: child.pid, reused: false, slug: spec.slug };
    }
    await sleep(500);
  }
  fail(`mock upstream ${spec.slug} did not start; see ${logPath}`);
}

function startMockUpstream(port, slug = "echo") {
  const server = http.createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "healthy", runId: RUN_ID, slug }));
      return;
    }
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        parsed = { raw };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", runId: RUN_ID, service: `analytics-10k-${slug}`, echo: parsed, receivedAt: new Date().toISOString() }));
    });
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`[analytics-10k-mock] ${slug} listening on http://127.0.0.1:${port}`);
  });
}

function serviceIdForSpec(spec) {
  return `aal_${spec.slug.replace(/[^a-zA-Z0-9_]/g, "_")}_${RUN_ID.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

async function issueProviderSecret({ token, address }) {
  const payload = await api("/v1/secrets/provider/issue", {
    method: "POST",
    token,
    address,
    body: {
      name: `analytics-load-provider-secret-${RUN_ID}`,
      rpm: 20000,
      creditLimit: "50000",
      expiration: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    },
  });
  const secret = payload.secret || payload.credential || payload;
  return { id: secret.id || secret.credentialId || "", tokenPrefix: secret.tokenPrefix || secret.secretPrefix || "" };
}

async function registerService({ token, address, spec, mockUrl }) {
  const serviceId = serviceIdForSpec(spec);
  const serviceName = `Analytics Load ${spec.label} ${RUN_ID}`;
  const payload = {
    serviceName,
    agentToolName: serviceId,
    role: "Provider",
    pricing: { currency: "USDC", amount: spec.priceUsdc },
    summary: `Analytics 10k verification service ${spec.label}.`,
    tags: ["analytics-load", "verification", "echo", spec.slug],
    providerProfile: { displayName: "Analytics Load Provider" },
    payoutAccount: { payoutAddress: address, chainId: CHAIN_ID, settlementCurrency: "USDC", status: "active" },
    governance: { termsAccepted: true, riskAcknowledged: true, note: RUN_ID },
    healthCheck: { path: "/health", method: "GET", intervalSec: 15, timeoutMs: 5000, successCodes: [200] },
    constraints: { timeoutMs: 15000, maxResponseBytes: 500000, maxRequestBytes: 100000, maxQps: 200, maxConcurrency: 64 },
    forwarding: {
      requestIdHeader: "X-Synapse-Request-Id",
      passThroughHeaders: [],
      injectHeaders: {},
      retryPolicy: { maxAttempts: 1, backoffMs: 200, retryOnStatus: [429, 500, 502, 503, 504] },
    },
    metering: { billingUnit: "per_call", billOnError: false, billableStatusClasses: [2], requestIdRequired: true, responseSizeMetering: true },
    invoke: {
      method: "POST",
      targets: [{ url: mockUrl, weight: 100, region: "local" }],
      timeoutMs: 15000,
      request: {
        contentType: "application/json",
        schema: { type: "object", properties: { query: { type: "string" }, runId: { type: "string" }, callIndex: { type: "number" } }, required: ["query"] },
      },
      response: { schema: { type: "object", properties: { status: { type: "string" }, echo: { type: "object" } } } },
      headersTemplate: {},
      examples: [{ query: "analytics load", runId: RUN_ID, callIndex: 1 }],
    },
    isActive: true,
    status: "active",
  };
  const response = await api("/v1/services", { method: "POST", token, address, body: payload });
  const service = response.service || response;
  const createdServiceId = service.serviceId || response.serviceId || serviceId;
  log(`service registered: ${createdServiceId} (${spec.priceUsdc} USDC)`);
  return { id: createdServiceId, name: service.serviceName || serviceName, slug: spec.slug, label: spec.label, priceUsdc: spec.priceUsdc, mockUrl };
}

async function forceProbeService(serviceId, reason = "manual") {
  if (!serviceId) {
    return false;
  }
  const now = Date.now();
  const lastRunAt = Number(forceProbeLastRunAt.get(serviceId) || 0);
  if (now - lastRunAt < 10_000) {
    return false;
  }
  const inFlight = forceProbeInFlight.get(serviceId);
  if (inFlight) {
    await inFlight;
    return true;
  }
  const payload = {};
  const requestId = `analytics-10k-force-probe:${serviceId}:${randomUUID()}`;
  const token = buildInternalGatewayToken({
    scope: "provider_services.write",
    requestId,
    bodySha256: payloadDigest(payload),
  });
  if (!token) {
    return false;
  }
  const task = api(`/v1/admin/provider-services/${encodeURIComponent(serviceId)}/force-probe`, {
    method: "POST",
    timeoutMs: 15000,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Request-Id": requestId,
    },
    body: payload,
  })
    .then(() => {
      forceProbeLastRunAt.set(serviceId, Date.now());
      log(`force-probed service health for ${serviceId} (${reason})`);
      return true;
    })
    .catch((error) => {
      log(`force-probe skipped/failed for ${serviceId} (${reason}): ${error.message}`);
      return false;
    })
    .finally(() => {
      forceProbeInFlight.delete(serviceId);
    });
  forceProbeInFlight.set(serviceId, task);
  await task;
  return true;
}

async function forceProbeServices(services, reason) {
  await Promise.all(services.map((service) => forceProbeService(service.id, reason)));
}

function startForceProbeKeepalive(services) {
  if (!Number.isFinite(FORCE_PROBE_KEEPALIVE_SEC) || FORCE_PROBE_KEEPALIVE_SEC <= 0) {
    return null;
  }
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      return;
    }
    running = true;
    forceProbeServices(services, "keepalive")
      .catch((error) => log(`force-probe keepalive failed: ${error.message}`))
      .finally(() => {
        running = false;
      });
  }, FORCE_PROBE_KEEPALIVE_SEC * 1000);
  timer.unref?.();
  return timer;
}

async function waitForServiceDiscoverable(serviceId) {
  for (let i = 0; i < 80; i += 1) {
    const payload = await api(`/v1/services/discover?q=${encodeURIComponent(serviceId)}&pageSize=100`);
    const services = Array.isArray(payload.services) ? payload.services : [];
    const found = services.find((service) => [service.serviceId, service.service_id, service.agentToolName].includes(serviceId));
    if (found && found.isActive !== false && found.runtimeAvailable !== false) {
      log(`service discoverable and callable: ${serviceId}`);
      return found;
    }
    if (i > 0 && i % 5 === 0) {
      await forceProbeService(serviceId, "discoverability-wait");
    }
    await sleep(3000);
  }
  fail(`service was not discoverable/callable after health probes: ${serviceId}`);
}

async function issueAgentCredential({ token, address }) {
  const payload = await api("/v1/credentials/agent/issue", {
    method: "POST",
    token,
    address,
    body: {
      name: `analytics-load-agent-${RUN_ID}`,
      rpm: Math.max(20000, TOTAL_CALLS * 2),
      maxCalls: TOTAL_CALLS + 100,
      creditLimit: DEPOSIT_USDC,
      resetInterval: "daily",
    },
  });
  const credential = payload.credential || payload;
  const credentialToken = credential.token || credential.secretKey || credential.agentToken;
  if (!credential?.id || !credentialToken) {
    fail("agent credential issue response missing id or token");
  }
  log(`agent credential issued: ${credential.id}`);
  return { id: credential.id, token: credentialToken, tokenPrefix: credential.tokenPrefix || credential.secretPrefix || "", name: credential.name || `analytics-load-agent-${RUN_ID}` };
}

async function invokeService({ credentialToken, service, callIndex }) {
  const requestId = `aal-invoke-${RUN_ID}-${service.slug}-${String(callIndex).padStart(6, "0")}`;
  const started = Date.now();
  let response = null;
  let retryCount = 0;
  const maxRetries = Number.parseInt(process.env.ADMIN_ANALYTICS_LOAD_BUSY_RETRIES || "80", 10);
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      response = await api("/v1/gateway/generate", {
        method: "POST",
        timeoutMs: LOAD_TIMEOUT_MS,
        headers: { "X-Credential": credentialToken, "X-Service-Id": service.id, "X-Request-Id": requestId },
        body: { prompt: "Admin Analytics 10k verification invoke", payload: { query: `verify ${RUN_ID}`, runId: RUN_ID, serviceSlug: service.slug, callIndex } },
      });
      break;
    } catch (error) {
      const message = error.message || "";
      const retryable = /SERVICE_BUSY|SERVICE_CIRCUIT_OPEN|SERVICE_UNAVAILABLE|429|503/.test(message);
      if (!retryable || attempt >= maxRetries) {
        throw error;
      }
      if (/SERVICE_UNAVAILABLE|503/.test(message)) {
        await forceProbeService(service.id, "invoke-retry");
      }
      retryCount += 1;
      const backoffMs = Math.min(2500, 100 + attempt * 50 + Math.floor(Math.random() * 100));
      await sleep(backoffMs);
    }
  }
  if (!response) {
    fail(`invoke did not produce a response after retries: ${requestId}`);
  }
  const receipt = response.payload?.receipt || response.receipt || {};
  if (!receipt.invocationId) {
    fail(`invoke response missing invocationId: ${JSON.stringify(response).slice(0, 800)}`);
  }
  return {
    requestId,
    serviceId: service.id,
    serviceSlug: service.slug,
    invocationId: receipt.invocationId,
    quoteId: receipt.quoteId,
    priceUsdc: service.priceUsdc,
    totalChargeUsdc: moneyFromObject(receipt, ["totalCharge", "totalChargeUsdc", "chargedUsdc"], service.priceUsdc),
    serviceUnitPrice: moneyFromObject(receipt, ["serviceUnitPrice", "unitPrice"], service.priceUsdc),
    consumerAvailableBalanceAfter: moneyFromObject(receipt, ["consumerAvailableBalanceAfter"], "0"),
    latencyMs: Date.now() - started,
    retryCount,
  };
}

async function runBounded(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  let completed = 0;
  const startedAt = Date.now();
  async function next() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
      completed += 1;
      if (completed % 100 === 0 || completed === items.length) {
        const elapsedSec = Math.max((Date.now() - startedAt) / 1000, 1);
        log(`invoked ${completed}/${items.length} calls (${Math.round(completed / elapsedSec)} rps observed)`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
  return results;
}

function buildInvocationPlan(services, distribution) {
  const plan = [];
  let callIndex = 0;
  for (let serviceIndex = 0; serviceIndex < services.length; serviceIndex += 1) {
    const service = services[serviceIndex];
    const count = distribution[serviceIndex] || 0;
    for (let i = 0; i < count; i += 1) {
      callIndex += 1;
      plan.push({ service, callIndex });
    }
  }
  return plan;
}

function buildInvocationGroups(services, distribution) {
  return services.map((service, serviceIndex) => {
    const count = distribution[serviceIndex] || 0;
    const items = [];
    const priorCount = distribution.slice(0, serviceIndex).reduce((sum, value) => sum + value, 0);
    for (let i = 0; i < count; i += 1) {
      items.push({ service, callIndex: priorCount + i + 1 });
    }
    return { service, items };
  });
}

async function invokeServiceGroups({ credentialToken, services, distribution }) {
  const groups = buildInvocationGroups(services, distribution);
  let completed = 0;
  const startedAt = Date.now();
  const results = await Promise.all(groups.map(async ({ service, items }) => {
    const serviceResults = await runBounded(items, Math.min(PER_SERVICE_CONCURRENCY, CONCURRENCY), async (item) => {
      const receipt = await invokeService({ credentialToken, service: item.service, callIndex: item.callIndex });
      completed += 1;
      if (completed % 100 === 0 || completed === TOTAL_CALLS) {
        const elapsedSec = Math.max((Date.now() - startedAt) / 1000, 1);
        log(`invoked ${completed}/${TOTAL_CALLS} calls (${Math.round(completed / elapsedSec)} rps observed)`);
      }
      return receipt;
    });
    return serviceResults;
  }));
  return results.flat();
}

function summarizeReceipts(receipts) {
  const perService = {};
  let totalChargeAtomic = 0n;
  let retryCount = 0;
  for (const receipt of receipts) {
    const totalChargeAtomicForReceipt = decimalToAtomic(receipt.totalChargeUsdc || receipt.priceUsdc);
    totalChargeAtomic += totalChargeAtomicForReceipt;
    retryCount += Number.parseInt(String(receipt.retryCount || "0"), 10) || 0;
    const bucket = perService[receipt.serviceId] || {
      serviceId: receipt.serviceId,
      serviceSlug: receipt.serviceSlug,
      priceUsdc: receipt.priceUsdc,
      callCount: 0,
      totalChargeAtomic: "0",
      totalChargeUsdc: "0.000000",
    };
    bucket.callCount += 1;
    bucket.totalChargeAtomic = (BigInt(bucket.totalChargeAtomic) + totalChargeAtomicForReceipt).toString();
    bucket.totalChargeUsdc = atomicToDecimal(bucket.totalChargeAtomic);
    perService[receipt.serviceId] = bucket;
  }
  return {
    totalReceipts: receipts.length,
    totalChargeAtomic: totalChargeAtomic.toString(),
    totalChargeUsdc: atomicToDecimal(totalChargeAtomic),
    retryCount,
    perService,
  };
}

function analyticsRow(eventName, distinctId, { source, role, surface, correlationId, properties }) {
  const payload = {
    role,
    surface,
    env: process.env.ENVIRONMENT || "local",
    e2e_marker: RUN_ID,
    correlation_id: correlationId,
    ...properties,
  };
  return {
    event_id: randomUUID(),
    event_name: eventName,
    timestamp: new Date().toISOString().replace("T", " ").replace("Z", "").slice(0, 23),
    distinct_id: distinctId,
    source,
    role,
    surface,
    env: payload.env,
    correlation_id: correlationId,
    properties: JSON.stringify(payload),
  };
}

function clickhouseTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().replace("T", " ").replace("Z", "").slice(0, 23);
  }
  return date.toISOString().replace("T", " ").replace("Z", "").slice(0, 23);
}

function gatewayFallbackEventMatches(event, serviceIds) {
  const props = event?.properties && typeof event.properties === "object" ? event.properties : {};
  const correlationId = String(props.correlation_id || event?.correlation_id || "");
  const serviceId = String(props.service_id || "");
  return correlationId.includes(RUN_ID) || serviceIds.includes(serviceId);
}

function gatewayFallbackEventToClickHouseRow(event) {
  const props = event?.properties && typeof event.properties === "object" ? { ...event.properties } : {};
  props.e2e_marker = props.e2e_marker || RUN_ID;
  props.correlation_id = props.correlation_id || event.correlation_id || "";
  const role = String(props.role || event.role || "consumer");
  const surface = String(props.surface || event.surface || "gateway_api");
  const env = String(props.env || event.env || gatewayAnalyticsConfig().environment || "local");
  return {
    event_id: String(event.event_id || randomUUID()),
    event_name: String(event.event_name || ""),
    timestamp: clickhouseTimestamp(event.timestamp),
    distinct_id: String(event.distinct_id || ""),
    source: String(event.source || "gateway"),
    role,
    surface,
    env,
    correlation_id: String(props.correlation_id || ""),
    properties: JSON.stringify({ ...props, role, surface, env }),
  };
}

async function importGatewayFallbackEventsToClickHouse({ serviceIds }) {
  if (!shouldImportGatewayFallbackEvents()) {
    return { imported: 0, fallbackFile: "", mode: "disabled" };
  }
  const config = gatewayAnalyticsConfig();
  if (!fs.existsSync(config.fallbackFile)) {
    log(`gateway analytics fallback file not found, skipping local import: ${config.fallbackFile}`);
    return { imported: 0, fallbackFile: config.fallbackFile, mode: "file_missing" };
  }
  const rows = [];
  const seen = new Set();
  const content = fs.readFileSync(config.fallbackFile, "utf8");
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!gatewayFallbackEventMatches(event, serviceIds)) {
      continue;
    }
    const row = gatewayFallbackEventToClickHouseRow(event);
    if (!row.event_name || seen.has(row.event_id)) {
      continue;
    }
    seen.add(row.event_id);
    rows.push(row);
  }
  if (!rows.length) {
    return { imported: 0, fallbackFile: config.fallbackFile, mode: "no_matching_events" };
  }
  await clickhouseExec(
    "INSERT INTO synapse_analytics.events (event_id,event_name,timestamp,distinct_id,source,role,surface,env,correlation_id,properties) FORMAT JSONEachRow\n"
      + rows.map((row) => JSON.stringify(row)).join("\n"),
  );
  log(`imported ${rows.length} real Gateway fallback-file events into ClickHouse for local dogfood`);
  return { imported: rows.length, fallbackFile: config.fallbackFile, mode: "local_file_bridge" };
}

async function insertSupplementalEvents({ consumerHash, providerHash, services, depositTxHash }) {
  const service = services[0];
  const rows = [
    analyticsRow("page_viewed", consumerHash, { source: "frontend", role: "consumer", surface: "analytics_10k_load", correlationId: `${RUN_ID}:page_viewed`, properties: { page_path: "/" } }),
    analyticsRow("wallet_connected", consumerHash, { source: "frontend", role: "consumer", surface: "analytics_10k_load", correlationId: `${RUN_ID}:wallet_connected`, properties: { wallet_type: "local_e2e" } }),
    analyticsRow("consumer_signup_completed", consumerHash, { source: "frontend", role: "consumer", surface: "analytics_10k_load", correlationId: `${RUN_ID}:consumer_signup_completed`, properties: { signup_method: "wallet" } }),
    analyticsRow("provider_signup_completed", providerHash, { source: "frontend", role: "provider", surface: "analytics_10k_load", correlationId: `${RUN_ID}:provider_signup_completed`, properties: { signup_method: "wallet" } }),
    analyticsRow("deposit_completed", consumerHash, { source: "gateway", role: "consumer", surface: "deposit_indexer", correlationId: `${RUN_ID}:deposit_completed`, properties: { amount_usdc: DEPOSIT_USDC, token_symbol: "USDC", tx_hash: depositTxHash, time_to_confirm_ms: 91000 } }),
    analyticsRow("invoke_failed", consumerHash, { source: "gateway", role: "consumer", surface: "agent_invoke", correlationId: `${RUN_ID}:invoke_failed`, properties: { service_id: service.id, provider_id: providerHash, quote_id: `quote_${RUN_ID}_failed`, error_code: "UPSTREAM_TIMEOUT", failure_stage: "upstream" } }),
    analyticsRow("budget_blocked", consumerHash, { source: "gateway", role: "consumer", surface: "agent_invoke", correlationId: `${RUN_ID}:budget_blocked`, properties: { service_id: service.id, required_usdc: "12.500000", available_usdc: "2.000000", error_code: "OWNER_BILLING_CYCLE_LIMIT_EXCEEDED" } }),
    analyticsRow("deposit_failed", consumerHash, { source: "gateway", role: "consumer", surface: "deposit_repair", correlationId: `${RUN_ID}:deposit_failed`, properties: { amount_usdc: "25.000000", error_code: "INVALID_INTENT", tx_hash: `0x${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}` } }),
    analyticsRow("withdrawal_completed", consumerHash, { source: "gateway", role: "consumer", surface: "consumer_withdraw", correlationId: `${RUN_ID}:withdrawal_completed`, properties: { amount_usdc: "3.500000", tx_hash: `0x${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`, time_to_confirm_ms: 118000 } }),
    analyticsRow("withdrawal_failed", consumerHash, { source: "gateway", role: "consumer", surface: "consumer_withdraw", correlationId: `${RUN_ID}:withdrawal_failed`, properties: { amount_usdc: "1.250000", error_code: "USER_REJECTED_SIGNATURE" } }),
    analyticsRow("refund_completed", consumerHash, { source: "gateway", role: "consumer", surface: "refund", correlationId: `${RUN_ID}:refund_completed`, properties: { amount_usdc: "0.750000", reason_code: "UPSTREAM_TIMEOUT", service_id: service.id } }),
    analyticsRow("risk_rule_triggered", consumerHash, { source: "gateway", role: "consumer", surface: "agent_invoke", correlationId: `${RUN_ID}:risk_rule_triggered`, properties: { rule_code: "BUDGET_GAP_SPIKE", severity: "high" } }),
    analyticsRow("provider_health_degraded", providerHash, { source: "gateway", role: "provider", surface: "service_health_monitor", correlationId: `${RUN_ID}:provider_health_degraded`, properties: { provider_id: providerHash, service_id: service.id, healthy_targets: 0, total_targets: 1, overall_status: "unhealthy", reason: "analytics 10k fixture timeout" } }),
    analyticsRow("provider_first_revenue_received", providerHash, { source: "gateway", role: "provider", surface: "agent_invoke", correlationId: `${RUN_ID}:provider_first_revenue_received`, properties: { provider_id: providerHash, service_id: service.id, gross_usdc: "0.100000", time_since_listing_ms: 42000, is_first_revenue: true } }),
    analyticsRow("settlement_claim_requested", providerHash, { source: "gateway", role: "provider", surface: "provider_settlement", correlationId: `${RUN_ID}:settlement_claim_requested`, properties: { provider_id: providerHash, claim_usdc: "10.000000" } }),
    analyticsRow("settlement_claim_completed", providerHash, { source: "gateway", role: "provider", surface: "provider_settlement", correlationId: `${RUN_ID}:settlement_claim_completed`, properties: { provider_id: providerHash, claim_usdc: "7.500000", tx_hash: `0x${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`, time_to_confirm_ms: 98000 } }),
    analyticsRow("settlement_claim_failed", providerHash, { source: "gateway", role: "provider", surface: "provider_settlement", correlationId: `${RUN_ID}:settlement_claim_failed`, properties: { provider_id: providerHash, claim_usdc: "2.500000", error_code: "RPC_TIMEOUT" } }),
  ];
  await clickhouseExec(
    "INSERT INTO synapse_analytics.events (event_id,event_name,timestamp,distinct_id,source,role,surface,env,correlation_id,properties) FORMAT JSONEachRow\n"
      + rows.map((row) => JSON.stringify(row)).join("\n"),
  );
  log(`inserted ${rows.length} deterministic supplemental ClickHouse events`);
  return rows.map((row) => row.event_name);
}

async function sha256Hex(value) {
  return createHash("sha256").update(String(value).toLowerCase()).digest("hex");
}

async function waitForCoreEvents({ serviceIds }) {
  const deadline = Date.now() + WAIT_CLICKHOUSE_TIMEOUT_SEC * 1000;
  let lastRows = [];
  while (Date.now() < deadline) {
    lastRows = await rawRunSnapshot({ serviceIds, runId: RUN_ID });
    const byName = Object.fromEntries(lastRows.map((row) => [row.eventName, Number(row.count || 0)]));
    if ((byName.invoke_completed || 0) >= TOTAL_CALLS && (byName.provider_revenue_received || 0) >= TOTAL_CALLS) {
      return lastRows;
    }
    log(`waiting for ClickHouse core events: invoke_completed=${byName.invoke_completed || 0}/${TOTAL_CALLS}, provider_revenue_received=${byName.provider_revenue_received || 0}/${TOTAL_CALLS}`);
    await sleep(5000);
  }
  return lastRows;
}

async function main() {
  if (process.argv[2] === "--mock-upstream") {
    startMockUpstream(Number.parseInt(process.argv[3] || "20876", 10), process.argv[4] || "echo");
    return;
  }

  assertLocalOnly();
  await assertReachable("gateway health", `${GATEWAY_BASE_URL}/health`);
  await assertReachable("rpc", RPC_URL, { method: "POST", allowNonOk: true });
  await assertReachable("clickhouse", `${CLICKHOUSE_URL}/`, { method: "POST", allowNonOk: true });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const baselineClickHouse24h = await rawWindowSnapshot();
  log(`captured ClickHouse baseline with invoke_completed=${baselineClickHouse24h.invokeCompleted || 0}`);

  const mocks = [];
  for (const spec of SERVICE_SPECS) {
    mocks.push(await ensureMockUpstream(spec));
  }

  const providerAuth = await authenticate(PROVIDER_KEY, "provider");
  const consumerAuth = await authenticate(CONSUMER_KEY, "consumer");
  const chain = await getChainContext();
  const providerSecret = await issueProviderSecret(providerAuth);

  const services = [];
  for (let i = 0; i < SERVICE_SPECS.length; i += 1) {
    const service = await registerService({ ...providerAuth, spec: SERVICE_SPECS[i], mockUrl: mocks[i].url });
    await forceProbeService(service.id, "post-register");
    const discovered = await waitForServiceDiscoverable(service.id);
    services.push({ ...service, discoveredRuntimeAvailable: discovered.runtimeAvailable ?? true });
  }

  const deposit = await fundAndDeposit({ consumerAddress: consumerAuth.address });
  const depositIntent = await registerDepositIntent({ ...consumerAuth, txHash: deposit.txHash, amountUsdc: deposit.amountUsdc });
  const confirmedDeposit = await confirmLocalDepositIntent({ ...consumerAuth, depositIntent, txHash: deposit.txHash });
  const balanceBeforeInvoke = await waitForBalanceAtLeast({ ...consumerAuth, expectedUsdc: DEPOSIT_USDC, txHash: deposit.txHash });
  const credential = await issueAgentCredential(consumerAuth);

  const distribution = invocationDistribution(TOTAL_CALLS);
  const expectedPlan = summarizePlan(services, distribution);
  log(`starting ${expectedPlan.totalCalls} invokes with concurrency=${CONCURRENCY}, expected GMV=${expectedPlan.expectedGmvUsdc} USDC`);
  const healthKeepalive = startForceProbeKeepalive(services);
  let invocations;
  try {
    await forceProbeServices(services, "pre-load");
    invocations = await invokeServiceGroups({ credentialToken: credential.token, services, distribution });
  } finally {
    if (healthKeepalive) {
      clearInterval(healthKeepalive);
    }
  }
  const receiptSummary = summarizeReceipts(invocations);

  const consumerHash = await sha256Hex(consumerAuth.address);
  const providerHash = await sha256Hex(providerAuth.address);
  const supplementalEvents = await insertSupplementalEvents({
    consumerHash,
    providerHash,
    services,
    depositTxHash: deposit.txHash,
  });
  const gatewayFallbackImport = await importGatewayFallbackEventsToClickHouse({
    serviceIds: services.map((service) => service.id),
  });
  const rawRunRows = await waitForCoreEvents({ serviceIds: services.map((service) => service.id) });
  const balanceAfterInvoke = await api("/v1/balance", consumerAuth);

  const fixture = {
    version: 1,
    mode: "admin-analytics-10k-load",
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    outputDir: OUT_DIR,
    baselineClickHouse24h,
    load: {
      totalCalls: TOTAL_CALLS,
      concurrency: CONCURRENCY,
      perServiceConcurrency: PER_SERVICE_CONCURRENCY,
      distribution,
      expectedGmvUsdc: expectedPlan.expectedGmvUsdc,
      expectedGmvAtomic: expectedPlan.expectedGmvAtomic,
      expectedPerService: expectedPlan.perService,
    },
    baseUrls: {
      gateway: GATEWAY_BASE_URL,
      rpc: RPC_URL,
      clickhouse: CLICKHOUSE_URL,
      gatewayAnalyticsFallbackImport: gatewayFallbackImport,
      mockUpstreams: mocks.map((mock) => ({ slug: mock.slug, url: mock.url, pid: mock.pid, reused: mock.reused })),
    },
    chain: {
      chainId: chain.chainId,
      synapseCore: chain.coreAddress,
      mockUSDC: chain.usdcAddress,
      depositTxHash: deposit.txHash,
    },
    consumer: { address: consumerAuth.address, token: consumerAuth.token, expiresAt: consumerAuth.expiresAt },
    provider: { address: providerAuth.address, token: providerAuth.token, expiresAt: providerAuth.expiresAt },
    providerSecret,
    services,
    credential: { id: credential.id, name: credential.name, token: credential.token, tokenPrefix: credential.tokenPrefix },
    deposit: {
      txHash: deposit.txHash,
      amountUsdc: deposit.amountUsdc,
      intentId: depositIntent.intent?.id || depositIntent.id || null,
      confirmedIntentId: confirmedDeposit.intent?.id || confirmedDeposit.id || null,
    },
    invocations: {
      total: invocations.length,
      sample: invocations.slice(0, 25),
      firstInvocationId: invocations[0]?.invocationId || null,
      lastInvocationId: invocations[invocations.length - 1]?.invocationId || null,
    },
    receiptSummary,
    supplementalEvents,
    rawRunRows,
    balanceBeforeInvoke: balanceBeforeInvoke.balance || balanceBeforeInvoke,
    balanceAfterInvoke: balanceAfterInvoke.balance || balanceAfterInvoke,
  };
  fs.writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2));
  log(`fixture written: ${path.relative(ROOT, FIXTURE_PATH)}`);

  const byName = Object.fromEntries(rawRunRows.map((row) => [row.eventName, Number(row.count || 0)]));
  if ((byName.invoke_completed || 0) < TOTAL_CALLS || (byName.provider_revenue_received || 0) < TOTAL_CALLS) {
    fail(`ClickHouse did not receive required core events for ${RUN_ID}: ${JSON.stringify(byName)}`);
  }
  log("10k fullchain completed successfully");
}

main().catch((error) => {
  console.error(`[analytics-10k] fatal: ${error.stack || error.message || String(error)}`);
  process.exit(1);
});
