#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { createAdminWithdrawalApprovalHelpers } from "./admin_withdrawal_approval_helpers.mjs";
import {
  assertProviderOwnsCanonicalService,
  configuredCanonicalServiceId,
  discoverCanonicalProviderService,
} from "./lib/canonical_provider_service.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.join(ROOT, "tmp/admin-withdrawal-approval");
const FIXTURE_PATH = process.env.ADMIN_WITHDRAWAL_APPROVAL_FIXTURE
  ? path.resolve(process.env.ADMIN_WITHDRAWAL_APPROVAL_FIXTURE)
  : path.join(OUT_DIR, "fixture.json");

const GATEWAY_BASE_URL = (
  process.env.GATEWAY_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const ADMIN_GATEWAY_URL = (
  process.env.ADMIN_GATEWAY_URL || "http://127.0.0.1:8300"
).replace(/\/+$/, "");
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const API_BASE = `${GATEWAY_BASE_URL}/api`;
const CHAIN_ID = Number.parseInt(process.env.CHAIN_ID || "31337", 10);
const RUN_ID =
  process.env.ADMIN_WITHDRAWAL_APPROVAL_RUN_ID ||
  `awa-${new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14)}`;
const REQUESTED_DEPOSIT_USDC =
  process.env.ADMIN_WITHDRAWAL_APPROVAL_DEPOSIT_USDC || "150.000000";
const REQUESTED_WITHDRAW_AMOUNT_USDC =
  process.env.ADMIN_WITHDRAWAL_APPROVAL_AMOUNT_USDC || "10.000000";
const REQUESTED_ACTIVE_DIFFERENT_AMOUNT_USDC =
  process.env.ADMIN_WITHDRAWAL_APPROVAL_ACTIVE_DIFFERENT_AMOUNT_USDC ||
  "11.000000";
const CANONICAL_SERVICE_ID = configuredCanonicalServiceId();
const CONSUMER_ETH_TARGET =
  process.env.ADMIN_WITHDRAWAL_APPROVAL_CONSUMER_ETH || "2.0";
const PROVIDER_ETH_TARGET =
  process.env.ADMIN_WITHDRAWAL_APPROVAL_PROVIDER_ETH || "2.0";
const POSTGRES_DSN =
  process.env.GATEWAY_POSTGRES_DSN ||
  process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
  process.env.POSTGRES_DSN ||
  "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway";
const ADMIN_DATABASE_DSN =
  process.env.ADMIN_DATABASE_DSN ||
  process.env.LOCAL_GATEWAY_ADMIN_POSTGRES_DSN ||
  "postgresql://synapse_admin_app:local-dev-admin-app-password@127.0.0.1:15432/synapse_gateway_admin";
const GATEWAY_ADMIN_PYTHON = path.join(
  ROOT,
  "services/gateway-admin/.venv/bin/python"
);
// withdrawal status source: services/gateway provider withdrawal state machine and synapse_vault_withdrawals.status.

const ADMIN_COOKIE_NAME =
  process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "cliff@synapse-network.ai";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "qwer@1234";
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET || "JBSWY3DPEHPK3PXP";

const DEFAULT_KEYS = {
  deployer:
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  consumer:
    "0x7c852118294f1a460a80c7c33d7409ea91c8436518e91e202d1f5f9e3544eb07",
  provider:
    "0x47e179ec197488bf6f785afa0fc15f4dee1a74f3f44fffedce27f84d349a926a",
};

const DEPLOYER_KEY = process.env.DEPLOYER_KEY || DEFAULT_KEYS.deployer;
const CONSUMER_KEY =
  process.env.CONSUMER_KEY || ethers.Wallet.createRandom().privateKey;

function readLocalProviderOnboardingKey() {
  if (!isLocalUrl(GATEWAY_BASE_URL) || !isLocalUrl(ADMIN_GATEWAY_URL)) {
    return "";
  }
  const onboardingEnvPath = path.resolve(
    ROOT,
    "../Synapse-Network-Provider/.env.onboarding.local"
  );
  if (!fs.existsSync(onboardingEnvPath)) {
    return "";
  }
  const match = fs
    .readFileSync(onboardingEnvPath, "utf8")
    .match(/^SYNAPSE_PROVIDER_OWNER_PRIVATE_KEY=(.+)$/m);
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") || "";
}

const PROVIDER_KEY =
  process.env.PROVIDER_KEY ||
  process.env.GATEWAY_E2E_PROVIDER_KEY ||
  readLocalProviderOnboardingKey() ||
  ethers.Wallet.createRandom().privateKey;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(message) {
  console.log(`[admin-withdrawal-seed] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function runPsql(sql) {
  const result = spawnSync(
    "psql",
    [POSTGRES_DSN, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      cwd: ROOT,
      encoding: "utf8",
    }
  );
  if (result.status !== 0) {
    fail(`psql failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout.trim();
}

function parseUsdcAtomic(value) {
  return ethers.parseUnits(String(value || "0"), 6);
}

function formatUsdcAtomic(value) {
  return Number(ethers.formatUnits(value, 6)).toFixed(6);
}

function readWithdrawalAutoSingleLimitUsdc() {
  try {
    return (
      runPsql(`
        SELECT COALESCE(payload #>> '{risk,withdrawalAutoSingleLimitUsdc}', '')
        FROM synapse_business_policy_config
        ORDER BY updated_at DESC
        LIMIT 1
      `) || ""
    ).trim();
  } catch {
    return "";
  }
}

function resolveManualReviewWithdrawalPlan() {
  const configuredSingleLimitUsdc =
    readWithdrawalAutoSingleLimitUsdc() ||
    process.env.WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC ||
    "100.000000";
  const requestedWithdrawAmountAtomic = parseUsdcAtomic(
    REQUESTED_WITHDRAW_AMOUNT_USDC
  );
  const singleLimitAtomic = configuredSingleLimitUsdc
    ? parseUsdcAtomic(configuredSingleLimitUsdc)
    : 0n;
  const minimumManualReviewAtomic =
    singleLimitAtomic > 0n
      ? singleLimitAtomic + parseUsdcAtomic("1.000000")
      : requestedWithdrawAmountAtomic;
  const withdrawAmountAtomic =
    requestedWithdrawAmountAtomic >= minimumManualReviewAtomic
      ? requestedWithdrawAmountAtomic
      : minimumManualReviewAtomic;
  const requestedDepositAtomic = parseUsdcAtomic(REQUESTED_DEPOSIT_USDC);
  const minimumDepositAtomic =
    withdrawAmountAtomic + parseUsdcAtomic("20.000000");
  const depositAmountAtomic =
    requestedDepositAtomic >= minimumDepositAtomic
      ? requestedDepositAtomic
      : minimumDepositAtomic;
  const requestedActiveDifferentAmountAtomic = parseUsdcAtomic(
    REQUESTED_ACTIVE_DIFFERENT_AMOUNT_USDC
  );
  const activeDifferentAmountAtomic =
    requestedActiveDifferentAmountAtomic > withdrawAmountAtomic
      ? requestedActiveDifferentAmountAtomic
      : withdrawAmountAtomic + parseUsdcAtomic("1.000000");
  return {
    configuredSingleLimitUsdc: configuredSingleLimitUsdc || null,
    depositAmountUsdc: formatUsdcAtomic(depositAmountAtomic),
    withdrawAmountUsdc: formatUsdcAtomic(withdrawAmountAtomic),
    activeDifferentAmountUsdc: formatUsdcAtomic(activeDifferentAmountAtomic),
  };
}

function readBusinessPolicyConfigRow() {
  const raw = runPsql(`
    SELECT COALESCE(
      json_build_object(
        'exists', true,
        'payload', payload,
        'publishedVersion', published_version,
        'updatedBy', updated_by
      )::text,
      ''
    )
    FROM synapse_business_policy_config
    WHERE singleton_id = 1
    LIMIT 1
  `);
  return raw ? JSON.parse(raw) : { exists: false };
}

function ensureLocalProviderManualReviewPolicy(desiredSingleLimitUsdc = "1.000000") {
  if (!isLocalUrl(GATEWAY_BASE_URL) || !isLocalUrl(ADMIN_GATEWAY_URL)) {
    return null;
  }
  const original = readBusinessPolicyConfigRow();
  const currentSingleLimitUsdc = String(
    original?.payload?.risk?.withdrawalAutoSingleLimitUsdc || ""
  ).trim();
  if (
    currentSingleLimitUsdc &&
    parseUsdcAtomic(currentSingleLimitUsdc) <=
      parseUsdcAtomic(desiredSingleLimitUsdc)
  ) {
    return { original, applied: false };
  }
  runPsql(`
    INSERT INTO synapse_business_policy_config (
      singleton_id, payload, published_version, updated_at, updated_by
    )
    VALUES (
      1,
      jsonb_build_object(
        'risk',
        jsonb_build_object('withdrawalAutoSingleLimitUsdc', ${sqlLiteral(desiredSingleLimitUsdc)})
      ),
      1,
      NOW(),
      'admin-withdrawal-approval-local'
    )
    ON CONFLICT (singleton_id) DO UPDATE
    SET payload = jsonb_set(
          COALESCE(synapse_business_policy_config.payload, '{}'::jsonb),
          '{risk,withdrawalAutoSingleLimitUsdc}',
          to_jsonb(${sqlLiteral(desiredSingleLimitUsdc)}::text),
          true
        ),
        updated_at = NOW(),
        updated_by = 'admin-withdrawal-approval-local'
  `);
  log(
    `local business policy override applied: withdrawalAutoSingleLimitUsdc=${desiredSingleLimitUsdc}`
  );
  return { original, applied: true };
}

function restoreLocalProviderManualReviewPolicy(handle) {
  if (!handle || !handle.applied) {
    return;
  }
  if (!handle.original?.exists) {
    runPsql(`
      DELETE FROM synapse_business_policy_config
      WHERE singleton_id = 1
        AND updated_by = 'admin-withdrawal-approval-local'
    `);
    log("local business policy override removed");
    return;
  }
  runPsql(`
    UPDATE synapse_business_policy_config
    SET payload = ${sqlLiteral(JSON.stringify(handle.original.payload || {}))}::jsonb,
        published_version = ${Number(handle.original.publishedVersion || 1)},
        updated_at = NOW(),
        updated_by = ${sqlLiteral(String(handle.original.updatedBy || "restored"))}
    WHERE singleton_id = 1
  `);
  log("local business policy override restored");
}

function restartLocalGatewayRuntime(reason) {
  if (!isLocalUrl(GATEWAY_BASE_URL) || !isLocalUrl(ADMIN_GATEWAY_URL)) {
    return;
  }
  log(`restarting local gateway runtime (${reason})`);
  const result = spawnSync("bash", ["scripts/local/restart_gateway.sh"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC:
        process.env.WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC || "1.000000",
    },
  });
  if (result.status !== 0) {
    fail(
      `restart_gateway.sh failed during ${reason}: ${(
        result.stderr ||
        result.stdout ||
        ""
      ).trim()}`
    );
  }
}

function queryAdminTotpSecretFromLocalDb() {
  if (
    process.env.ADMIN_TOTP_SECRET ||
    !isLocalUrl(GATEWAY_BASE_URL) ||
    !isLocalUrl(ADMIN_GATEWAY_URL)
  ) {
    return null;
  }
  const sql = `
    SELECT json_build_object(
      'totpSecret', f.payload_json ->> 'totpSecret',
      'secretRef', f.secret_ref
    )
    FROM admin_users u
    JOIN admin_mfa_factors f ON f.admin_id = u.admin_id
    WHERE u.email = ${sqlLiteral(ADMIN_EMAIL)}
      AND f.status = 'active'
    ORDER BY f.created_at DESC
    LIMIT 1;
  `;
  const result = spawnSync(
    "psql",
    [
      ADMIN_DATABASE_DSN,
      "-X",
      "-q",
      "-t",
      "-A",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
    }
  );
  if (result.status !== 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(result.stdout.trim() || "null");
    const inlineSecret = String(parsed?.totpSecret || "").trim();
    if (inlineSecret) {
      return inlineSecret;
    }
    const secretRef = String(parsed?.secretRef || "").trim();
    if (
      secretRef &&
      secretRef.startsWith("inline-fernet:v1:") &&
      fs.existsSync(GATEWAY_ADMIN_PYTHON)
    ) {
      const decrypted = spawnSync(
        GATEWAY_ADMIN_PYTHON,
        [
          "-c",
          [
            "import sys",
            `sys.path.insert(0, ${JSON.stringify(
              path.join(ROOT, "services/gateway-admin")
            )})`,
            "from src.core.totp_secret_store import decrypt_inline_totp_secret_ref",
            "print(decrypt_inline_totp_secret_ref(sys.argv[1]))",
          ].join("; "),
          secretRef,
        ],
        {
          cwd: ROOT,
          encoding: "utf8",
        }
      );
      if (decrypted.status === 0) {
        const value = decrypted.stdout.trim();
        if (value) {
          return value;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
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
      !isLocalUrl(ADMIN_GATEWAY_URL))
  ) {
    fail(
      "Refusing to use default local test keys against non-local endpoints."
    );
  }
  if (
    (ADMIN_PASSWORD === "qwer@1234" ||
      ADMIN_TOTP_SECRET === "JBSWY3DPEHPK3PXP") &&
    !isLocalUrl(ADMIN_GATEWAY_URL)
  ) {
    fail(
      "Refusing to use default admin credentials against a non-local admin gateway."
    );
  }
}

async function assertReachable(name, url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= (options.attempts || 4); attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs || 15000
    );
    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        signal: controller.signal,
        body: options.body,
        headers: options.headers,
      });
      if (!response.ok && !options.allowNonOk) {
        fail(
          `${name} not ready: ${response.status} ${response.statusText} at ${url}`
        );
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < (options.attempts || 4)) {
        log(`${name} reachability retry ${attempt}: ${error.message}`);
        await sleep(1000);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  fail(
    `${name} not reachable at ${url}. ${lastError?.message || "unknown error"}`
  );
}

async function api(
  pathname,
  { method = "GET", token, address, body, headers = {}, expectOk = true } = {}
) {
  const requestHeaders = { Accept: "application/json", ...headers };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (address) requestHeaders["X-User-Address"] = address;

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
  if (expectOk && !response.ok) {
    fail(
      `${method} ${pathname} failed: ${response.status} ${JSON.stringify(
        payload
      ).slice(0, 800)}`
    );
  }
  return { response, payload };
}

async function authenticate(privateKey, label) {
  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address;
  const challengeResponse = await api(
    `/v1/auth/challenge?address=${encodeURIComponent(address)}`
  );
  const message =
    challengeResponse.payload.challenge || challengeResponse.payload.message;
  if (!message) fail(`${label} auth challenge missing message`);
  const signature = await wallet.signMessage(message);
  const verified = await api("/v1/auth/verify", {
    method: "POST",
    body: { wallet_address: address, message, signature },
  });
  const token =
    verified.payload.access_token ||
    verified.payload.token ||
    verified.payload.accessToken;
  if (!token) fail(`${label} auth verification did not return a token`);
  log(`${label} authenticated as ${address}`);
  return {
    address,
    token,
    privateKey,
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
  if (chainId !== CHAIN_ID)
    fail(`RPC chainId mismatch. Expected ${CHAIN_ID}, got ${chainId}.`);
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

async function sendWithRetry(label, makeTx, attempts = 4) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await makeTx();
    } catch (error) {
      lastError = error;
      if (
        !/nonce|replacement|underpriced|already known|transaction underpriced/i.test(
          error.message || ""
        )
      ) {
        throw error;
      }
      log(`${label} retry ${i + 1}/${attempts}: ${error.message}`);
      await sleep(750);
    }
  }
  throw lastError;
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

function atomicToDecimal(value, decimals = 6) {
  const atomic = BigInt(value || 0);
  const scale = 10n ** BigInt(decimals);
  const sign = atomic < 0n ? "-" : "";
  const abs = atomic < 0n ? -atomic : atomic;
  return `${sign}${abs / scale}.${String(abs % scale).padStart(decimals, "0")}`;
}

function moneyFromObject(object, keys, fallback = "0") {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null)
      return String(object[key]);
  }
  return fallback;
}

