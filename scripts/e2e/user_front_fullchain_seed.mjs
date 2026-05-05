#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.join(ROOT, "tmp/user-front-fullchain");
const FIXTURE_PATH = process.env.USER_FRONT_FULLCHAIN_FIXTURE
  ? path.resolve(process.env.USER_FRONT_FULLCHAIN_FIXTURE)
  : path.join(OUT_DIR, "fixture.json");
const FRONTEND_URL = (
  process.env.USER_FRONT_BASE_URL || "http://127.0.0.1:3000"
).replace(/\/+$/, "");
const GATEWAY_BASE_URL = (
  process.env.USER_FRONT_GATEWAY_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const API_BASE = `${GATEWAY_BASE_URL}/api`;
const RPC_URL = process.env.USER_FRONT_RPC_URL || "http://127.0.0.1:8545";
const CHAIN_ID = Number.parseInt(process.env.CHAIN_ID || "31337", 10);
const DEPOSIT_USDC = process.env.USER_FRONT_FULLCHAIN_DEPOSIT_USDC || "1000.00";
const CONSUMER_ETH_TARGET =
  process.env.USER_FRONT_FULLCHAIN_CONSUMER_ETH || "10.0";
const INVOCATION_DISTRIBUTION = [34, 33, 33];
const RUN_ID =
  process.env.USER_FRONT_FULLCHAIN_RUN_ID ||
  `ufc-${new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14)}`;

const CANONICAL_SERVICE_IDS = (
  process.env.USER_FRONT_FULLCHAIN_SERVICE_IDS ||
  "svc_synapse_mock_cost_1usdc,svc_web3_sentiment_index,svc_protocol_fundamental_brief"
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const DEFAULT_KEYS = {
  deployer:
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  consumer:
    "0x7c852118294f1a460a80c7c33d7409ea91c8436518e91e202d1f5f9e3544eb07",
  provider:
    "0x47e179ec197488bf6f785afa0fc15f4dee1a74f3f44fffedce27f84d349a926a",
};

const DEPLOYER_KEY = process.env.DEPLOYER_KEY || DEFAULT_KEYS.deployer;
const CONSUMER_KEY = process.env.CONSUMER_KEY || DEFAULT_KEYS.consumer;
const PROVIDER_KEY = process.env.PROVIDER_KEY || DEFAULT_KEYS.provider;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(message) {
  console.log(`[fullchain-seed] ${message}`);
}

function fail(message) {
  throw new Error(message);
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
  const usesDefaultKey = [DEPLOYER_KEY, CONSUMER_KEY, PROVIDER_KEY].some(
    (key) => Object.values(DEFAULT_KEYS).includes(key)
  );
  if (usesDefaultKey && CHAIN_ID !== 31337) {
    fail("Refusing to use default local test keys outside CHAIN_ID=31337.");
  }
  if (
    usesDefaultKey &&
    (!isLocalUrl(RPC_URL) ||
      !isLocalUrl(GATEWAY_BASE_URL) ||
      !isLocalUrl(FRONTEND_URL))
  ) {
    fail(
      "Refusing to use default local test keys against non-localhost endpoints."
    );
  }
}

async function assertReachable(name, url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= (options.attempts || 3); attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs || 15000
    );
    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        signal: controller.signal,
      });
      if (!response.ok && !options.allowNonOk) {
        fail(
          `${name} not ready: ${response.status} ${response.statusText} at ${url}`
        );
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
  fail(
    `${name} not reachable at ${url}. Start local dependencies first. ${
      lastError?.message || "unknown error"
    }`
  );
}

async function api(
  pathname,
  { method = "GET", token, address, body, headers = {} } = {}
) {
  const requestHeaders = {
    Accept: "application/json",
    ...headers,
  };
  if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
  }
  if (token) {
    requestHeaders.Authorization = `Bearer ${token}`;
  }
  if (address) {
    requestHeaders["X-User-Address"] = address;
  }

  const response = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
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
    fail(
      `${method} ${pathname} failed: ${response.status} ${JSON.stringify(
        payload
      ).slice(0, 800)}`
    );
  }
  return payload;
}

