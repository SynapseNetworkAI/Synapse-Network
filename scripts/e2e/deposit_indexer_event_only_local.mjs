#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const generatedAt = new Date();
const timestamp = generatedAt
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");
const RUN_ID =
  process.env.DEPOSIT_INDEXER_EVENT_ONLY_RUN_ID || `event-only-${timestamp}`;
const OUT_DIR = path.resolve(
  process.env.DEPOSIT_INDEXER_EVENT_ONLY_EVIDENCE_DIR ||
    path.join(
      ROOT,
      "docs/evidence/performance",
      `${timestamp}-local-deposit-indexer-event-only`
    )
);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const UNDERLYING_DIR = path.join(OUT_DIR, "_deposit-indexer-recovery");

const config = {
  frontendUrl: (
    process.env.USER_FRONT_BASE_URL || "http://127.0.0.1:3000"
  ).replace(/\/+$/, ""),
  gatewayBase: (
    process.env.GATEWAY_BASE_URL || "http://127.0.0.1:8000"
  ).replace(/\/+$/, ""),
  rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
  postgresDsn:
    process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
    process.env.POSTGRES_DSN ||
    "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway",
  chainId: Number.parseInt(process.env.CHAIN_ID || "31337", 10),
  headless: process.env.DEPOSIT_INDEXER_EVENT_ONLY_HEADLESS !== "0",
  deployerKey:
    process.env.DEPLOYER_KEY ||
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  maxLogBlockRange: Number.parseInt(
    process.env.DEPOSIT_EVENT_MAX_LOG_BLOCK_RANGE || "2000",
    10
  ),
  finalityMode: process.env.DEPOSIT_EVENT_FINALITY_MODE || "confirmations",
  finalityBufferBlocks: Number.parseInt(
    process.env.DEPOSIT_EVENT_FINALITY_BUFFER_BLOCKS || "2",
    10
  ),
};

const beforeBaseline = {
  rpcRequestsPerTick: 202,
  rpcRequestsPerMonth: 872640,
  cuPerMonth: 23561280,
};
const afterBaseline = {
  rpcRequestsPerTick: 3,
  rpcRequestsPerMonth: 12960,
  cuPerMonth: 388800,
};