async function topUpEthIfNeeded({
  targetAddress,
  targetEth,
  deployer,
  provider,
  label,
}) {
  const current = await provider.getBalance(targetAddress);
  const target = ethers.parseEther(targetEth);
  if (current >= target) return null;
  const tx = await sendWithRetry(`${label}-eth-topup`, async () =>
    deployer.sendTransaction({ to: targetAddress, value: target - current })
  );
  await tx.wait();
  log(`${label} ETH top-up confirmed to ${targetEth} ETH`);
  return tx.hash;
}

async function fundAndDeposit({ consumerAddress, providerAddress, amountUsdc }) {
  const { provider, coreAbi, usdcAbi, usdcAddress, coreAddress } =
    await getChainContext();
  const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
  const consumer = new ethers.Wallet(CONSUMER_KEY, provider);
  const usdcDeployer = new ethers.Contract(usdcAddress, usdcAbi, deployer);
  const usdcConsumer = new ethers.Contract(usdcAddress, usdcAbi, consumer);
  const coreConsumer = new ethers.Contract(coreAddress, coreAbi, consumer);
  const decimals = Number(await usdcDeployer.decimals());
  const amountAtomic = ethers.parseUnits(amountUsdc, decimals);

  const consumerEthTopupTx = await topUpEthIfNeeded({
    targetAddress: consumerAddress,
    targetEth: CONSUMER_ETH_TARGET,
    deployer,
    provider,
    label: "consumer",
  });
  const providerEthTopupTx = await topUpEthIfNeeded({
    targetAddress: providerAddress,
    targetEth: PROVIDER_ETH_TARGET,
    deployer,
    provider,
    label: "provider",
  });

  const mintTx = await sendWithRetry("mint-usdc", async () =>
    usdcDeployer.mint(consumerAddress, amountAtomic)
  );
  await mintTx.wait();
  log(`${amountUsdc} MockUSDC minted for consumer`);

  const approveTx = await sendWithRetry("approve-usdc", async () =>
    usdcConsumer.approve(coreAddress, amountAtomic)
  );
  await approveTx.wait();
  log("SynapseCore approval confirmed");

  const depositTx = await sendWithRetry("deposit", async () =>
    coreConsumer.deposit(amountAtomic)
  );
  const receipt = await depositTx.wait();
  if (receipt?.status !== 1)
    fail(`deposit transaction failed: ${depositTx.hash}`);
  log(`chain deposit confirmed: ${depositTx.hash}`);
  return {
    txHash: depositTx.hash,
    amountUsdc,
    decimals,
    coreAddress,
    usdcAddress,
    consumerEthTopupTx,
    providerEthTopupTx,
  };
}