async function authenticate(privateKey, label) {
  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address;
  const challenge = await api(
    `/v1/auth/challenge?address=${encodeURIComponent(address)}`
  );
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
  return {
    address,
    token,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

async function getChainContext() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== CHAIN_ID) {
    fail(`RPC chainId mismatch. Expected ${CHAIN_ID}, got ${chainId}.`);
  }
  const contractConfig = readJson(
    "services/user-front/src/contract-config.json"
  );
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
      if (
        !/nonce|replacement|underpriced|already known/i.test(
          error.message || ""
        )
      ) {
        throw error;
      }
      log(`${label} retry ${i + 1}/${attempts}: ${error.message}`);
      await sleep(1000);
    }
  }
  throw lastError;
}

function decimalToAtomic(value, decimals = 6) {
  const normalized = String(value ?? "0").trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return 0n;
  }
  const [whole, fraction = ""] = normalized.split(".");
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0").slice(0, decimals))
  );
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

async function fundAndDeposit({ consumerAddress }) {
  const { provider, coreAbi, usdcAbi, usdcAddress, coreAddress } =
    await getChainContext();
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
    const tx = await sendWithRetry("eth-topup", async () =>
      deployer.sendTransaction({ to: consumerAddress, value: delta })
    );
    await tx.wait();
    log(`consumer ETH top-up confirmed to target ${CONSUMER_ETH_TARGET} ETH`);
  }

  const mintTx = await sendWithRetry("mint-usdc", async () =>
    usdcDeployer.mint(consumerAddress, amountAtomic)
  );
  await mintTx.wait();
  log(`${DEPOSIT_USDC} MockUSDC minted for consumer`);

  const approveTx = await sendWithRetry("approve-usdc", async () =>
    usdcConsumer.approve(coreAddress, amountAtomic)
  );
  await approveTx.wait();
  log("SynapseCore approval confirmed");

  const depositTx = await sendWithRetry("deposit", async () =>
    coreConsumer.deposit(amountAtomic)
  );
  const receipt = await depositTx.wait();
  if (receipt?.status !== 1) {
    fail(`deposit transaction failed: ${depositTx.hash}`);
  }
  log(`chain deposit confirmed: ${depositTx.hash}`);
  return {
    txHash: depositTx.hash,
    amountUsdc: DEPOSIT_USDC,
    decimals,
    coreAddress,
    usdcAddress,
  };
}

async function waitForBalanceAtLeast({ token, address, expectedUsdc, txHash }) {
  const expected = decimalToAtomic(expectedUsdc);
  let lastBalance = "0";
  for (let i = 0; i < 40; i += 1) {
    if (txHash) {
      await api(
        `/v1/balance/deposit/sync?txHash=${encodeURIComponent(
          String(txHash).toLowerCase()
        )}`,
        {
          token,
          address,
        }
      ).catch((error) => {
        log(`deposit sync poll failed: ${error.message}`);
        return null;
      });
    }
    const payload = await api("/v1/balance", { token, address });
    const balance = payload.balance || {};
    lastBalance = String(
      balance.consumerAvailableBalance ?? balance.ownerBalance ?? "0"
    );
    if (decimalToAtomic(lastBalance) >= expected) {
      log(`consumer gateway balance synced: ${lastBalance} USDC`);
      return payload;
    }
    await sleep(2000);
  }
  fail(
    `consumer balance did not reach ${expectedUsdc} USDC; last=${lastBalance}`
  );
}

async function registerDepositIntent({ token, address, txHash, amountUsdc }) {
  const payload = await api("/v1/balance/deposit/intent", {
    method: "POST",
    token,
    address,
    headers: {
      "X-Idempotency-Key": `ufc-deposit-${txHash
        .replace(/^0x/, "")
        .slice(0, 80)}`,
    },
    body: { txHash, amountUsdc },
  });
  log(
    `deposit intent registered: ${payload.intent?.id || payload.id || txHash}`
  );
  return payload;
}

