import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import {
  generateTotpCode,
  waitForSafeTotpWindow,
} from "../lib/totp_window.mjs";
import { assertSeedEnvironment } from "./seed_env_guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "../..");
export const GENERATED_AT = new Date();
export const TIMESTAMP = GENERATED_AT.toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");
export const RUN_ID =
  process.env.STAGING_CORE_DOGFOOD_RUN_ID ||
  `staging-core-${Date.now().toString(36)}`;
export const OUT_DIR = path.resolve(
  process.env.STAGING_CORE_DOGFOOD_EVIDENCE_DIR ||
    path.join(
      ROOT,
      "docs/evidence/staging/core-dogfood",
      `${TIMESTAMP}-staging-core-dogfood`
    )
);
export const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");

export const config = {
  projectId: process.env.PROJECT_ID || "fabled-archive-494108-k5",
  region: process.env.REGION || "us-central1",
  gatewayBase: stripSlash(
    process.env.GATEWAY_E2E_GATEWAY_BASE ||
      "https://api-staging.synapse-network.ai"
  ),
  userFrontUrl: stripSlash(
    process.env.STAGING_USER_FRONT_URL || "https://staging.synapse-network.ai"
  ),
  adminFrontUrl: stripSlash(
    process.env.STAGING_ADMIN_FRONT_URL ||
      "https://admin-staging.synapse-network.ai"
  ),
  adminApiUrl: stripSlash(
    process.env.STAGING_ADMIN_API_URL ||
      "https://admin-api-staging.synapse-network.ai"
  ),
  postgresDsn: process.env.POSTGRES_DSN || "",
  rpcUrl: process.env.GATEWAY_E2E_RPC_URL || "",
  consumerKey: process.env.GATEWAY_E2E_OWNER_KEY || "",
  providerKey: process.env.GATEWAY_E2E_PROVIDER_KEY || "",
  adminEmail:
    process.env.STAGING_ADMIN_E2E_EMAIL ||
    "staging-admin-e2e@synapse-network.ai",
  adminPassword: process.env.STAGING_ADMIN_E2E_PASSWORD || "",
  adminTotpSecret: process.env.STAGING_ADMIN_E2E_OTP_SECRET || "",
  adminCookieName:
    process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session",
  contractConfigPath:
    process.env.GATEWAY_E2E_CONTRACT_CONFIG_PATH ||
    "services/user-front/src/contract-config.arbitrum-sepolia.example.json",
  depositUsdc: process.env.STAGING_CORE_DOGFOOD_DEPOSIT_USDC || "650.000000",
  smallWithdrawUsdc:
    process.env.STAGING_CORE_DOGFOOD_SMALL_WITHDRAW_USDC || "10.000000",
  manualWithdrawUsdc:
    process.env.STAGING_CORE_DOGFOOD_MANUAL_WITHDRAW_USDC || "500.000000",
  depositConfirmMode:
    process.env.STAGING_CORE_DOGFOOD_DEPOSIT_CONFIRM_MODE || "api",
  depositIndexerJob:
    process.env.STAGING_CORE_DOGFOOD_DEPOSIT_INDEXER_JOB ||
    "synapse-staging-deposit-indexer",
  requireManualReview:
    process.env.STAGING_CORE_DOGFOOD_REQUIRE_MANUAL_REVIEW !== "false",
  headless: process.env.STAGING_CORE_DOGFOOD_HEADLESS !== "0",
};

export const evidence = {
  checks: [],
  failed: [],
  warnings: [],
  api: [],
  db: {},
  chain: {},
  screenshots: [],
  trace: [],
  bugfix: [],
};

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

export function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

export function utcNow() {
  return new Date().toISOString();
}

export function redact(value) {
  return String(value ?? "")
    .replace(
      /https:\/\/([^/\s]+)\/v2\/[A-Za-z0-9_-]+/g,
      "https://$1/v2/[REDACTED]"
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /"((?:password|privateKey|signature|jwt|token|secret|apiKey|authorization)[^"]*)"\s*:\s*"[^"]+"/gi,
      '"$1":"[REDACTED]"'
    )
    .replace(/0x[a-fA-F0-9]{64,}/g, "0x[REDACTED]");
}

export function redactedObject(value) {
  return JSON.parse(redact(JSON.stringify(value ?? null)));
}

export function addTrace(row) {
  evidence.trace.push({
    runId: RUN_ID,
    timestamp: utcNow(),
    requestId: row.requestId || crypto.randomUUID(),
    ledgerDelta: row.ledgerDelta || "",
    vaultDelta: row.vaultDelta || "",
    reconciliationStatus: row.reconciliationStatus || "",
    ...redactedObject(row),
  });
}