async function registerDepositIntent({ token, address, txHash, amountUsdc }) {
  const result = await api("/v1/balance/deposit/intent", {
    method: "POST",
    token,
    address,
    headers: {
      "X-Idempotency-Key": `awa-deposit-${txHash
        .replace(/^0x/, "")
        .slice(0, 80)}`,
    },
    body: { txHash, amountUsdc },
  });
  log(
    `deposit intent registered: ${
      result.payload.intent?.id || result.payload.id || txHash
    }`
  );
  return result.payload;
}

async function confirmLocalDepositIntent({
  token,
  address,
  depositIntent,
  txHash,
}) {
  const depositIntentId = depositIntent.intent?.id || depositIntent.id;
  if (!depositIntentId)
    fail(
      `deposit intent response missing id: ${JSON.stringify(
        depositIntent
      ).slice(0, 600)}`
    );
  const confirmed = await api(
    `/v1/balance/deposit/intents/${encodeURIComponent(
      depositIntentId
    )}/confirm`,
    {
      method: "POST",
      token,
      address,
      body: {
        eventKey: `admin-withdrawal-approval:${String(txHash).toLowerCase()}`,
        confirmations: 1,
      },
    }
  );
  log(`deposit intent confirmed locally: ${depositIntentId}`);
  return confirmed.payload;
}