async function confirmLocalDepositIntent({
  token,
  address,
  depositIntent,
  txHash,
}) {
  const depositIntentId = depositIntent.intent?.id || depositIntent.id;
  if (!depositIntentId) {
    fail(
      `deposit intent response missing id: ${JSON.stringify(
        depositIntent
      ).slice(0, 600)}`
    );
  }
  const confirmed = await api(
    `/v1/balance/deposit/intents/${encodeURIComponent(
      depositIntentId
    )}/confirm`,
    {
      method: "POST",
      token,
      address,
      body: {
        eventKey: `local-fullchain:${String(txHash).toLowerCase()}`,
        confirmations: 1,
      },
    }
  );
  log(`deposit intent confirmed locally: ${depositIntentId}`);
  return confirmed;
}

async function issueProviderSecret({ token, address }) {
  const payload = await api("/v1/secrets/provider/issue", {
    method: "POST",
    token,
    address,
    body: {
      name: `ufc-provider-secret-${RUN_ID}`,
      rpm: 240,
      creditLimit: "10000",
      expiration: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    },
  });
  const secret = payload.secret || payload.credential || payload;
  if (!secret?.id && !secret?.secretKey) {
    fail("provider secret issue response missing secret metadata");
  }
  return {
    id: secret.id || secret.credentialId || "",
    tokenPrefix: secret.tokenPrefix || secret.secretPrefix || "",
  };
}

async function resolveExistingService(serviceId) {
  const discovered = await waitForServiceDiscoverable(serviceId);
  const pricing =
    typeof discovered.pricing === "object" && discovered.pricing
      ? discovered.pricing
      : {};
  const priceUsdc = moneyFromObject(
    discovered,
    ["basePriceUsdc", "priceUsdc", "unitPrice"],
    pricing.amount || "0.001"
  );
  return {
    id: serviceId,
    name: discovered.serviceName || discovered.name || serviceId,
    slug: serviceId.replace(/[^a-zA-Z0-9_]/g, "_"),
    label: discovered.serviceName || discovered.name || serviceId,
    priceUsdc,
    mockUrl: "",
    discoveredRuntimeAvailable: discovered.runtimeAvailable ?? true,
  };
}

async function waitForServiceDiscoverable(serviceId) {
  for (let i = 0; i < 30; i += 1) {
    const payload = await api(
      `/v1/services/discover?q=${encodeURIComponent(serviceId)}`
    );
    const services = Array.isArray(payload.services) ? payload.services : [];
    const found = services.find((service) =>
      [service.serviceId, service.service_id, service.agentToolName].includes(
        serviceId
      )
    );
    if (found && found.isActive !== false && found.runtimeAvailable !== false) {
      log(`service discoverable and callable: ${serviceId}`);
      return found;
    }
    await sleep(3000);
  }
  fail(
    `service was not discoverable/callable after health probes: ${serviceId}`
  );
}

async function issueAgentCredential({ token, address }) {
  const payload = await api("/v1/credentials/agent/issue", {
    method: "POST",
    token,
    address,
    body: {
      name: `ufc-agent-${RUN_ID}`,
      rpm: 240,
      maxCalls: 500,
      creditLimit: "1000",
      resetInterval: "daily",
    },
  });
  const credential = payload.credential || payload;
  const credentialToken =
    credential.token || credential.secretKey || credential.agentToken;
  if (!credential?.id || !credentialToken) {
    fail("agent credential issue response missing id or token");
  }
  log(`agent credential issued: ${credential.id}`);
  return {
    id: credential.id,
    token: credentialToken,
    tokenPrefix: credential.tokenPrefix || credential.secretPrefix || "",
    name: credential.name || `ufc-agent-${RUN_ID}`,
    maxCalls: Number(credential.maxCalls || 500),
  };
}