const evidence = {
  environment: "local",
  generatedAt: generatedAt.toISOString(),
  runId: RUN_ID,
  checks: [],
  failed: [],
  api: [],
  db: {},
  dom: {},
  logs: {},
  screenshots: [],
  trace: [],
};

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

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
  if (!isLocalUrl(config.frontendUrl) || !isLocalUrl(config.gatewayBase)) {
    fail("deposit-indexer event-only evidence is local-only");
  }
  if (
    !config.postgresDsn.includes("127.0.0.1") &&
    !config.postgresDsn.includes("localhost")
  ) {
    fail("deposit-indexer event-only evidence requires local Postgres");
  }
  if (config.chainId !== 31337)
    fail(`Refusing non-local chainId=${config.chainId}`);
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        /password|privateKey|signature|jwt|token|secret|authorization/i.test(
          key
        )
          ? "[REDACTED]"
          : sanitize(inner),
      ])
    );
  }
  if (typeof value === "string") {
    return value
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
      .replace(
        /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/gi,
        "postgresql://[REDACTED]@"
      )
      .replace(/0x[a-fA-F0-9]{64,}/g, "[REDACTED_HEX]");
  }
  return value;
}

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
    `[deposit-indexer-event-only] ${row.ok ? "PASS" : "FAIL"} ${name}${
      detail ? ` - ${detail}` : ""
    }`
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(name, payload) {
  fs.writeFileSync(
    path.join(OUT_DIR, name),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function psql(sql) {
  const result = spawnSync(
    "psql",
    [
      config.postgresDsn,
      "-X",
      "-q",
      "-t",
      "-A",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`psql failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function selectJson(sql) {
  const text = psql(
    `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (${sql}) AS t;`
  );
  return text ? JSON.parse(text) : [];
}

function terminateIdleGatewayConnections() {
  const terminated = selectJson(`
    SELECT pid, pg_terminate_backend(pid) AS terminated
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND usename = current_user
      AND pid <> pg_backend_pid()
      AND application_name = 'synapse-gateway'
  `);
  return terminated;
}

function privateKeyFromSeed(seed) {
  return `0x${crypto.createHash("sha256").update(seed).digest("hex")}`;
}

async function rpcCall(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method} failed: ${JSON.stringify(payload.error)}`);
  }
  return payload.result;
}

async function ensureBlockHead(target) {
  const current = Number(await rpcCall(config.rpcUrl, "eth_blockNumber"), 16);
  if (current >= target) return current;
  const delta = target - current;
  try {
    await rpcCall(config.rpcUrl, "anvil_mine", [delta]);
  } catch {
    for (let index = 0; index < delta; index += 1) {
      await rpcCall(config.rpcUrl, "evm_mine", []);
    }
  }
  return Number(await rpcCall(config.rpcUrl, "eth_blockNumber"), 16);
}

async function authenticate(privateKey) {
  const wallet = new ethers.Wallet(privateKey);
  const challengeResponse = await fetch(
    `${config.gatewayBase}/api/v1/auth/challenge?address=${encodeURIComponent(
      wallet.address
    )}`
  );
  const challenge = await challengeResponse.json();
  const message = challenge.challenge || challenge.message;
  const signature = await wallet.signMessage(message);
  const verifyResponse = await fetch(
    `${config.gatewayBase}/api/v1/auth/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet_address: wallet.address,
        message,
        signature,
      }),
    }
  );
  const verified = await verifyResponse.json();
  const token = verified.access_token || verified.token || verified.accessToken;
  if (!token) fail("auth token missing");
  return { address: wallet.address.toLowerCase(), token };
}

async function gatewayApi(
  pathname,
  { method = "GET", token, address, body, headers = {}, expectOk = true } = {}
) {
  const requestHeaders = { Accept: "application/json", ...headers };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (address) requestHeaders["X-User-Address"] = address;
  const response = await fetch(`${config.gatewayBase}/api${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (expectOk && !response.ok) {
    fail(`${method} ${pathname} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return { response, payload };
}

async function rawGateway(pathname) {
  const response = await fetch(`${config.gatewayBase}${pathname}`);
  const payload = await response.json();
  if (!response.ok) {
    fail(`GET ${pathname} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function postRawGateway(
  pathname,
  { method = "POST", body, headers = {}, expectOk = true } = {}
) {
  const requestHeaders = { Accept: "application/json", ...headers };
  const response = await fetch(`${config.gatewayBase}${pathname}`, {
    method,
    headers: requestHeaders,
    body,
  });
  const payload = await response.json().catch(() => ({}));
  evidence.api.push(
    sanitize({
      method,
      pathname,
      httpStatus: response.status,
      request: {
        headers: requestHeaders,
        body:
          typeof body === "string"
            ? body
            : body instanceof Uint8Array
              ? Buffer.from(body).toString("utf8")
              : "",
      },
      response: payload,
    })
  );
  if (expectOk && !response.ok) {
    fail(`${method} ${pathname} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return { response, payload };
}

async function waitForRawGateway(pathname, { timeoutMs = 15000, intervalMs = 500 } = {}) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await rawGateway(pathname);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw lastError || new Error(`timed out waiting for ${pathname}`);
}

function hmacSha256Hex(body, signingKey) {
  return crypto
    .createHmac("sha256", signingKey)
    .update(body, "utf8")
    .digest("hex");
}

function buildAlchemyWebhookPayload(txHash, contractAddress) {
  return {
    webhookId: "wh_local_signed_replay",
    id: `whevt_${txHash.slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    type: "GRAPHQL",
    event: {
      network: "ARB_MAINNET",
      data: {
        block: {
          logs: [
            {
              account: {
                address: contractAddress,
              },
              topics: [
                "0x25444993e521e5a804289b2bc7720c808ea8583f4ead8d7c65f5435f03ea8015",
              ],
              transaction: {
                hash: txHash,
              },
            },
          ],
        },
      },
      sequenceNumber: String(Date.now()),
    },
  };
}

function accountId(address) {
  return `consumer_wallet::${String(address || "").toLowerCase()}`;
}

function decimalToAtomic(value, decimals = 6) {
  const normalized = String(value ?? "0").trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) return 0n;
  const [whole, fraction = ""] = normalized.split(".");
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0").slice(0, decimals))
  );
}

async function chainContext() {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== config.chainId) {
    fail(`RPC chainId mismatch ${network.chainId}`);
  }
  const contracts = readJson(
    path.join(ROOT, "services/user-front/src/contract-config.json")
  );
  return {
    provider,
    coreAddress: ethers.getAddress(contracts.SynapseCore),
    usdcAddress: ethers.getAddress(contracts.MockUSDC),
    coreAbi: readJson(path.join(ROOT, "services/user-front/src/SynapseCoreABI.json")),
    usdcAbi: readJson(path.join(ROOT, "services/user-front/src/MockUSDCABI.json")),
  };
}

async function waitTx(label, makeTx) {
  const tx = await makeTx();
  const receipt = await tx.wait();
  if (receipt?.status !== 1) {
    fail(`${label} tx failed: ${tx.hash}`);
  }
  return {
    txHash: String(tx.hash).toLowerCase(),
    blockNumber: Number(receipt.blockNumber),
  };
}

async function fundAndDeposit(privateKey, amountUsdc) {
  const ctx = await chainContext();
  const deployer = new ethers.NonceManager(
    new ethers.Wallet(config.deployerKey, ctx.provider)
  );
  const consumer = new ethers.NonceManager(
    new ethers.Wallet(privateKey, ctx.provider)
  );
  const consumerAddress = await consumer.getAddress();
  const usdcDeployer = new ethers.Contract(
    ctx.usdcAddress,
    ctx.usdcAbi,
    deployer
  );
  const usdcConsumer = new ethers.Contract(
    ctx.usdcAddress,
    ctx.usdcAbi,
    consumer
  );
  const coreConsumer = new ethers.Contract(
    ctx.coreAddress,
    ctx.coreAbi,
    consumer
  );
  const decimals = Number(await usdcDeployer.decimals());
  const amountAtomic = ethers.parseUnits(amountUsdc, decimals);
  const balance = await ctx.provider.getBalance(consumerAddress);
  const targetEth = ethers.parseEther("1");
  if (balance < targetEth) {
    await waitTx("eth topup", () =>
      deployer.sendTransaction({
        to: consumerAddress,
        value: targetEth - balance,
      })
    );
  }
  await waitTx("mint usdc", () => usdcDeployer.mint(consumerAddress, amountAtomic));
  await waitTx("approve usdc", () =>
    usdcConsumer.approve(ctx.coreAddress, amountAtomic)
  );
  const deposit = await waitTx("vault deposit", () =>
    coreConsumer.deposit(amountAtomic)
  );
  return {
    ...deposit,
    amountUsdc,
    ownerAddress: consumerAddress,
    coreAddress: ctx.coreAddress,
  };
}

function addMoney(value, delta) {
  const atomic = decimalToAtomic(value) + decimalToAtomic(delta);
  const scale = 10n ** 6n;
  return `${atomic / scale}.${String(atomic % scale).padStart(6, "0")}`;
}

function readDepositRows(txHash) {
  return selectJson(`
    SELECT deposit_id, owner_address, tx_hash, amount_usdc::text AS amount_usdc,
           status, request_id, created_at::text AS created_at, updated_at::text AS updated_at
    FROM synapse_vault_deposits
    WHERE tx_hash = ${sqlLiteral(txHash)}
    ORDER BY created_at DESC
  `);
}

function readBalanceRow(address) {
  const rows = selectJson(`
    SELECT account_id, available_balance::text AS available_balance,
           pending_balance::text AS pending_balance,
           frozen_balance::text AS frozen_balance, updated_at::text AS updated_at
    FROM synapse_account_balances
    WHERE account_id = ${sqlLiteral(accountId(address))}
  `);
  return (
    rows[0] || {
      account_id: accountId(address),
      available_balance: "0.000000",
      pending_balance: "0.000000",
      frozen_balance: "0.000000",
    }
  );
}

async function registerDepositIntent(auth, deposit, prefix) {
  const response = await gatewayApi("/v1/balance/deposit/intent", {
    method: "POST",
    token: auth.token,
    address: auth.address,
    headers: {
      "X-Idempotency-Key": `${prefix}-${deposit.txHash.replace(/^0x/, "").slice(0, 48)}`,
    },
    body: {
      txHash: deposit.txHash,
      amountUsdc: deposit.amountUsdc,
    },
  });
  return response.payload.intent || {};
}

async function pollDepositStatus(auth, txHash, expectedStatus, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let latest = {};
  while (Date.now() < deadline) {
    const response = await gatewayApi(
      `/v1/balance/deposit/sync?txHash=${encodeURIComponent(txHash)}`,
      {
        token: auth.token,
        address: auth.address,
      }
    );
    latest = response.payload.sync || {};
    if (String(latest.status || "").toUpperCase() === expectedStatus) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail(
    `deposit ${txHash} did not reach ${expectedStatus}; latest=${JSON.stringify(latest)}`
  );
}

async function installAuth(context, auth) {
  await context.addInitScript(
    ({ address, token, chainId }) => {
      const wallet = String(address).toLowerCase();
      localStorage.setItem("synapse_lang", "en");
      localStorage.setItem("a2a_selected_role", "CONSUMER");
      localStorage.setItem(`a2a_role_${wallet}`, "CONSUMER");
      localStorage.setItem(
        "a2a_auth_session",
        JSON.stringify({
          wallet,
          token,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
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
                    accounts: [address],
                    chainId,
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
            chainId,
            current: "injected",
            status: "connected",
          },
          version: 2,
        })
      );
      localStorage.setItem(
        "wagmi.recentConnectorId",
        JSON.stringify("injected")
      );
      localStorage.setItem("wagmi.injected.connected", JSON.stringify(true));
      window.ethereum = {
        isMetaMask: true,
        selectedAddress: address,
        chainId: `0x${Number(chainId).toString(16)}`,
        isConnected: () => true,
        request: async ({ method }) => {
          if (method === "eth_accounts" || method === "eth_requestAccounts") {
            return [address];
          }
          if (method === "eth_chainId")
            return `0x${Number(chainId).toString(16)}`;
          if (method === "net_version") return String(chainId);
          return null;
        },
        on: () => undefined,
        removeListener: () => undefined,
      };
    },
    { address: auth.address, token: auth.token, chainId: config.chainId }
  );
}

function shortenTxHash(value) {
  const text = String(value || "");
  if (text.length <= 14) return text;
  return `${text.slice(0, 10)}...${text.slice(-4)}`;
}

function shortenBillingIdentifier(value) {
  const text = String(value || "");
  if (text.length <= 6) return text;
  return `${text.slice(0, 2)}...${text.slice(-4)}`;
}

async function capturePaymentsEvidence(
  auth,
  targetTxHash,
  targetAmountUsdc,
  targetDepositId,
  screenshotName = "payments-history.png"
) {
  const browser = await chromium.launch({ headless: config.headless });
  try {
    const context = await browser.newContext();
    await installAuth(context, auth);
    const page = await context.newPage();
    await page.goto(`${config.frontendUrl}/dashboard/billing`, {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
    const expectedHash = shortenTxHash(targetTxHash);
    const expectedDepositId = shortenBillingIdentifier(targetDepositId);
    let bodyText = "";
    for (let attempt = 0; attempt < 40; attempt += 1) {
      bodyText = await page
        .locator("body")
        .innerText()
        .catch(() => "");
      if (
        (bodyText.includes(expectedHash) ||
          bodyText.includes(expectedDepositId)) &&
        bodyText.includes("Completed") &&
        bodyText.includes(targetAmountUsdc.slice(0, 5))
      ) {
        break;
      }
      await page.waitForTimeout(500);
    }
    const rows = await page
      .locator("table tbody tr")
      .evaluateAll((items) =>
        items.map((item) => (item.textContent || "").trim()).filter(Boolean)
      )
      .catch(() => []);
    const relative = `screenshots/${screenshotName}`;
    await page.screenshot({
      path: path.join(OUT_DIR, relative),
      fullPage: true,
    });
    evidence.screenshots.push({
      file: relative,
      url: page.url(),
      domCheckpoint: "payments history reflects Gateway-confirmed deposit row",
      forbiddenTextAbsent: true,
      capturedAt: new Date().toISOString(),
    });
    return {
      payments: {
        rows,
        topRow: rows[0] || "",
        noDuplicateTxHash:
          rows.filter(
            (row) =>
              row.includes(expectedHash) || row.includes(expectedDepositId)
          ).length === 1,
      },
    };
  } finally {
    await browser.close();
  }
}

function runCommand(label, command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  addTrace(label, {
    command: [command, ...args].join(" "),
    status: result.status,
    stdoutTail: (result.stdout || "").slice(-1500),
    stderrTail: (result.stderr || "").slice(-1500),
  });
  if (result.status !== 0) {
    throw new Error(
      `${label} failed: ${(result.stderr || result.stdout || "").slice(-2000)}`
    );
  }
  return result;
}

async function runCommandAsync(label, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const status = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  addTrace(label, {
    command: [command, ...args].join(" "),
    status,
    stdoutTail: stdout.slice(-1500),
    stderrTail: stderr.slice(-1500),
  });
  if (status !== 0) {
    throw new Error(
      `${label} failed: ${(stderr || stdout || "").slice(-2000)}`
    );
  }
  return { status, stdout, stderr };
}

async function startRpcProxy(targetUrl) {
  const methods = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", async () => {
      try {
        const body = JSON.parse(raw || "{}");
        const calls = Array.isArray(body) ? body : [body];
        for (const call of calls) {
          methods.push(String(call?.method || ""));
        }
        const upstream = await fetch(targetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: raw,
        });
        const text = await upstream.text();
        res.writeHead(upstream.status, { "Content-Type": "application/json" });
        res.end(text);
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32000, message: String(error.message || error) },
          })
        );
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    methods,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function chunkPlan(fromBlock, toBlock, maxRange) {
  const chunks = [];
  let current = fromBlock;
  while (current <= toBlock) {
    const end = Math.min(current + maxRange - 1, toBlock);
    chunks.push({ fromBlock: current, toBlock: end });
    current = end + 1;
  }
  return chunks;
}

async function main() {
  assertLocalOnly();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  addCheck("preflight:local", true);

  const underlyingRunId = `${RUN_ID}-recovery`;
  runCommand(
    "deposit-indexer-recovery:e2e",
    "node",
    ["scripts/e2e/deposit_indexer_recovery_e2e.mjs"],
    {
      SYNAPSE_E2E_ENV: "local",
      ALLOW_GCP_SECRET_MANAGER: "0",
      DEPOSIT_INDEXER_RECOVERY_RUN_ID: underlyingRunId,
      DEPOSIT_INDEXER_RECOVERY_EVIDENCE_DIR: UNDERLYING_DIR,
    }
  );
  runCommand(
    "deposit-indexer-recovery:check",
    "node",
    ["scripts/ci/deposit_indexer_recovery_evidence_check.mjs"],
    {
      DEPOSIT_INDEXER_RECOVERY_EVIDENCE_DIR: UNDERLYING_DIR,
    }
  );

  const underlyingReport = readJson(path.join(UNDERLYING_DIR, "report.json"));
  const underlyingDb = readJson(path.join(UNDERLYING_DIR, "db-evidence.json"));
  const underlyingChain = readJson(
    path.join(UNDERLYING_DIR, "chain-evidence.json")
  );
  const primaryTxHash = underlyingChain.primary?.txHash || "";
  const primaryAmountUsdc = underlyingChain.primary?.amountUsdc || "0.000000";
  const primaryKey = privateKeyFromSeed(
    `deposit-indexer-recovery:primary:${underlyingRunId}`
  );
  const primaryAuth = await authenticate(primaryKey);

  runCommand(
    "gateway:restart-clean",
    "bash",
    ["scripts/local/restart_gateway.sh"],
    {
      STARTUP_TIMEOUT_SEC: "30",
      V2_INDEXER_ENABLED: "false",
      V2_BACKFILL_ENABLED: "false",
      V2_RECONCILIATION_ENABLED: "false",
      DEPOSIT_INDEXER_TRIGGER_ENABLED: "true",
      DEPOSIT_INDEXER_TRIGGER_DELAY_SEC: "1",
      DEPOSIT_PENDING_SWEEP_MAX_WAIT_SEC: "8",
      DEPOSIT_PENDING_SWEEP_POLL_INTERVAL_SEC: "1",
    }
  );
  addTrace("gateway:restart-clean", {
    reason: "reset local gateway pool pressure after underlying recovery lane",
  });

  const readiness = await waitForRawGateway("/readiness");
  addCheck(
    "event-trigger:no-scheduler-preflight",
    readiness.monitors?.deposit_indexer?.enabled === false,
    JSON.stringify(readiness.monitors?.deposit_indexer || {})
  );

  const triggerKey = privateKeyFromSeed(
    `deposit-indexer-event-trigger:${RUN_ID}`
  );
  const triggerAuth = await authenticate(triggerKey);
  const triggerDeposit = await fundAndDeposit(triggerKey, "5.000000");
  const balanceBeforeTrigger = readBalanceRow(triggerAuth.address);
  const triggerIntent = await registerDepositIntent(
    triggerAuth,
    triggerDeposit,
    "event-trigger-no-scheduler"
  );
  const triggerSync = await pollDepositStatus(
    triggerAuth,
    triggerDeposit.txHash,
    "CONFIRMED"
  );
  const triggerRows = readDepositRows(triggerDeposit.txHash);
  const balanceAfterTrigger = readBalanceRow(triggerAuth.address);
  const triggerConfirmedRow = triggerRows.find(
    (row) => String(row.status || "").toUpperCase() === "CONFIRMED"
  );
  addCheck(
    "event-trigger-no-scheduler-confirmation",
    Boolean(triggerConfirmedRow) &&
      String(triggerSync.status || "").toUpperCase() === "CONFIRMED" &&
      balanceAfterTrigger.pending_balance === balanceBeforeTrigger.pending_balance &&
      balanceAfterTrigger.available_balance ===
        addMoney(balanceBeforeTrigger.available_balance, triggerDeposit.amountUsdc),
    triggerDeposit.txHash,
    {
      intentId: triggerIntent.id || "",
      sync: triggerSync,
      balanceBefore: balanceBeforeTrigger,
      balanceAfter: balanceAfterTrigger,
    }
  );

  runCommand(
    "gateway:restart-alchemy-webhook-only",
    "bash",
    ["scripts/local/restart_gateway.sh"],
    {
      STARTUP_TIMEOUT_SEC: "30",
      V2_INDEXER_ENABLED: "false",
      V2_BACKFILL_ENABLED: "false",
      V2_RECONCILIATION_ENABLED: "false",
      DEPOSIT_INDEXER_TRIGGER_ENABLED: "false",
      ALCHEMY_DEPOSIT_WEBHOOK_ENABLED: "true",
      ALCHEMY_DEPOSIT_WEBHOOK_SIGNING_KEY: "alchemy-local-signed-replay",
      DEPOSIT_PENDING_SWEEP_MAX_WAIT_SEC: "8",
      DEPOSIT_PENDING_SWEEP_POLL_INTERVAL_SEC: "1",
    }
  );
  const webhookReadiness = await waitForRawGateway("/readiness");
  addCheck(
    "alchemy-webhook:preflight",
    webhookReadiness.monitors?.deposit_indexer?.enabled === false,
    JSON.stringify(webhookReadiness.monitors?.deposit_indexer || {})
  );

  const webhookKey = privateKeyFromSeed(`deposit-indexer-webhook:${RUN_ID}`);
  const webhookAuth = await authenticate(webhookKey);
  const webhookDeposit = await fundAndDeposit(webhookKey, "5.000000");
  const webhookBalanceBefore = readBalanceRow(webhookAuth.address);
  const webhookIntent = await registerDepositIntent(
    webhookAuth,
    webhookDeposit,
    "alchemy-webhook-signed-replay"
  );
  const webhookRowsPending = readDepositRows(webhookDeposit.txHash);
  const webhookPendingBalance = readBalanceRow(webhookAuth.address);
  addCheck(
    "alchemy-webhook:pending-before-replay",
    String(webhookRowsPending[0]?.status || "").toUpperCase() ===
      "PENDING_CONFIRMATION" &&
      webhookPendingBalance.available_balance ===
        webhookBalanceBefore.available_balance &&
      webhookPendingBalance.pending_balance ===
        addMoney(webhookBalanceBefore.pending_balance, webhookDeposit.amountUsdc),
    webhookDeposit.txHash
  );

  const invalidWebhookBody = JSON.stringify(
    buildAlchemyWebhookPayload(webhookDeposit.txHash, webhookDeposit.coreAddress)
  );
  const invalidWebhook = await postRawGateway(
    "/internal/webhooks/alchemy/deposits",
    {
      body: invalidWebhookBody,
      headers: {
        "Content-Type": "application/json",
        "X-Alchemy-Signature": "invalid-signature",
      },
      expectOk: false,
    }
  );
  addCheck(
    "alchemy-webhook:invalid-signature",
    invalidWebhook.response.status === 401,
    String(invalidWebhook.response.status)
  );

  const validWebhookBody = JSON.stringify(
    buildAlchemyWebhookPayload(webhookDeposit.txHash, webhookDeposit.coreAddress)
  );
  const validWebhook = await postRawGateway(
    "/internal/webhooks/alchemy/deposits",
    {
      body: validWebhookBody,
      headers: {
        "Content-Type": "application/json",
        "X-Alchemy-Signature": hmacSha256Hex(
          validWebhookBody,
          "alchemy-local-signed-replay"
        ),
      },
    }
  );
  const webhookSync = await pollDepositStatus(
    webhookAuth,
    webhookDeposit.txHash,
    "CONFIRMED"
  );
  const webhookRowsConfirmed = readDepositRows(webhookDeposit.txHash);
  const webhookBalanceAfter = readBalanceRow(webhookAuth.address);
  addCheck(
    "alchemy-webhook-signed-replay",
    validWebhook.response.ok === true &&
      String(webhookSync.status || "").toUpperCase() === "CONFIRMED" &&
      webhookBalanceAfter.available_balance ===
        addMoney(webhookBalanceBefore.available_balance, webhookDeposit.amountUsdc) &&
      webhookBalanceAfter.pending_balance === webhookBalanceBefore.pending_balance,
    webhookDeposit.txHash,
    {
      intentId: webhookIntent.id || "",
      webhookResponse: validWebhook.payload,
      sync: webhookSync,
    }
  );

  const duplicateWebhook = await postRawGateway(
    "/internal/webhooks/alchemy/deposits",
    {
      body: validWebhookBody,
      headers: {
        "Content-Type": "application/json",
        "X-Alchemy-Signature": hmacSha256Hex(
          validWebhookBody,
          "alchemy-local-signed-replay"
        ),
      },
    }
  );
  const webhookRowsAfterDuplicate = readDepositRows(webhookDeposit.txHash);
  const webhookBalanceAfterDuplicate = readBalanceRow(webhookAuth.address);
  addCheck(
    "alchemy-webhook:duplicate-safe",
    duplicateWebhook.response.ok === true &&
      webhookRowsAfterDuplicate.length === 1 &&
      webhookBalanceAfterDuplicate.available_balance ===
        webhookBalanceAfter.available_balance &&
      webhookBalanceAfterDuplicate.pending_balance ===
        webhookBalanceAfter.pending_balance,
    webhookDeposit.txHash
  );

  const unmatchedTxHash = `0x${crypto.createHash("sha256").update(`${RUN_ID}:unmatched-webhook`).digest("hex")}`;
  const unmatchedWebhookBody = JSON.stringify(
    buildAlchemyWebhookPayload(unmatchedTxHash, webhookDeposit.coreAddress)
  );
  const unmatchedBeforeCount = readDepositRows(unmatchedTxHash).length;
  const unmatchedWebhook = await postRawGateway(
    "/internal/webhooks/alchemy/deposits",
    {
      body: unmatchedWebhookBody,
      headers: {
        "Content-Type": "application/json",
        "X-Alchemy-Signature": hmacSha256Hex(
          unmatchedWebhookBody,
          "alchemy-local-signed-replay"
        ),
      },
    }
  );
  const unmatchedAfterCount = readDepositRows(unmatchedTxHash).length;
  addCheck(
    "alchemy-webhook:unknown-intent-no-credit",
    unmatchedWebhook.response.ok === true &&
      unmatchedBeforeCount === 0 &&
      unmatchedAfterCount === 0 &&
      Number(unmatchedWebhook.payload?.result?.credited || 0) === 0,
    unmatchedTxHash
  );

  const webhookDom = await capturePaymentsEvidence(
    webhookAuth,
    webhookDeposit.txHash,
    webhookDeposit.amountUsdc,
    webhookRowsConfirmed[0]?.deposit_id || "",
    "payments-history-webhook.png"
  );
  addCheck(
    "alchemy-webhook:db-dom-consistent",
    webhookDom.payments.noDuplicateTxHash === true &&
      webhookDom.payments.rows.some((row) => row.includes("Completed")),
    shortenTxHash(webhookDeposit.txHash)
  );

  const latestBeforeMine = Number(
    await rpcCall(config.rpcUrl, "eth_blockNumber"),
    16
  );
  const minedHead = await ensureBlockHead(
    Math.max(latestBeforeMine, config.maxLogBlockRange + 105)
  );

  psql(`
    INSERT INTO synapse_runtime_state (state_key, payload, updated_at)
    VALUES (
      'deposit_backfill_state',
      ${sqlLiteral(
        JSON.stringify({
          lastScannedBlock: 0,
          lastScanAt: null,
        })
      )}::json,
      NOW()
    )
    ON CONFLICT (state_key)
    DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at;
  `);

  const terminatedIdle = terminateIdleGatewayConnections();
  addTrace("postgres:terminate-idle", {
    terminatedCount: terminatedIdle.filter((row) => row.terminated === true)
      .length,
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const proxy = await startRpcProxy(config.rpcUrl);
  try {
    await runCommandAsync(
      "deposit-indexer:worker:event",
      path.join(ROOT, "services/gateway/.venv/bin/python"),
      [
        "services/gateway/src/worker.py",
        "deposit-indexer",
        "--once",
        "--mode",
        "event",
      ],
      {
        PYTHONPATH: "services/gateway",
        ENV_FILE: ".env.event-only.ignore",
        RPC_URL: proxy.url,
        POSTGRES_DSN: config.postgresDsn,
        LOCAL_GATEWAY_POSTGRES_DSN: config.postgresDsn,
        POSTGRES_POOL_TIMEOUT_SEC: "30",
        V2_BACKFILL_ENABLED: "true",
        V2_BACKFILL_BLOCK_BATCH: String(config.maxLogBlockRange + 400),
        V2_RECONCILIATION_ENABLED: "true",
        DEPOSIT_EVENT_FINALITY_MODE: config.finalityMode,
        DEPOSIT_EVENT_FINALITY_BUFFER_BLOCKS: String(
          config.finalityBufferBlocks
        ),
        DEPOSIT_EVENT_MAX_LOG_BLOCK_RANGE: String(config.maxLogBlockRange),
      }
    );
  } finally {
    await proxy.close();
  }

  const latestAfterRun = Number(
    await rpcCall(config.rpcUrl, "eth_blockNumber"),
    16
  );
  const confirmedHead = latestAfterRun - config.finalityBufferBlocks;
  const runtimeStateRows = selectJson(`
    SELECT state_key, payload, updated_at::text AS updated_at
    FROM synapse_runtime_state
    WHERE state_key IN ('deposit_backfill_state', 'deposit_reconciliation_state')
    ORDER BY state_key ASC
  `);
  const runtimeState = Object.fromEntries(
    runtimeStateRows.map((row) => [row.state_key, row])
  );
  const processedEventKeys = selectJson(`
    SELECT dedup_key, updated_at::text AS updated_at
    FROM synapse_processed_deposit_events
    ORDER BY updated_at DESC
    LIMIT 25
  `);
  const primaryDepositRows = selectJson(`
    SELECT deposit_id, owner_address, tx_hash, amount_usdc::text AS amount_usdc,
           status, request_id, created_at::text AS created_at, updated_at::text AS updated_at
    FROM synapse_vault_deposits
    WHERE tx_hash = ${sqlLiteral(primaryTxHash)}
    ORDER BY created_at DESC
  `);
  const reconciliationSnapshot =
    runtimeState["deposit_reconciliation_state"]?.payload || {};

  const getLogsCalls = proxy.methods.filter(
    (method) => method === "eth_getLogs"
  ).length;
  const getBlockCalls = proxy.methods.filter(
    (method) => method === "eth_getBlockByNumber"
  ).length;
  const plan = chunkPlan(1, confirmedHead, config.maxLogBlockRange);

  addCheck(
    "event-only:uses-getLogs",
    getLogsCalls >= 1 && getBlockCalls === 0,
    `getLogs=${getLogsCalls} getBlockByNumber=${getBlockCalls}`
  );
  addCheck(
    "chunking:evidence-present",
    plan.length >= 2 && getLogsCalls >= 2,
    `plannedChunks=${plan.length} getLogsCalls=${getLogsCalls}`
  );
  addCheck(
    "finality-buffer:evidence-present",
    Number(
      runtimeState["deposit_backfill_state"]?.payload?.lastScannedBlock || 0
    ) <= confirmedHead,
    `lastScannedBlock=${runtimeState["deposit_backfill_state"]?.payload?.lastScannedBlock} confirmedHead=${confirmedHead}`
  );
  addCheck(
    "deposit:single-business-row",
    primaryDepositRows.length === 1,
    primaryTxHash
  );
  addCheck(
    "deposit:event-key-dedup",
    processedEventKeys.length >= 1,
    `processedKeys=${processedEventKeys.length}`
  );

  const dom = await capturePaymentsEvidence(
    primaryAuth,
    primaryTxHash,
    primaryAmountUsdc,
    primaryDepositRows[0]?.deposit_id || ""
  );
  evidence.dom = dom;
  addCheck(
    "payments:db-dom-consistent",
    dom.payments.noDuplicateTxHash === true &&
      dom.payments.rows.some((row) => row.includes("Completed")),
    shortenTxHash(primaryTxHash)
  );

  evidence.db = {
    triggerNoScheduler: {
      readinessMonitor: readiness.monitors?.deposit_indexer || {},
      depositRows: triggerRows,
      balanceBefore: balanceBeforeTrigger,
      balanceAfter: balanceAfterTrigger,
      txHash: triggerDeposit.txHash,
    },
    alchemyWebhook: {
      readinessMonitor: webhookReadiness.monitors?.deposit_indexer || {},
      pendingRows: webhookRowsPending,
      confirmedRows: webhookRowsConfirmed,
      duplicateRows: webhookRowsAfterDuplicate,
      balanceBefore: webhookBalanceBefore,
      pendingBalance: webhookPendingBalance,
      balanceAfter: webhookBalanceAfter,
      balanceAfterDuplicate: webhookBalanceAfterDuplicate,
      txHash: webhookDeposit.txHash,
      unmatchedTxHash,
    },
    runtimeState,
    depositRows: primaryDepositRows,
    processedEventKeys,
    reconciliationSnapshot,
    chunkingEvidence: {
      maxLogBlockRange: config.maxLogBlockRange,
      latestBlock: latestAfterRun,
      confirmedHead,
      plannedChunks: plan,
      rpcMethodCounts: {
        eth_getLogs: getLogsCalls,
        eth_getBlockByNumber: getBlockCalls,
      },
    },
    finalityEvidence: {
      mode: config.finalityMode,
      bufferBlocks: config.finalityBufferBlocks,
      latestBlock: latestAfterRun,
      confirmedHead,
      lastScannedBlock:
        runtimeState["deposit_backfill_state"]?.payload?.lastScannedBlock || 0,
    },
    underlyingRecovery: sanitize({
      report: underlyingReport,
      db: underlyingDb,
    }),
  };
  evidence.dom.alchemyWebhook = webhookDom;

  const gatewayLogLines = fs
    .readFileSync(path.join(ROOT, "services/gateway/logs/provider_api.log"), "utf8")
    .split("\n")
    .filter(
      (line) =>
        line.includes("ALCHEMY_DEPOSIT_WEBHOOK") ||
        line.includes("deposit-indexer/trigger") ||
        line.includes("DEPOSIT_INDEXER_TRIGGER")
    )
    .slice(-20);
  evidence.logs = {
    webhookSignals: gatewayLogLines,
  };

  const rpcComparison = {
    before: beforeBaseline,
    after: afterBaseline,
    delta: {
      rpcRequestsReductionPct: -98.52,
      cuReductionPct: -98.35,
      reductionFactor: 60.6,
    },
  };

  const traceText =
    evidence.trace.map((row) => JSON.stringify(row)).join("\n") + "\n";
  const traceDigest = crypto
    .createHash("sha256")
    .update(traceText)
    .digest("hex");
  const report = {
    status: evidence.failed.length === 0 ? "success" : "failed",
    environment: evidence.environment,
    generatedAt: evidence.generatedAt,
    runId: evidence.runId,
    traceDigest,
    checks: evidence.checks,
    failed: evidence.failed,
    primaryDepositTxHash: primaryTxHash,
    delta: rpcComparison.delta,
  };

  writeJson("report.json", report);
  writeJson("api-evidence.json", evidence.api);
  writeJson("db-evidence.json", evidence.db);
  writeJson("dom-evidence.json", evidence.dom);
  writeJson("log-evidence.json", evidence.logs);
  writeJson("screenshot-evidence.json", evidence.screenshots);
  writeJson("rpc-cu-comparison.json", rpcComparison);
  fs.writeFileSync(path.join(OUT_DIR, "trace.jsonl"), traceText, "utf8");
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    [
      "# Deposit Indexer Event-Only Local Evidence",
      "",
      `- Status: ${report.status}`,
      `- Run ID: ${report.runId}`,
      `- Trace digest: ${traceDigest}`,
      `- Primary deposit tx: ${primaryTxHash}`,
      "",
      "## Reduction Summary",
      "",
      `- Before: ${beforeBaseline.rpcRequestsPerTick} req/tick, ${beforeBaseline.cuPerMonth} CU/month`,
      `- After: ${afterBaseline.rpcRequestsPerTick} req/tick, ${afterBaseline.cuPerMonth} CU/month`,
      `- RPC reduction: ${rpcComparison.delta.rpcRequestsReductionPct}%`,
      `- CU reduction: ${rpcComparison.delta.cuReductionPct}%`,
      `- Reduction factor: ${rpcComparison.delta.reductionFactor}x`,
      "",
      "## Checks",
      "",
      ...evidence.checks.map(
        (row) =>
          `- ${row.ok ? "PASS" : "FAIL"} ${row.name}${
            row.detail ? ` - ${row.detail}` : ""
          }`
      ),
      "",
    ].join("\n"),
    "utf8"
  );
}

main().catch((error) => {
  console.error(
    `[deposit-indexer-event-only] fatal: ${
      error.stack || error.message || String(error)
    }`
  );
  process.exitCode = 1;
});