async function waitForBalanceAtLeast({ token, address, expectedUsdc, txHash }) {
  const expected = decimalToAtomic(expectedUsdc);
  let lastBalance = "0";
  for (let i = 0; i < 40; i += 1) {
    await api(
      `/v1/balance/deposit/sync?txHash=${encodeURIComponent(
        String(txHash).toLowerCase()
      )}`,
      {
        token,
        address,
        expectOk: false,
      }
    ).catch(() => null);
    const payload = (await api("/v1/balance", { token, address })).payload;
    const balance = payload.balance || {};
    lastBalance = String(
      balance.consumerAvailableBalance ?? balance.ownerBalance ?? "0"
    );
    if (decimalToAtomic(lastBalance) >= expected) {
      log(`consumer gateway balance synced: ${lastBalance} USDC`);
      return payload;
    }
    await sleep(1500);
  }
  fail(
    `consumer balance did not reach ${expectedUsdc} USDC; last=${lastBalance}`
  );
}

function matureProviderChargeLedger({ providerAddress, invocationId }) {
  const updated = runPsql(`
    WITH target_provider AS (
      SELECT la.account_id
      FROM synapse_ledger_accounts la
      JOIN synapse_owner_accounts oa ON oa.owner_id = la.owner_id
      WHERE lower(oa.owner_wallet) = lower(${sqlLiteral(providerAddress)})
        AND la.account_kind = 'provider_wallet'
      LIMIT 1
    ),
    updated AS (
      UPDATE synapse_ledger_entries entry
      SET created_at = NOW() - INTERVAL '8 days'
      WHERE entry.credit_account_id = (SELECT account_id FROM target_provider)
        AND entry.business_type = 'charge'
        AND entry.status = 'posted'
        AND entry.created_at >= NOW() - INTERVAL '2 hours'
        AND (
          entry.reference_id = ${sqlLiteral(invocationId)}
          OR ${sqlLiteral(invocationId)} = ''
        )
      RETURNING entry.entry_id
    )
    SELECT COUNT(*) FROM updated
  `);
  if (Number.parseInt(updated || "0", 10) < 1) {
    fail(
      `No provider charge ledger row matured for invocation ${invocationId}`
    );
  }
  log(`provider charge ledger matured for T+7 withdrawal: ${updated} row(s)`);
}