async function invokeService({ credentialToken, service, callIndex }) {
  const requestId = `ufc-invoke-${RUN_ID}-${service.slug}-${String(
    callIndex
  ).padStart(3, "0")}`;
  const response = await api("/v1/agent/invoke", {
    method: "POST",
    headers: {
      "X-Credential": credentialToken,
      "X-Service-Id": service.id,
      "X-Request-Id": requestId,
    },
    body: {
      serviceId: service.id,
      idempotencyKey: requestId,
      costUsdc: service.priceUsdc,
      payload: {
        body: {
          query: `verify ${RUN_ID}`,
          serviceSlug: service.slug,
          callIndex,
        },
      },
      responseMode: "sync",
    },
  });
  const receipt = response.payload?.receipt || response.receipt || {};
  if (!receipt.invocationId) {
    fail(
      `invoke response missing invocationId: ${JSON.stringify(response).slice(
        0,
        800
      )}`
    );
  }
  return {
    requestId,
    serviceId: service.id,
    serviceSlug: service.slug,
    invocationId: receipt.invocationId,
    quoteId: receipt.quoteId,
    totalChargeUsdc: moneyFromObject(
      receipt,
      ["totalCharge", "totalChargeUsdc", "chargedUsdc"],
      service.priceUsdc
    ),
    consumerAvailableBalanceAfter: moneyFromObject(
      receipt,
      ["consumerAvailableBalanceAfter"],
      "0"
    ),
    serviceUnitPrice: moneyFromObject(
      receipt,
      ["serviceUnitPrice", "unitPrice"],
      service.priceUsdc
    ),
  };
}

async function invokeServices100({ credentialToken, services }) {
  const invocations = [];
  let callIndex = 0;
  for (
    let serviceIndex = 0;
    serviceIndex < services.length;
    serviceIndex += 1
  ) {
    const service = services[serviceIndex];
    const count = INVOCATION_DISTRIBUTION[serviceIndex] || 0;
    for (let localIndex = 0; localIndex < count; localIndex += 1) {
      callIndex += 1;
      const invocation = await invokeService({
        credentialToken,
        service,
        callIndex,
      });
      invocations.push(invocation);
      if (invocations.length % 10 === 0 || invocations.length === 100) {
        log(`invoked ${invocations.length}/100 calls`);
      }
    }
  }
  if (invocations.length !== 100) {
    fail(`expected 100 invocations, got ${invocations.length}`);
  }
  return invocations;
}

async function readProviderEarnings({ token, address }) {
  const payload = await api("/v1/providers/earnings/summary?limit=500", {
    token,
    address,
  });
  return payload.summary || {};
}

async function readUsage({ token, address }) {
  const payload = await api("/v1/usage/logs?limit=500", { token, address });
  const rows = Array.isArray(payload.logs)
    ? payload.logs
    : Array.isArray(payload.records)
    ? payload.records
    : [];
  return { payload, rows, count: rows.length };
}

async function readCredentials({ token, address }) {
  const payload = await api("/v1/credentials/agent/list", { token, address });
  return Array.isArray(payload.credentials) ? payload.credentials : [];
}