export function addCheck(name, ok, detail = "", extra = {}) {
  const record = { name, ok, detail: redact(detail), ...redactedObject(extra) };
  evidence.checks.push(record);
  if (!ok) {
    evidence.failed.push(record);
    evidence.bugfix.push({
      id: `BUG-${String(evidence.bugfix.length + 1).padStart(3, "0")}`,
      severity: extra.severity || "P1",
      scenario: name,
      screenshot: extra.screenshot || "",
      apiEvidence: extra.apiEvidence || "",
      dbEvidence: extra.dbEvidence || "",
      chainEvidence: extra.chainEvidence || "",
      reproSteps: extra.reproSteps || detail,
      expected: extra.expected || "Scenario passes in staging.",
      actual: detail,
      status: "open",
    });
  }
  console.log(
    `[staging-core-dogfood] ${ok ? "PASS" : "FAIL"} ${name}${
      detail ? ` - ${redact(detail)}` : ""
    }`
  );
}

export function requireEnv(name, value, { privateKey = false } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Missing required env ${name}`);
  if (privateKey && !/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error(`${name} must be a 0x-prefixed 32-byte EVM private key`);
  }
  return normalized;
}

export function assertSafety() {
  if (
    process.env.STAGING_CORE_DOGFOOD_CONFIRM !==
    "I_UNDERSTAND_THIS_MUTATES_STAGING"
  ) {
    throw new Error(
      "Set STAGING_CORE_DOGFOOD_CONFIRM=I_UNDERSTAND_THIS_MUTATES_STAGING before running live staging core dogfood."
    );
  }
  process.env.SYNAPSE_SEED_ENV ||= "staging";
  assertSeedEnvironment({
    scriptName: "staging-core-dogfood",
    allowStaging: true,
    runId: RUN_ID,
    urls: [
      config.gatewayBase,
      config.userFrontUrl,
      config.adminFrontUrl,
      config.adminApiUrl,
    ],
  });
  requireEnv("POSTGRES_DSN", config.postgresDsn);
  requireEnv("GATEWAY_E2E_RPC_URL", config.rpcUrl);
  requireEnv("GATEWAY_E2E_OWNER_KEY", config.consumerKey, { privateKey: true });
  requireEnv("GATEWAY_E2E_PROVIDER_KEY", config.providerKey, {
    privateKey: true,
  });
  requireEnv("STAGING_ADMIN_E2E_PASSWORD", config.adminPassword);
  requireEnv("STAGING_ADMIN_E2E_OTP_SECRET", config.adminTotpSecret);
}

export function readJson(relativePath) {
  const target = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(ROOT, relativePath);
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

export function psqlJson(sql) {
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
    throw new Error(
      `psql query failed: ${(result.stderr || result.stdout || "").trim()}`
    );
  }
  const text = result.stdout.trim();
  return text ? JSON.parse(text) : null;
}

export function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export async function api(
  pathname,
  { method = "GET", token, address, body, headers = {}, expectOk = true } = {}
) {
  const requestHeaders = { Accept: "application/json", ...headers };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (address) requestHeaders["X-User-Address"] = address;
  const started = Date.now();
  const response = await fetch(`${config.gatewayBase}/api${pathname}`, {
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
  const record = {
    method,
    path: `/api${pathname}`,
    httpStatus: response.status,
    durationMs: Date.now() - started,
    sanitizedRequest: redactedObject({ headers: requestHeaders, body }),
    sanitizedResponse: redactedObject(payload),
  };
  evidence.api.push(record);
  addTrace({ scenario: `api:${method}:${pathname}`, ...record });
  if (expectOk && !response.ok) {
    throw new Error(
      `${method} ${pathname} failed: ${response.status} ${JSON.stringify(
        payload
      ).slice(0, 800)}`
    );
  }
  return { response, payload, record };
}

export async function adminApi(
  pathname,
  auth,
  { method = "GET", body, otpCode, expectOk = true } = {}
) {
  const headers = {
    Accept: "application/json",
    Cookie: `${config.adminCookieName}=${auth.sessionToken}`,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["X-CSRF-Token"] = auth.csrfToken || "";
  }
  if (otpCode) headers["X-Admin-OTP-Code"] = otpCode;
  const started = Date.now();
  const response = await fetch(`${config.adminApiUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response
    .json()
    .catch(async () => ({ raw: await response.text().catch(() => "") }));
  const record = {
    method,
    path: pathname,
    httpStatus: response.status,
    durationMs: Date.now() - started,
    sanitizedRequest: redactedObject({ headers, body }),
    sanitizedResponse: redactedObject(payload),
  };
  evidence.api.push(record);
  addTrace({ scenario: `admin-api:${method}:${pathname}`, ...record });
  if (expectOk && (!response.ok || payload.success === false)) {
    throw new Error(
      `Admin API ${method} ${pathname} failed: ${
        response.status
      } ${JSON.stringify(payload).slice(0, 800)}`
    );
  }
  return { response, payload, record };
}

export async function authenticate(privateKey, label) {
  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address;
  const challengeResponse = await api(
    `/v1/auth/challenge?address=${encodeURIComponent(address)}`
  );
  const message =
    challengeResponse.payload.challenge || challengeResponse.payload.message;
  if (!message) throw new Error(`${label} auth challenge missing message`);
  const signature = await wallet.signMessage(message);
  const verified = await api("/v1/auth/verify", {
    method: "POST",
    body: { wallet_address: address, message, signature },
  });
  const token =
    verified.payload.access_token ||
    verified.payload.token ||
    verified.payload.accessToken;
  if (!token)
    throw new Error(`${label} auth verification did not return token`);
  addCheck(`${label}:auth`, true, address);
  return { address, token, privateKey };
}

export async function adminLogin() {
  await waitForSafeTotpWindow();
  const otpCode = generateTotpCode(config.adminTotpSecret);
  const response = await fetch(
    `${config.adminApiUrl}/api/admin/v1/auth/login`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: config.adminEmail,
        password: config.adminPassword,
        otpCode,
      }),
    }
  );
  const payload = await response.json().catch(() => ({}));
  const sessionCookie = (response.headers.get("set-cookie") || "")
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${config.adminCookieName}=`));
  const sessionToken = sessionCookie?.split(";")[0]?.split("=")[1] || "";
  const csrfToken = payload.data?.csrfToken || payload.csrfToken || "";
  addTrace({
    scenario: "admin-login",
    method: "POST",
    path: "/api/admin/v1/auth/login",
    httpStatus: response.status,
    sanitizedRequest: {
      email: config.adminEmail,
      password: "[REDACTED]",
      otpCode: "[REDACTED]",
    },
    sanitizedResponse: redactedObject(payload),
  });
  if (!response.ok || !sessionToken || !csrfToken) {
    throw new Error(
      `Admin E2E login failed: ${response.status} ${JSON.stringify(
        payload
      ).slice(0, 800)}`
    );
  }
  return { sessionToken, csrfToken, payload };
}

export async function getChainContext() {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const network = await provider.getNetwork();
  const contractConfig = readJson(config.contractConfigPath);
  const chainId = Number(network.chainId);
  if (chainId !== Number(contractConfig.chainId || 421614)) {
    throw new Error(
      `RPC chainId mismatch. Expected ${
        contractConfig.chainId || 421614
      }, got ${chainId}`
    );
  }
  return {
    provider,
    chainId,
    coreAddress: ethers.getAddress(contractConfig.SynapseCore),
    usdcAddress: ethers.getAddress(contractConfig.MockUSDC),
    coreAbi: readJson("services/user-front/src/SynapseCoreABI.json"),
    usdcAbi: readJson("services/user-front/src/MockUSDCABI.json"),
  };
}

export async function readChainBalances(address) {
  const { provider, coreAddress, usdcAddress, usdcAbi, coreAbi } =
    await getChainContext();
  const usdc = new ethers.Contract(usdcAddress, usdcAbi, provider);
  const core = new ethers.Contract(coreAddress, coreAbi, provider);
  const decimals = Number(await usdc.decimals());
  const walletAtomic = await usdc.balanceOf(address);
  const vaultAtomic = await usdc.balanceOf(coreAddress);
  const platformFeePoolAtomic = await core.platformFeePool();
  return {
    address,
    decimals,
    walletAtomic: walletAtomic.toString(),
    walletUsdc: ethers.formatUnits(walletAtomic, decimals),
    vaultAtomic: vaultAtomic.toString(),
    vaultUsdc: ethers.formatUnits(vaultAtomic, decimals),
    platformFeePoolAtomic: platformFeePoolAtomic.toString(),
    platformFeePoolUsdc: ethers.formatUnits(platformFeePoolAtomic, decimals),
  };
}

export async function sendWithRetry(label, makeTx, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
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
      console.log(
        `[staging-core-dogfood] ${label} retry ${attempt}/${attempts}: ${redact(
          error.message
        )}`
      );
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastError;
}

export async function screenshot(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  const relative = `screenshots/${name}.png`;
  evidence.screenshots.push(relative);
  return relative;
}