async function readProviderCapability(auth) {
  const payload = (await api("/v1/providers/earnings/summary?limit=20", auth))
    .payload;
  return payload.summary || payload;
}

async function readProviderWithdrawals(auth) {
  return (
    (await api("/v1/providers/withdrawals?limit=50", auth)).payload
      .withdrawals || []
  );
}

function releaseStaleAdminApprovalWithdrawals(providerAddress) {
  if (!isLocalUrl(GATEWAY_BASE_URL) || !isLocalUrl(ADMIN_GATEWAY_URL)) {
    return { released: 0, amountUsdc: "0.000000" };
  }
  const raw = runPsql(`
    WITH target AS (
      SELECT
        vw.withdrawal_id,
        vw.amount_usdc,
        vw.source_account_id,
        vw.status
      FROM synapse_vault_withdrawals vw
      JOIN synapse_owner_accounts owner ON owner.owner_id = vw.owner_id
      JOIN synapse_runtime_state state
        ON state.state_key = CONCAT('vault_withdrawal_meta::', vw.withdrawal_id)
      WHERE lower(owner.owner_wallet) = lower(${sqlLiteral(providerAddress)})
        AND vw.withdrawal_kind = 'provider_withdrawal'
        AND vw.status NOT IN ('FAILED', 'FAILED_EXPIRED', 'REJECTED', 'CANCELLED', 'COMPLETED')
        AND COALESCE(state.payload ->> 'idempotencyKey', '') LIKE 'admin-withdrawal-approval:%'
    ),
    balance_release AS (
      UPDATE synapse_account_balances balance
      SET
        available_balance = balance.available_balance + target.amount_usdc,
        pending_balance = CASE
          WHEN target.status IN ('REQUESTED', 'SIGNED', 'APPROVED_AUTO')
            THEN GREATEST(0, balance.pending_balance - target.amount_usdc)
          ELSE balance.pending_balance
        END,
        frozen_balance = CASE
          WHEN target.status = 'PENDING_MANUAL_REVIEW'
            THEN GREATEST(0, balance.frozen_balance - target.amount_usdc)
          ELSE balance.frozen_balance
        END,
        updated_at = NOW()
      FROM target
      WHERE balance.account_id = target.source_account_id
      RETURNING target.withdrawal_id, target.amount_usdc
    ),
    withdrawal_release AS (
      UPDATE synapse_vault_withdrawals vw
      SET status = 'FAILED_EXPIRED', updated_at = NOW()
      WHERE vw.withdrawal_id IN (SELECT withdrawal_id FROM target)
      RETURNING vw.withdrawal_id
    ),
    metadata_release AS (
      UPDATE synapse_runtime_state state
      SET
        payload = jsonb_set(
          jsonb_set(state.payload, '{flowStatus}', '"FAILED_EXPIRED"', true),
          '{message}',
          '"Local admin withdrawal approval E2E released stale active fixture before reseeding."',
          true
        ),
        updated_at = NOW()
      WHERE state.state_key IN (
        SELECT CONCAT('vault_withdrawal_meta::', withdrawal_id) FROM target
      )
      RETURNING state.state_key
    )
    SELECT json_build_object(
      'released', COALESCE((SELECT COUNT(*) FROM withdrawal_release), 0),
      'amountUsdc', COALESCE((SELECT SUM(amount_usdc) FROM balance_release), 0)::text
    )::text;
  `);
  const payload = raw ? JSON.parse(raw) : { released: 0, amountUsdc: "0" };
  if (Number(payload.released || 0) > 0) {
    log(
      `released ${payload.released} stale admin withdrawal approval fixture(s), amount=${payload.amountUsdc} USDC`
    );
  }
  return payload;
}