function summarizeUsageRows({ services, usageRows, requestIds }) {
  const serviceIds = new Set(services.map((service) => service.id));
  const requestIdSet = new Set(requestIds);
  const matchedRows = usageRows.filter((row) => {
    const requestId = String(
      row.requestId ||
        row.request_id ||
        row.originRequestId ||
        row.origin_request_id ||
        ""
    );
    const serviceId = String(row.serviceId || row.service_id || "");
    return requestIdSet.has(requestId) || serviceIds.has(serviceId);
  });

  const perService = Object.fromEntries(
    services.map((service) => [
      service.id,
      {
        serviceId: service.id,
        serviceName: service.name,
        serviceSlug: service.slug,
        priceUsdc: service.priceUsdc,
        callCount: 0,
        grossAtomic: "0",
        platformFeeAtomic: "0",
        providerNetAtomic: "0",
        grossUsdc: "0.000000",
        platformFeeUsdc: "0.000000",
        providerNetUsdc: "0.000000",
      },
    ])
  );

  let grossAtomic = 0n;
  let platformFeeAtomic = 0n;
  let providerNetAtomic = 0n;
  for (const row of matchedRows) {
    const serviceId = String(row.serviceId || row.service_id || "");
    if (!serviceIds.has(serviceId)) {
      continue;
    }
    const unitPriceAtomic = decimalToAtomic(
      moneyFromObject(row, ["unitPrice", "unit_price"], "0")
    );
    const totalChargeAtomic = decimalToAtomic(
      moneyFromObject(row, ["totalCharge", "total_charge", "chargedUsdc"], "0")
    );
    const protocolFeeAtomic = decimalToAtomic(
      moneyFromObject(row, ["protocolFee", "protocol_fee"], "0")
    );
    const routingTaxAtomic = decimalToAtomic(
      moneyFromObject(row, ["routingTax", "routing_tax"], "0")
    );
    const platformFeeTotalAtomic = protocolFeeAtomic + routingTaxAtomic;
    const providerNetForRow =
      unitPriceAtomic > protocolFeeAtomic
        ? unitPriceAtomic - protocolFeeAtomic
        : 0n;
    const grossForRow =
      totalChargeAtomic > 0n
        ? totalChargeAtomic
        : unitPriceAtomic + routingTaxAtomic;

    grossAtomic += grossForRow;
    platformFeeAtomic += platformFeeTotalAtomic;
    providerNetAtomic += providerNetForRow;

    const bucket = perService[serviceId];
    bucket.callCount += 1;
    bucket.grossAtomic = String(BigInt(bucket.grossAtomic) + grossForRow);
    bucket.platformFeeAtomic = String(
      BigInt(bucket.platformFeeAtomic) + platformFeeTotalAtomic
    );
    bucket.providerNetAtomic = String(
      BigInt(bucket.providerNetAtomic) + providerNetForRow
    );
    bucket.grossUsdc = atomicToDecimal(bucket.grossAtomic);
    bucket.platformFeeUsdc = atomicToDecimal(bucket.platformFeeAtomic);
    bucket.providerNetUsdc = atomicToDecimal(bucket.providerNetAtomic);
  }

  return {
    matchedUsageRows: matchedRows.length,
    totalConsumerChargeAtomic: String(grossAtomic),
    totalPlatformFeeAtomic: String(platformFeeAtomic),
    totalProviderNetAtomic: String(providerNetAtomic),
    totalConsumerChargeUsdc: atomicToDecimal(grossAtomic),
    totalPlatformFeeUsdc: atomicToDecimal(platformFeeAtomic),
    totalProviderNetUsdc: atomicToDecimal(providerNetAtomic),
    perService,
  };
}

async function writeFixture(fixture) {
  fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
  fs.writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2));
  log(`fixture written: ${path.relative(ROOT, FIXTURE_PATH)}`);
}