async function createWithdrawal(
  auth,
  { amountUsdc, idempotencyKey, expectOk = true }
) {
  let lastResult = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = await api("/v1/providers/withdrawals/intent", {
      method: "POST",
      token: auth.token,
      address: auth.address,
      headers: { "X-Idempotency-Key": idempotencyKey },
      body: { amountUsdc },
      expectOk: false,
    });
    lastResult = result;
    const code = result.payload?.detail?.code || result.payload?.error?.code;
    if (
      result.response.status === 503 &&
      code === "WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE" &&
      attempt < 5
    ) {
      log(`withdraw intent liquidity precheck retry ${attempt}/5`);
      await sleep(1000);
      continue;
    }
    if (expectOk && !result.response.ok) {
      fail(
        `POST /v1/providers/withdrawals/intent failed: ${
          result.response.status
        } ${JSON.stringify(result.payload).slice(0, 800)}`
      );
    }
    return result;
  }
  return lastResult;
}

function promoteWithdrawalForAdminQueue(withdrawalId) {
  if (!isLocalUrl(GATEWAY_BASE_URL) || !isLocalUrl(ADMIN_GATEWAY_URL)) {
    return null;
  }
  const promotedAt = runPsql(`
    WITH updated AS (
      UPDATE synapse_vault_withdrawals
      SET created_at = NOW() + INTERVAL '20 years',
          updated_at = NOW() + INTERVAL '20 years'
      WHERE withdrawal_id = ${sqlLiteral(withdrawalId)}
      RETURNING created_at
    )
    SELECT COALESCE((SELECT created_at::text FROM updated), '');
  `);
  if (promotedAt) {
    log(`promoted withdrawal ${withdrawalId} to admin queue front`);
  }
  return promotedAt || null;
}

async function generateMatureProviderReceivable({
  credentialToken,
  providerAuth,
  service,
  targetUsdc,
}) {
  const targetAtomic = decimalToAtomic(targetUsdc);
  const invocations = [];
  const initialCapability = await readProviderCapability(providerAuth);
  const initialMatureReceivable = moneyFromObject(
    initialCapability,
    [
      "providerMatureReceivable",
      "providerMatureWithdrawable",
      "withdrawableReceivable",
    ],
    "0"
  );
  log(
    `provider mature receivable before invoke: ${initialMatureReceivable} USDC`
  );
  if (decimalToAtomic(initialMatureReceivable) >= targetAtomic) {
    return {
      invocations,
      capability: initialCapability,
      source: "existing-mature-receivable",
    };
  }

  for (let index = 1; index <= 40; index += 1) {
    const invocation = await invokeService({
      credentialToken,
      service,
      sequence: index,
    });
    matureProviderChargeLedger({
      providerAddress: providerAuth.address,
      invocationId: invocation.invocationId,
    });
    invocations.push(invocation);

    const capability = await readProviderCapability(providerAuth);
    const matureReceivable = moneyFromObject(
      capability,
      [
        "providerMatureReceivable",
        "providerMatureWithdrawable",
        "withdrawableReceivable",
      ],
      "0"
    );
    log(
      `provider mature receivable after invoke ${index}: ${matureReceivable} USDC`
    );
    if (decimalToAtomic(matureReceivable) >= targetAtomic) {
      return { invocations, capability, source: "canonical-paid-invoke" };
    }
  }
  fail(
    `Canonical service ${service.id} did not generate ${targetUsdc} USDC matured provider receivable after ${invocations.length} invocations.`
  );
}