async function main() {
  assertLocalOnly();
  await assertReachable("user-front", FRONTEND_URL, { allowNonOk: true });
  await assertReachable("gateway health", `${GATEWAY_BASE_URL}/health`);
  await assertReachable("rpc", RPC_URL, {
    method: "POST",
    allowNonOk: true,
  });

  const providerAuth = await authenticate(PROVIDER_KEY, "provider");
  const consumerAuth = await authenticate(CONSUMER_KEY, "consumer");
  const chain = await getChainContext();
  const providerSecret = await issueProviderSecret(providerAuth);

  const services = [];
  log(
    `using Synapse-Network-Provider catalog services: ${CANONICAL_SERVICE_IDS.join(
      ", "
    )}`
  );
  for (const serviceId of CANONICAL_SERVICE_IDS) {
    services.push(await resolveExistingService(serviceId));
  }

  const deposit = await fundAndDeposit({
    consumerAddress: consumerAuth.address,
  });
  const depositIntent = await registerDepositIntent({
    ...consumerAuth,
    txHash: deposit.txHash,
    amountUsdc: deposit.amountUsdc,
  });
  const confirmedDeposit = await confirmLocalDepositIntent({
    ...consumerAuth,
    depositIntent,
    txHash: deposit.txHash,
  });
  const balanceBeforeInvoke = await waitForBalanceAtLeast({
    ...consumerAuth,
    expectedUsdc: deposit.amountUsdc,
    txHash: deposit.txHash,
  });
  const providerEarningsBeforeInvoke = await readProviderEarnings(providerAuth);
  const credential = await issueAgentCredential(consumerAuth);
  const invocations = await invokeServices100({
    credentialToken: credential.token,
    services,
  });
  const balanceAfterInvoke = await api("/v1/balance", consumerAuth);
  const providerEarningsAfterInvoke = await readProviderEarnings(providerAuth);
  const consumerUsage = await readUsage(consumerAuth);
  const providerUsage = await readUsage(providerAuth);
  const credentialsAfterInvoke = await readCredentials(consumerAuth);
  const withdrawCapability = await api(
    "/v1/providers/withdrawals/capability",
    providerAuth
  );
  const requestIds = invocations.map((item) => item.requestId);
  const reconciliation = summarizeUsageRows({
    services,
    usageRows: consumerUsage.rows,
    requestIds,
  });

  if (reconciliation.matchedUsageRows < 100) {
    fail(
      `usage log reconciliation found ${reconciliation.matchedUsageRows}/100 seeded calls`
    );
  }

  const seededCredential = credentialsAfterInvoke.find(
    (item) => item.id === credential.id
  );
  if (!seededCredential || Number(seededCredential.callsUsed || 0) < 100) {
    fail(
      `credential callsUsed did not reach 100: ${JSON.stringify(
        seededCredential || {}
      ).slice(0, 500)}`
    );
  }

  await writeFixture({
    version: 2,
    mode: "local-fullchain-100",
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    invocationPlan: {
      totalCalls: 100,
      distribution: INVOCATION_DISTRIBUTION,
    },
    baseUrls: {
      frontend: FRONTEND_URL,
      gateway: GATEWAY_BASE_URL,
      rpc: RPC_URL,
      mockUpstreams: mocks.map((mock) => ({
        slug: mock.slug,
        url: mock.url,
        pid: mock.pid,
        reused: mock.reused,
      })),
    },
    chain: {
      chainId: chain.chainId,
      synapseCore: chain.coreAddress,
      mockUSDC: chain.usdcAddress,
      depositTxHash: deposit.txHash,
    },
    consumer: {
      address: consumerAuth.address,
      privateKey: CONSUMER_KEY,
      token: consumerAuth.token,
      expiresAt: consumerAuth.expiresAt,
    },
    provider: {
      address: providerAuth.address,
      privateKey: PROVIDER_KEY,
      token: providerAuth.token,
      expiresAt: providerAuth.expiresAt,
    },
    providerSecret,
    services,
    service: services[0],
    credential: {
      id: credential.id,
      name: credential.name,
      token: credential.token,
      tokenPrefix: credential.tokenPrefix,
      maxCalls: credential.maxCalls,
      callsUsed: Number(seededCredential.callsUsed || 0),
    },
    deposit: {
      txHash: deposit.txHash,
      amountUsdc: deposit.amountUsdc,
      intentId: depositIntent.intent?.id || depositIntent.id || null,
      confirmedIntentId:
        confirmedDeposit.intent?.id || confirmedDeposit.id || null,
    },
    invocations,
    invocation: invocations[0],
    reconciliation: {
      ...reconciliation,
      balanceBeforeInvoke: balanceBeforeInvoke.balance || balanceBeforeInvoke,
      balanceAfterInvoke: balanceAfterInvoke.balance || balanceAfterInvoke,
      providerEarningsBeforeInvoke,
      providerEarningsAfterInvoke,
      consumerUsage: {
        count: consumerUsage.count,
        total: consumerUsage.payload.total,
      },
      providerUsage: {
        count: providerUsage.count,
        total: providerUsage.payload.total,
      },
      credentialsAfterInvoke: {
        callsUsed: Number(seededCredential.callsUsed || 0),
        status: seededCredential.status,
      },
      withdrawCapability,
    },
  });
}

main().catch((error) => {
  console.error(
    `[fullchain-seed] fatal: ${error.stack || error.message || String(error)}`
  );
  process.exit(1);
});