const {
  adminApi,
  invalidInternalTokenReview,
  invokeService,
  issueAgentCredential,
  issueProviderSecret,
  loginAdmin,
  readChainBalances,
} = createAdminWithdrawalApprovalHelpers({
  adminCookieName: ADMIN_COOKIE_NAME,
  adminEmail: ADMIN_EMAIL,
  adminGatewayUrl: ADMIN_GATEWAY_URL,
  adminPassword: ADMIN_PASSWORD,
  adminTotpSecret: queryAdminTotpSecretFromLocalDb() || ADMIN_TOTP_SECRET,
  api,
  apiBase: API_BASE,
  ethers,
  fail,
  getChainContext,
  log,
  moneyFromObject,
  runId: RUN_ID,
  sleep,
});

async function main() {
  assertLocalOnly();
  await assertReachable("gateway health", `${GATEWAY_BASE_URL}/health`);
  await assertReachable("gateway-admin health", `${ADMIN_GATEWAY_URL}/health`);
  await assertReachable("rpc", RPC_URL, { method: "POST", allowNonOk: true });

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manualReviewPolicyHandle = ensureLocalProviderManualReviewPolicy();
  try {
    if (manualReviewPolicyHandle?.applied) {
      restartLocalGatewayRuntime("business policy override");
      await assertReachable("gateway health", `${GATEWAY_BASE_URL}/health`);
      await assertReachable(
        "gateway-admin health",
        `${ADMIN_GATEWAY_URL}/health`
      );
    }

    const providerAuth = await authenticate(PROVIDER_KEY, "provider");
    const consumerAuth = await authenticate(CONSUMER_KEY, "consumer");
    const adminAuth = await loginAdmin();
    const chain = await getChainContext();
    const staleRelease = releaseStaleAdminApprovalWithdrawals(
      providerAuth.address
    );
    const withdrawalPlan = resolveManualReviewWithdrawalPlan();
    log(
      `withdrawal plan amount=${withdrawalPlan.withdrawAmountUsdc} activeDifferent=${withdrawalPlan.activeDifferentAmountUsdc} deposit=${withdrawalPlan.depositAmountUsdc} singleLimit=${withdrawalPlan.configuredSingleLimitUsdc || "fallback"}`
    );
    const service = await discoverCanonicalProviderService({
      api,
      serviceId: CANONICAL_SERVICE_ID,
      fail,
      log,
      sleep,
    });
    await assertProviderOwnsCanonicalService({
      api,
      auth: providerAuth,
      serviceId: service.id,
      fail,
      log,
    });
    const providerSecret = await issueProviderSecret(providerAuth);

    const deposit = await fundAndDeposit({
      consumerAddress: consumerAuth.address,
      providerAddress: providerAuth.address,
      amountUsdc: withdrawalPlan.depositAmountUsdc,
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
    const credential = await issueAgentCredential(consumerAuth);
    const receivableGeneration = await generateMatureProviderReceivable({
      credentialToken: credential.token,
      providerAuth,
      service,
      targetUsdc: withdrawalPlan.withdrawAmountUsdc,
    });

    const capabilityBeforeWithdraw = receivableGeneration.capability;
    const chainBeforeWithdraw = await readChainBalances(providerAuth.address);
    const primaryKey = `admin-withdrawal-approval:${RUN_ID}:primary`;
    const withdrawalResult = await createWithdrawal(providerAuth, {
      amountUsdc: withdrawalPlan.withdrawAmountUsdc,
      idempotencyKey: primaryKey,
    });
    const withdrawal = withdrawalResult.payload;
    if (withdrawal.status !== "PENDING_MANUAL_REVIEW") {
      fail(
        `Expected withdrawal to enter PENDING_MANUAL_REVIEW. Got ${withdrawal.status}. Start gateway with WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC=1.000000.`
      );
    }
    if (withdrawal.ticket && Object.keys(withdrawal.ticket).length > 0) {
      fail("Manual review withdrawal returned a ticket before approval.");
    }
    const promotedWithdrawalCreatedAt = promoteWithdrawalForAdminQueue(
      withdrawal.withdrawalId
    );

    const capabilityAfterRequest = await readProviderCapability(providerAuth);
    const withdrawalsAfterRequest = await readProviderWithdrawals(providerAuth);
    const duplicateSameKey = await createWithdrawal(providerAuth, {
      amountUsdc: withdrawalPlan.withdrawAmountUsdc,
      idempotencyKey: primaryKey,
    });
    if (duplicateSameKey.payload.withdrawalId !== withdrawal.withdrawalId) {
      fail(
        `Same idempotency key returned different withdrawalId: ${duplicateSameKey.payload.withdrawalId}`
      );
    }

    const duplicateActiveSameAmount = await createWithdrawal(providerAuth, {
      amountUsdc: withdrawalPlan.withdrawAmountUsdc,
      idempotencyKey: `admin-withdrawal-approval:${RUN_ID}:active-same-amount`,
    });
    if (
      duplicateActiveSameAmount.payload.withdrawalId !== withdrawal.withdrawalId
    ) {
      fail(
        `Active same-amount withdrawal returned different withdrawalId: ${duplicateActiveSameAmount.payload.withdrawalId}`
      );
    }

    const duplicateActiveDifferentAmount = await createWithdrawal(providerAuth, {
      amountUsdc: withdrawalPlan.activeDifferentAmountUsdc,
      idempotencyKey: `admin-withdrawal-approval:${RUN_ID}:active-different-amount`,
      expectOk: false,
    });
    if (duplicateActiveDifferentAmount.response.ok) {
      fail("Active different-amount withdrawal unexpectedly succeeded.");
    }

    const invalidInternalToken = await invalidInternalTokenReview({
      withdrawalId: withdrawal.withdrawalId,
      ownerAddress: providerAuth.address,
    });
    const adminQueue = await adminApi(
      `/api/admin/v1/withdrawal-reviews?limit=100&q=${encodeURIComponent(
        withdrawal.withdrawalId
      )}`,
      adminAuth
    );
    const projected = (adminQueue.items || []).find(
      (item) => item.withdrawalId === withdrawal.withdrawalId
    );
    if (!projected) {
      fail(
        `gateway-admin did not project withdrawal ${withdrawal.withdrawalId} into /withdrawal-reviews.`
      );
    }

    const fixture = {
    version: 1,
    mode: "admin-withdrawal-approval-provider",
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    baseUrls: {
      gateway: GATEWAY_BASE_URL,
      adminGateway: ADMIN_GATEWAY_URL,
      rpc: RPC_URL,
    },
    chain: {
      chainId: chain.chainId,
      synapseCore: chain.coreAddress,
      mockUSDC: chain.usdcAddress,
    },
    auth: adminAuth,
    consumer: consumerAuth,
    provider: providerAuth,
    providerSecret,
    service,
    credential,
    deposit: {
      txHash: deposit.txHash,
      amountUsdc: deposit.amountUsdc,
      intentId: depositIntent.intent?.id || depositIntent.id || null,
      confirmedIntentId:
        confirmedDeposit.intent?.id || confirmedDeposit.id || null,
    },
    invocation: receivableGeneration.invocations.at(-1),
    invocations: receivableGeneration.invocations,
    receivableSource: receivableGeneration.source,
    withdrawal: {
      withdrawalId: withdrawal.withdrawalId,
      amountUsdc: withdrawalPlan.withdrawAmountUsdc,
      idempotencyKey: primaryKey,
      expectedAmountAtomic: String(
        decimalToAtomic(withdrawalPlan.withdrawAmountUsdc, 18)
      ),
      initialStatus: withdrawal.status,
      message: withdrawal.message || "",
    },
    expected: {
      manualReviewStatus: "PENDING_MANUAL_REVIEW",
      approvedStatus: "APPROVED_AUTO",
      completedStatus: "COMPLETED",
      amountUsdc: withdrawalPlan.withdrawAmountUsdc,
      amountAtomic: String(
        decimalToAtomic(withdrawalPlan.withdrawAmountUsdc, 18)
      ),
    },
    snapshots: {
      staleRelease,
      promotedWithdrawalCreatedAt,
      balanceBeforeInvoke: balanceBeforeInvoke.balance || balanceBeforeInvoke,
      capabilityBeforeWithdraw,
      capabilityAfterRequest,
      chainBeforeWithdraw,
      withdrawalsAfterRequest,
      adminProjectedReview: projected,
    },
    securityChecks: {
      duplicateSameKey: {
        status: duplicateSameKey.response.status,
        withdrawalId: duplicateSameKey.payload.withdrawalId,
      },
      duplicateActiveSameAmount: {
        status: duplicateActiveSameAmount.response.status,
        withdrawalId: duplicateActiveSameAmount.payload.withdrawalId,
      },
      duplicateActiveDifferentAmount: {
        status: duplicateActiveDifferentAmount.response.status,
        payload: duplicateActiveDifferentAmount.payload,
      },
      invalidInternalToken,
    },
    };

    fs.writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
    log(`fixture written: ${FIXTURE_PATH}`);
    log(`withdrawal ready for admin approval: ${withdrawal.withdrawalId}`);
  } finally {
    restoreLocalProviderManualReviewPolicy(manualReviewPolicyHandle);
    if (manualReviewPolicyHandle?.applied) {
      restartLocalGatewayRuntime("business policy restore");
    }
  }
}

main().catch((error) => {
  console.error(
    `[admin-withdrawal-seed] fatal: ${
      error.stack || error.message || String(error)
    }`
  );
  process.exit(1);
});
