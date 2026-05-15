#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { chromium } from "playwright";
import {
  assertLocalDsn,
  assertLocalHttpUrl,
  assertStagingHttpUrl,
  assertStagingProxyDsn,
  projectIdFromEnv,
  readDotenvFile,
  requireStagingConfirmation,
  resolveE2eEnvironment,
} from "../lib/e2e_env_guard.mjs";
import { assertSeedEnvironment } from "./seed_env_guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const generatedAt = new Date();
const environment = resolveE2eEnvironment({
  value: process.env.SUPPORT_CASE_DOGFOOD_ENV,
  defaultEnv: "local",
  scriptName: "support-case-dogfood",
});
process.env.SYNAPSE_E2E_ENV ||= environment;
process.env.SYNAPSE_SEED_ENV ||= environment;
const isStaging = environment === "staging";
const stagingConfirm = "I_UNDERSTAND_THIS_SENDS_STAGING_SUPPORT_ALERTS";
const timestamp = generatedAt
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "Z");
const runId =
  process.env.SUPPORT_CASE_DOGFOOD_RUN_ID ||
  `support-${environment}-${Date.now().toString(36)}`;
const evidenceDir = path.resolve(
  process.env.SUPPORT_CASE_DOGFOOD_EVIDENCE_DIR ||
    (isStaging
      ? path.join(
          ROOT,
          "docs/evidence/staging/support-case-dogfood",
          `${timestamp}-staging`
        )
      : path.join(ROOT, "output/dogfood/support-case", `${timestamp}-local`))
);
const screenshotsDir = path.join(evidenceDir, "screenshots");
const defaultLocalDsn =
  "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway";
const localGatewayEnv = readDotenvFile(
  path.join(ROOT, "services/gateway/.env.local")
);
const postgresDsn =
  process.env.SUPPORT_CASE_POSTGRES_DSN ||
  process.env.STAGING_SUPPORT_CASE_POSTGRES_DSN ||
  (!isStaging ? process.env.LOCAL_GATEWAY_POSTGRES_DSN : "") ||
  (isStaging ? process.env.POSTGRES_DSN : localGatewayEnv.POSTGRES_DSN) ||
  (!isStaging ? process.env.POSTGRES_DSN : "") ||
  defaultLocalDsn;
const userFrontUrl = (
  process.env.STAGING_USER_FRONT_URL ||
  process.env.USER_FRONT_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");
const adminFrontUrl = (
  process.env.STAGING_ADMIN_FRONT_URL ||
  process.env.ADMIN_FRONT_URL ||
  "http://localhost:3200"
).replace(/\/+$/, "");
const gatewayBaseUrl = (
  process.env.GATEWAY_BASE_URL ||
  process.env.SUPPORT_CASE_GATEWAY_BASE_URL ||
  "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const adminApiUrl = (
  process.env.STAGING_ADMIN_API_URL ||
  process.env.ADMIN_GATEWAY_URL ||
  "http://localhost:8300"
).replace(/\/+$/, "");
const adminCookieName =
  process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session";
const adminEmail = process.env.ADMIN_EMAIL || "cliff@synapse-network.ai";
const adminPassword =
  process.env.STAGING_ADMIN_E2E_PASSWORD ||
  process.env.ADMIN_PASSWORD ||
  "qwer@1234";
const adminTotpSecret =
  process.env.STAGING_ADMIN_E2E_OTP_SECRET ||
  process.env.ADMIN_TOTP_SECRET ||
  "JBSWY3DPEHPK3PXP";
const defaultLocalAuthorKey =
  "0x7c852118294f1a460a80c7c33d7409ea91c8436518e91e202d1f5f9e3544eb07";
const authorKey =
  process.env.SUPPORT_CASE_E2E_AUTHOR_KEY ||
  process.env.GATEWAY_E2E_OWNER_KEY ||
  (isStaging ? "" : defaultLocalAuthorKey);

assertSeedEnvironment({
  scriptName: "support-case-dogfood",
  allowStaging: isStaging,
  runId,
  dsn: postgresDsn,
  urls: [userFrontUrl, adminFrontUrl, gatewayBaseUrl, adminApiUrl],
});
const testEmail =
  process.env.SUPPORT_CASE_TEST_EMAIL ||
  process.env.STAGING_SUPPORT_CASE_TEST_EMAIL ||
  `support-dogfood-${runId}@synapse.test`;
const localDeliveryMode = String(
  process.env.SUPPORT_CASE_DOGFOOD_LOCAL_DELIVERY_MODE || "fake"
)
  .trim()
  .toLowerCase();
const isLocalReal = !isStaging && localDeliveryMode === "real";
const localRealConfirm =
  "I_UNDERSTAND_THIS_SENDS_REAL_LOCAL_SUPPORT_EMAIL_AND_LARK";
const supportLarkWebhookUrl =
  process.env.SUPPORT_LARK_WEBHOOK_URL ||
  process.env.TRANSACTION_LARK_WEBHOOK_URL ||
  "";
const supportLarkSecret =
  process.env.SUPPORT_LARK_SECRET || process.env.TRANSACTION_LARK_SECRET || "";

const steps = [];
const failed = [];
const warnings = [];
const screenshots = [];
const trace = [];
const apiEvidence = {};
const dbEvidence = {};
const larkEvidence = {
  mode: isStaging ? "staging" : isLocalReal ? "local-real" : "fake",
  cards: [],
};
const secretPatterns = [
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\b0x[a-fA-F0-9]{64,}\b/,
  /private[_-]?key\s*[:=]/i,
  /signature\s*[:=]/i,
  /https:\/\/open\.larksuite\.com\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+/i,
];

fs.mkdirSync(screenshotsDir, { recursive: true });

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function redact(value) {
  return String(value ?? "")
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://[REDACTED]@")
    .replace(
      /https:\/\/open\.larksuite\.com\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+/gi,
      "https://open.larksuite.com/open-apis/bot/v2/hook/[REDACTED]"
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[REDACTED_BEARER]")
    .replace(
      /\b(?:private[_-]?key|signature|secret|token|password)\s*[:=]\s*[^\s,;"']+/gi,
      "[REDACTED_SENSITIVE_FIELD]"
    )
    .replace(/\b0x[a-fA-F0-9]{64,}\b/g, "0x[REDACTED]")
    .replace(/([?&](?:token|secret|signature)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(
      /\b([A-Z0-9._%+-]{2})[A-Z0-9._%+-]*@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi,
      "$1***@$2"
    );
}

function redactDeep(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactDeep(child)])
    );
  }
  return value;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function traceEvent(event, payload = {}) {
  trace.push({ at: new Date().toISOString(), event, ...redactDeep(payload) });
}

function pass(name, detail = "") {
  steps.push({ name, ok: true, detail: redact(detail) });
  traceEvent("step", { name, ok: true, detail });
  console.log(`PASS ${name}${detail ? ` - ${redact(detail)}` : ""}`);
}

function failStep(name, error) {
  const message = redact(formatError(error));
  const item = { name, detail: message };
  steps.push({ name, ok: false, error: message });
  failed.push(item);
  traceEvent("step", { name, ok: false, error: message });
  console.error(`FAIL ${name} - ${message}`);
}

function warn(name, detail = "") {
  warnings.push({ name, detail: redact(detail) });
  traceEvent("warning", { name, detail });
  console.warn(`WARN ${name}${detail ? ` - ${redact(detail)}` : ""}`);
}

async function step(name, fn) {
  try {
    const detail = await fn();
    pass(name, detail || "");
    return detail;
  } catch (error) {
    failStep(name, error);
    return null;
  }
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function psql(sql) {
  const result = spawnSync(
    "psql",
    [postgresDsn, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(
      `psql failed: ${redact(result.stderr || result.stdout || "")}`
    );
  }
  return result.stdout.trim();
}

function queryJson(sql) {
  const output = psql(sql);
  if (!output) return null;
  const lines = output.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Continue to the previous line.
    }
  }
  throw new Error(`psql did not return JSON: ${redact(output.slice(0, 400))}`);
}

function exec(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${redact(
        result.stderr || result.stdout || ""
      )}`
    );
  }
  return result.stdout;
}

async function assertReachable(name, url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok)
    throw new Error(`${name} not reachable: ${response.status} ${url}`);
  return `${name} ${response.status}`;
}

function validateProfile() {
  if (isStaging) {
    requireStagingConfirmation(
      "SUPPORT_CASE_DOGFOOD_STAGING_CONFIRM",
      stagingConfirm
    );
    assertStagingHttpUrl("STAGING_USER_FRONT_URL", userFrontUrl);
    assertStagingHttpUrl("STAGING_ADMIN_FRONT_URL", adminFrontUrl);
    assertStagingHttpUrl("GATEWAY_BASE_URL", gatewayBaseUrl);
    assertStagingHttpUrl("STAGING_ADMIN_API_URL", adminApiUrl);
    assertStagingProxyDsn("STAGING_SUPPORT_CASE_POSTGRES_DSN", postgresDsn, {
      allowEmpty: false,
    });
    if (!authorKey && !process.env.SUPPORT_CASE_E2E_AUTH_TOKEN) {
      throw new Error(
        "Set SUPPORT_CASE_E2E_AUTHOR_KEY or SUPPORT_CASE_E2E_AUTH_TOKEN for staging support dogfood."
      );
    }
    pass("staging_confirmation", "live staging mutation confirmed");
  } else {
    if (
      isLocalReal &&
      process.env.SUPPORT_CASE_DOGFOOD_LOCAL_REAL_CONFIRM !== localRealConfirm
    ) {
      throw new Error(
        `Set SUPPORT_CASE_DOGFOOD_LOCAL_REAL_CONFIRM=${localRealConfirm} before sending real local support email/Lark.`
      );
    }
    assertLocalHttpUrl("USER_FRONT_URL", userFrontUrl);
    assertLocalHttpUrl("ADMIN_FRONT_URL", adminFrontUrl);
    assertLocalHttpUrl("GATEWAY_BASE_URL", gatewayBaseUrl);
    assertLocalHttpUrl("ADMIN_GATEWAY_URL", adminApiUrl);
    assertLocalDsn("SUPPORT_CASE_POSTGRES_DSN", postgresDsn, {
      allowEmpty: false,
    });
    if (isLocalReal && !supportLarkWebhookUrl) {
      throw new Error(
        "SUPPORT_LARK_WEBHOOK_URL or TRANSACTION_LARK_WEBHOOK_URL is required for local-real support dogfood."
      );
    }
    if (
      authorKey === defaultLocalAuthorKey &&
      !gatewayBaseUrl.includes("127.0.0.1") &&
      !gatewayBaseUrl.includes("localhost")
    ) {
      throw new Error(
        "Refusing to use local default wallet outside localhost."
      );
    }
    pass(
      "local_profile",
      isLocalReal
        ? "local real Gmail/Lark mode validated"
        : "local endpoints and DSN validated"
    );
  }
}

function startFakeLark() {
  const requests = [];
  let failNext = false;
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      let body = {};
      try {
        body = JSON.parse(bodyText || "{}");
      } catch {
        body = { raw: bodyText };
      }
      requests.push({
        url: request.url,
        body: redactDeep(body),
        status: failNext ? 500 : 200,
      });
      if (failNext) {
        failNext = false;
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ code: 500, msg: "fake lark failure" }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ code: 0, msg: "ok" }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}/lark`,
        requests,
        failNext: () => {
          failNext = true;
        },
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function restartGatewayWithFakeLark(fakeUrl) {
  exec("bash", ["scripts/local/start_all_services.sh", "start"], {
    env: {
      ...process.env,
      SUPPORT_LARK_ENABLED: "true",
      SUPPORT_LARK_WEBHOOK_URL: fakeUrl,
      SUPPORT_LARK_SECRET: "",
      SUPPORT_LARK_TIMEOUT_SEC: "3",
      LOCAL_GATEWAY_POSTGRES_DSN: postgresDsn,
      NEXT_PUBLIC_GATEWAY_BASE_URL: "http://127.0.0.1:8000",
      NEXT_PUBLIC_ANALYTICS_ENDPOINT: "http://127.0.0.1:8000/api/v1/events",
      STARTUP_TIMEOUT_SEC: process.env.STARTUP_TIMEOUT_SEC || "40",
    },
  });
  exec("bash", ["scripts/local/restart_gateway.sh"], {
    env: {
      ...process.env,
      SUPPORT_LARK_ENABLED: "true",
      SUPPORT_LARK_WEBHOOK_URL: fakeUrl,
      SUPPORT_LARK_SECRET: "",
      SUPPORT_LARK_TIMEOUT_SEC: "3",
      LOCAL_GATEWAY_POSTGRES_DSN: postgresDsn,
      STARTUP_TIMEOUT_SEC: process.env.STARTUP_TIMEOUT_SEC || "40",
    },
  });
}

function restartGatewayWithRealSupportLark() {
  exec("bash", ["scripts/local/start_all_services.sh", "start"], {
    env: {
      ...process.env,
      SUPPORT_LARK_ENABLED: "true",
      SUPPORT_LARK_WEBHOOK_URL: supportLarkWebhookUrl,
      SUPPORT_LARK_SECRET: supportLarkSecret,
      SUPPORT_LARK_TIMEOUT_SEC: process.env.SUPPORT_LARK_TIMEOUT_SEC || "5",
      LOCAL_GATEWAY_POSTGRES_DSN: postgresDsn,
      NEXT_PUBLIC_GATEWAY_BASE_URL: "http://127.0.0.1:8000",
      NEXT_PUBLIC_ANALYTICS_ENDPOINT: "http://127.0.0.1:8000/api/v1/events",
      PUBLIC_APP_BASE_URL:
        process.env.PUBLIC_APP_BASE_URL || "http://localhost:3000",
      STARTUP_TIMEOUT_SEC: process.env.STARTUP_TIMEOUT_SEC || "40",
    },
  });
  exec("bash", ["scripts/local/restart_gateway.sh"], {
    env: {
      ...process.env,
      SUPPORT_LARK_ENABLED: "true",
      SUPPORT_LARK_WEBHOOK_URL: supportLarkWebhookUrl,
      SUPPORT_LARK_SECRET: supportLarkSecret,
      SUPPORT_LARK_TIMEOUT_SEC: process.env.SUPPORT_LARK_TIMEOUT_SEC || "5",
      LOCAL_GATEWAY_POSTGRES_DSN: postgresDsn,
      PUBLIC_APP_BASE_URL:
        process.env.PUBLIC_APP_BASE_URL || "http://localhost:3000",
      STARTUP_TIMEOUT_SEC: process.env.STARTUP_TIMEOUT_SEC || "40",
    },
  });
}

function runLocalOutboxWorker() {
  const result = spawnSync(
    process.env.PYTHON || path.join(ROOT, "services/gateway/.venv/bin/python"),
    ["-m", "src.worker", "notification-outbox", "--once"],
    {
      cwd: path.join(ROOT, "services/gateway"),
      encoding: "utf8",
      env: {
        ...process.env,
        POSTGRES_DSN: postgresDsn,
        LOCAL_GATEWAY_POSTGRES_DSN: postgresDsn,
        EMAIL_OUTBOX_ENABLED: "true",
        EMAIL_TRANSPORT: process.env.EMAIL_TRANSPORT || "gmail_smtp",
        EMAIL_FROM:
          process.env.EMAIL_FROM ||
          "Synapse Network Local <local@synapse.test>",
        EMAIL_REPLY_TO:
          process.env.EMAIL_REPLY_TO || "support@synapse-network.ai",
        GMAIL_SMTP_USERNAME: process.env.GMAIL_SMTP_USERNAME || "",
        GMAIL_SMTP_APP_PASSWORD: process.env.GMAIL_SMTP_APP_PASSWORD || "",
        GMAIL_SMTP_HOST: process.env.GMAIL_SMTP_HOST || "smtp.gmail.com",
        GMAIL_SMTP_PORT: process.env.GMAIL_SMTP_PORT || "587",
        PUBLIC_APP_BASE_URL:
          process.env.PUBLIC_APP_BASE_URL || "http://localhost:3000",
        ENV_FILE: "__support_case_dogfood_no_env_file__",
      },
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `notification outbox worker failed: ${redact(
        result.stderr || result.stdout || ""
      )}`
    );
  }
  return redact(result.stdout || "{}");
}

async function gatewayApi(
  pathname,
  { method = "GET", token, address, body } = {}
) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (address) headers["X-User-Address"] = address;
  const response = await fetch(`${gatewayBaseUrl}/api${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(
      `${method} ${pathname} failed: ${response.status} ${JSON.stringify(
        redactDeep(payload)
      ).slice(0, 800)}`
    );
  }
  return payload;
}

async function authenticateUser() {
  if (process.env.SUPPORT_CASE_E2E_AUTH_TOKEN) {
    if (!process.env.SUPPORT_CASE_E2E_WALLET)
      throw new Error(
        "SUPPORT_CASE_E2E_WALLET is required with SUPPORT_CASE_E2E_AUTH_TOKEN."
      );
    return {
      token: process.env.SUPPORT_CASE_E2E_AUTH_TOKEN,
      address: process.env.SUPPORT_CASE_E2E_WALLET,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };
  }
  const wallet = new ethers.Wallet(authorKey);
  const challenge = await gatewayApi(
    `/v1/auth/challenge?address=${encodeURIComponent(wallet.address)}`
  );
  const message = challenge.challenge || challenge.message;
  if (!message) throw new Error("Auth challenge missing message.");
  const signature = await wallet.signMessage(message);
  const verified = await gatewayApi("/v1/auth/verify", {
    method: "POST",
    body: { wallet_address: wallet.address, message, signature },
  });
  const token = verified.access_token || verified.token || verified.accessToken;
  if (!token) throw new Error("Auth verification did not return a token.");
  return {
    token,
    address: wallet.address,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
}

function base32ToBuffer(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of String(secret)
    .replace(/=+$/g, "")
    .replace(/\s+/g, "")
    .toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0)
      throw new Error(`Invalid base32 character in admin TOTP secret: ${char}`);
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotpCode(secret) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const digest = crypto
    .createHmac("sha1", base32ToBuffer(secret))
    .update(counterBuffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function parseSessionCookie(setCookieHeader) {
  const header = Array.isArray(setCookieHeader)
    ? setCookieHeader.join(",")
    : String(setCookieHeader || "");
  const cookie = header
    .split(/,(?=\s*[^;,]+=)/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${adminCookieName}=`));
  return cookie ? cookie.split(";")[0].slice(adminCookieName.length + 1) : "";
}

async function loginAdmin() {
  if (process.env.ADMIN_SESSION_TOKEN) {
    return {
      sessionToken: process.env.ADMIN_SESSION_TOKEN,
      csrfToken: process.env.ADMIN_CSRF_TOKEN || "",
    };
  }
  const response = await fetch(`${adminApiUrl}/api/admin/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: adminEmail,
      password: adminPassword,
      otpCode: process.env.ADMIN_OTP_CODE || generateTotpCode(adminTotpSecret),
    }),
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => ({}));
  const setCookie =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : response.headers.get("set-cookie");
  const sessionToken = parseSessionCookie(setCookie);
  if (!response.ok || !payload.success || !sessionToken) {
    throw new Error(
      `Admin login failed: ${response.status} ${JSON.stringify(
        redactDeep(payload)
      ).slice(0, 800)}`
    );
  }
  return { sessionToken, csrfToken: payload.data?.csrfToken || "" };
}

async function adminApi(pathname, auth, { method = "GET", body } = {}) {
  const headers = {
    Accept: "application/json",
    Cookie: `${adminCookieName}=${auth.sessionToken}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth.csrfToken) headers["X-CSRF-Token"] = auth.csrfToken;
  const response = await fetch(`${adminApiUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(
      `Admin API ${method} ${pathname} failed: ${
        response.status
      } ${JSON.stringify(redactDeep(payload)).slice(0, 800)}`
    );
  }
  return payload.data || payload;
}

function seedVerifiedOwnerEmail(address) {
  const owner = String(address).toLowerCase();
  psql(`
    UPDATE synapse_owner_accounts
    SET email = lower(${sqlLiteral(testEmail)}),
        email_verified = TRUE,
        notify_alerts = TRUE,
        status = 'active',
        updated_at = NOW()
    WHERE lower(owner_wallet) = lower(${sqlLiteral(owner)});

    INSERT INTO synapse_owner_accounts (
      owner_id, owner_wallet, display_name, email, email_verified,
      notify_marketing, notify_alerts, status, created_at, updated_at
    )
    SELECT
      ${sqlLiteral(owner)}, ${sqlLiteral(owner)}, ${sqlLiteral(
    `Support Dogfood ${environment}`
  )},
      lower(${sqlLiteral(testEmail)}), TRUE, TRUE, TRUE, 'active', NOW(), NOW()
    WHERE NOT EXISTS (
      SELECT 1 FROM synapse_owner_accounts
      WHERE lower(owner_wallet) = lower(${sqlLiteral(owner)})
    )
  `);
}

function assertVerifiedOwnerEmail(address) {
  const row = queryJson(`
    SELECT row_to_json(result)
    FROM (
      SELECT owner_wallet AS "ownerWallet", email, email_verified AS "emailVerified", pending_email AS "pendingEmail"
      FROM synapse_owner_accounts
      WHERE lower(owner_wallet) = lower(${sqlLiteral(address)})
      LIMIT 1
    ) result
  `);
  if (!row) throw new Error(`owner profile missing for ${address}`);
  if (
    String(row.email || "").toLowerCase() !== String(testEmail).toLowerCase()
  ) {
    throw new Error(
      `verified owner email mismatch: expected ${testEmail}, got ${
        row.email || "<empty>"
      }`
    );
  }
  if (!row.emailVerified) throw new Error("owner email is not verified");
  return row;
}

async function screenshot(page, fileName) {
  const fullPath = path.join(screenshotsDir, fileName);
  await page.screenshot({ path: fullPath, fullPage: false });
  screenshots.push(`screenshots/${fileName}`);
}

async function makeUserContext(browser, auth) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(
    (session) => {
      localStorage.setItem("synapse_lang", "en");
      localStorage.setItem("a2a_auth_session", JSON.stringify(session));
      localStorage.setItem(
        "developer_session",
        JSON.stringify({ wallet: session.wallet })
      );
    },
    {
      token: auth.token,
      wallet: String(auth.address || "").toLowerCase(),
      expiresAt: auth.expiresAt,
    }
  );
  return context;
}

async function makeAdminContext(browser, adminAuth) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.addCookies([
    {
      name: adminCookieName,
      value: adminAuth.sessionToken,
      url: adminFrontUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await context.addInitScript((csrfToken) => {
    if (csrfToken) sessionStorage.setItem("synapse.admin.csrfToken", csrfToken);
  }, adminAuth.csrfToken);
  return context;
}

async function submitBillingSupportViaUi(browser, userAuth) {
  const context = await makeUserContext(browser, userAuth);
  const page = await context.newPage();
  try {
    await page.goto(`${userFrontUrl}/dashboard/billing/credits`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await screenshot(page, "billing-credits-support-entry.png");
    await page.getByTestId("feedback-floating-button").click();
    await page
      .getByTestId("feedback-drawer")
      .waitFor({ state: "visible", timeout: 20000 });
    await screenshot(page, "support-feedback-drawer.png");
    const message = [
      `Billing support dogfood ${runId}`,
      "Deposit/refund question needs operator review.",
      "Bearer support-dogfood-secret-token",
      "privateKey=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "signature=dogfood-signature",
    ].join("\n");
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/feedback") &&
        response.request().method() === "POST"
    );
    await page.getByPlaceholder(/Tell us what broke/i).fill(message);
    await page.getByRole("button", { name: /Submit feedback/i }).click();
    const response = await responsePromise;
    const payload = await response.json();
    if (!response.ok())
      throw new Error(`feedback POST failed: ${response.status()}`);
    await page
      .getByTestId("feedback-id")
      .waitFor({ state: "visible", timeout: 20000 });
    await screenshot(page, "support-submit-success.png");
    if (
      !payload.feedbackId ||
      !payload.supportTaskId ||
      !payload.supportCaseCreated
    ) {
      throw new Error(
        `support feedback did not create a support case: ${JSON.stringify(
          redactDeep(payload)
        )}`
      );
    }
    return { payload, message };
  } finally {
    await context.close().catch(() => {});
  }
}

async function submitFeedbackViaApi(auth, category, message) {
  return gatewayApi("/v1/feedback", {
    method: "POST",
    token: auth.token,
    address: auth.address,
    body: {
      source: "docs",
      sentiment: "report_issue",
      category,
      message,
      route: `/support?runId=${encodeURIComponent(
        runId
      )}&category=${encodeURIComponent(category)}`,
      pageTitle: `Support Dogfood ${category}`,
      language: "en",
      context: {
        runId,
        category,
        authorization: "Bearer support-dogfood-secret-token",
        privateKey:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    },
  });
}

function loadCaseDbEvidence(feedbackId, taskId) {
  const row = queryJson(`
    SELECT row_to_json(result)
    FROM (
      SELECT
        feedback.feedback_id AS "feedbackId",
        feedback.category,
        feedback.status AS "feedbackStatus",
        feedback.owner_address AS "ownerAddress",
        topic.topic_id AS "topicId",
        topic.title AS "topicTitle",
        topic.status AS "topicStatus",
        task.response_task_id AS "responseTaskId",
        task.status AS "taskStatus",
        task.priority,
        task.classification,
        task.reply_id AS "replyId",
        task.metadata_json AS metadata
      FROM synapse_feedback_reports feedback
      LEFT JOIN synapse_forum_response_tasks task
        ON task.metadata_json->>'feedbackId' = feedback.feedback_id
      LEFT JOIN synapse_forum_topics topic
        ON topic.topic_id = task.topic_id
      WHERE feedback.feedback_id = ${sqlLiteral(feedbackId)}
        AND (${sqlLiteral(taskId)} = '' OR task.response_task_id = ${sqlLiteral(
    taskId
  )})
      LIMIT 1
    ) result
  `);
  if (!row)
    throw new Error(`No feedback/support DB row found for ${feedbackId}`);
  return row;
}

function loadReplyDbEvidence(taskId) {
  return queryJson(`
    SELECT row_to_json(result)
    FROM (
      SELECT
        task.response_task_id AS "responseTaskId",
        task.status AS "taskStatus",
        task.reply_id AS "replyId",
        task.responded_at AS "respondedAt",
        reply.body AS "replyBody",
        (
          SELECT count(*)
          FROM synapse_in_app_notifications inbox
          WHERE inbox.resource_type = 'support_case'
            AND inbox.resource_id = task.response_task_id
            AND inbox.event_type = 'support.reply_sent'
        ) AS "inAppCount",
        (
          SELECT count(*)
          FROM synapse_notification_outbox outbox
          WHERE outbox.template_key = 'support_reply'
            AND outbox.payload->>'responseTaskId' = task.response_task_id
        ) AS "supportReplyOutboxCount",
        (
          SELECT count(*)
          FROM synapse_notification_delivery_log delivery
          WHERE delivery.template_key = 'support_reply'
            AND delivery.dedupe_key LIKE ('%:' || task.reply_id)
        ) AS "supportReplyDeliveryCount"
      FROM synapse_forum_response_tasks task
      LEFT JOIN synapse_forum_replies reply ON reply.reply_id = task.reply_id
      WHERE task.response_task_id = ${sqlLiteral(taskId)}
      LIMIT 1
    ) result
  `);
}

async function adminDogfood(browser, adminAuth, taskId, replyBody, topicTitle) {
  const context = await makeAdminContext(browser, adminAuth);
  const page = await context.newPage();
  try {
    await page.goto(`${adminFrontUrl}/forum-support`, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await screenshot(page, "admin-support-list.png");
    await page.getByRole("button", { name: /Response Queue/i }).click();
    await page
      .getByText(topicTitle, { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30000 });
    await page.getByText(topicTitle, { exact: false }).first().click();
    await page
      .getByText(taskId, { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30000 });
    await screenshot(page, "admin-support-detail.png");
    const result = await adminApi(
      `/api/admin/v1/forum/response-tasks/${encodeURIComponent(
        taskId
      )}/send-reply`,
      adminAuth,
      {
        method: "POST",
        body: {
          body: replyBody,
          authorDisplay: "Synapse Support Dogfood",
          authorAddress: "support-dogfood-admin",
        },
      }
    );
    await page.reload({ waitUntil: "networkidle", timeout: 60000 });
    await page
      .getByText(/responded|已回复|回复/i)
      .first()
      .waitFor({ state: "visible", timeout: 30000 })
      .catch(() => {});
    await screenshot(page, "admin-support-replied.png");
    return result;
  } finally {
    await context.close().catch(() => {});
  }
}

function checkRedaction(name, value) {
  const text = JSON.stringify(value);
  const leaked = secretPatterns.find((pattern) => pattern.test(text));
  if (leaked)
    throw new Error(`${name} leaked secret-like value matching ${leaked}`);
}

function writeOutputs() {
  const tracePath = path.join(evidenceDir, "trace.jsonl");
  fs.writeFileSync(
    tracePath,
    `${trace.map((item) => JSON.stringify(item)).join("\n")}\n`
  );
  const traceDigest = sha256(fs.readFileSync(tracePath));
  const report = {
    status: failed.length === 0 ? "success" : "failed",
    environment,
    generatedAt: generatedAt.toISOString(),
    runId,
    failed,
    warnings,
    steps,
    screenshots,
    traceDigest,
  };
  const bugfix =
    failed.length === 0
      ? "# Bugfix Log\n\nNo open bugs.\n"
      : [
          "# Bugfix Log",
          "",
          ...failed.map((item, index) =>
            [
              `## BUG-${String(index + 1).padStart(3, "0")}`,
              "",
              "- ID: pending",
              "- Severity: P1",
              `- Scenario: ${item.name}`,
              "- Screenshot: see screenshots/ if available",
              "- API Evidence: api-evidence.json",
              "- DB Evidence: db-evidence.json",
              "- Lark Evidence: lark-evidence.json",
              "- Repro Steps: rerun the support case dogfood command",
              "- Expected: full support case workflow passes",
              `- Actual: ${item.detail}`,
              "- Status: open",
              "",
            ].join("\n")
          ),
        ].join("\n");
  fs.writeFileSync(path.join(evidenceDir, "bugfix-log.md"), bugfix);
  fs.writeFileSync(
    path.join(evidenceDir, "report.json"),
    `${JSON.stringify(redactDeep(report), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(evidenceDir, "report.md"),
    [
      `# Support Case Dogfood ${environment}`,
      "",
      `- Status: ${report.status}`,
      `- Run ID: ${runId}`,
      `- Generated: ${report.generatedAt}`,
      `- Trace digest: ${traceDigest}`,
      "",
      "## Steps",
      ...steps.map(
        (item) =>
          `- ${item.ok ? "PASS" : "FAIL"} ${item.name}${
            item.detail ? `: ${item.detail}` : ""
          }${item.error ? `: ${item.error}` : ""}`
      ),
      "",
      "## Screenshots",
      ...screenshots.map((item) => `- ${item}`),
      "",
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(evidenceDir, "api-evidence.json"),
    `${JSON.stringify(redactDeep(apiEvidence), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(evidenceDir, "db-evidence.json"),
    `${JSON.stringify(redactDeep(dbEvidence), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(evidenceDir, "lark-evidence.json"),
    `${JSON.stringify(redactDeep(larkEvidence), null, 2)}\n`
  );
}

async function readStagingLarkLog(feedbackId) {
  const projectId = projectIdFromEnv();
  if (!projectId) {
    warn(
      "staging_lark_log",
      "PROJECT_ID missing; operator must manually confirm Lark SUPPORT_CASE_CREATED card."
    );
    return null;
  }
  const filter = [
    'resource.type="cloud_run_revision"',
    'textPayload:"SUPPORT_CASE_CREATED"',
    `textPayload:"${feedbackId}"`,
  ].join(" AND ");
  const output = exec("gcloud", [
    "logging",
    "read",
    filter,
    `--project=${projectId}`,
    "--freshness=30m",
    "--limit=5",
    "--format=json",
  ]);
  const rows = JSON.parse(output || "[]");
  return {
    count: rows.length,
    sample: rows
      .slice(0, 2)
      .map((row) => row.textPayload || row.jsonPayload || {}),
  };
}

function readLocalLarkLog(feedbackId) {
  const logFiles = [
    path.join(ROOT, "services/gateway/logs/provider_api.log"),
    path.join(ROOT, "services/gateway/logs/gateway/gateway-runtime.log"),
  ];
  const rows = [];
  for (const logFile of logFiles) {
    if (!fs.existsSync(logFile)) continue;
    const content = fs.readFileSync(logFile, "utf8");
    for (const line of content.split(/\r?\n/)) {
      if (line.includes("SUPPORT_CASE_CREATED") && line.includes(feedbackId)) {
        rows.push(redact(line).slice(0, 600));
      }
    }
  }
  return { count: rows.length, sample: rows.slice(-3) };
}

async function main() {
  let fakeLark = null;
  let browser = null;
  try {
    validateProfile();
    if (isLocalReal) {
      restartGatewayWithRealSupportLark();
      pass(
        "real_support_lark",
        "gateway restarted with real local support Lark route"
      );
    } else if (!isStaging) {
      fakeLark = await startFakeLark();
      restartGatewayWithFakeLark(fakeLark.url);
      pass("fake_lark", `started fake Lark sink on ${fakeLark.url}`);
    }
    await step("gateway_health", () =>
      assertReachable("gateway", `${gatewayBaseUrl}/health`)
    );
    await step("admin_api_health", () =>
      assertReachable("admin-api", `${adminApiUrl}/health`)
    );
    await step("user_front_health", () =>
      assertReachable("user-front", userFrontUrl)
    );
    await step("admin_front_health", () =>
      assertReachable("admin-front", adminFrontUrl)
    );
    const userAuth = await step("user_auth", authenticateUser);
    if (!userAuth) throw new Error("user auth failed");
    await step("verified_owner_email", () => {
      if (isLocalReal || process.env.SUPPORT_CASE_SKIP_EMAIL_SEED === "1") {
        return assertVerifiedOwnerEmail(userAuth.address);
      }
      seedVerifiedOwnerEmail(userAuth.address);
      return `verified ${testEmail}`;
    });
    browser = await chromium.launch({
      headless: process.env.SUPPORT_CASE_DOGFOOD_HEADLESS !== "0",
    });
    const billingResult = await step("ui_submit_billing_support", () =>
      submitBillingSupportViaUi(browser, userAuth)
    );
    if (!billingResult) throw new Error("billing support submission failed");
    apiEvidence.billingFeedback = {
      feedbackId: billingResult.payload.feedbackId,
      supportTaskId: billingResult.payload.supportTaskId,
      supportCaseCreated: billingResult.payload.supportCaseCreated,
      supportPriority: billingResult.payload.supportPriority,
    };
    dbEvidence.billingCase = await step("db_billing_support_case", () => {
      const row = loadCaseDbEvidence(
        billingResult.payload.feedbackId,
        billingResult.payload.supportTaskId
      );
      if (row.taskStatus !== "awaiting_response")
        throw new Error(`unexpected task status ${row.taskStatus}`);
      if (row.category !== "billing_support")
        throw new Error(`unexpected category ${row.category}`);
      return row;
    });
    await step("api_submit_bug_report", async () => {
      if (fakeLark) fakeLark.failNext();
      const payload = await submitFeedbackViaApi(
        userAuth,
        "bug_report",
        `Bug report dogfood ${runId} signature=dogfood`
      );
      if (!payload.supportCaseCreated || !payload.supportTaskId)
        throw new Error("bug_report did not create support case");
      apiEvidence.bugReport = {
        feedbackId: payload.feedbackId,
        supportTaskId: payload.supportTaskId,
      };
      dbEvidence.bugReport = loadCaseDbEvidence(
        payload.feedbackId,
        payload.supportTaskId
      );
      return payload.supportTaskId;
    });
    await step("api_submit_docs_issue", async () => {
      const payload = await submitFeedbackViaApi(
        userAuth,
        "docs_issue",
        `Docs issue dogfood ${runId}`
      );
      if (!payload.supportCaseCreated || !payload.supportTaskId)
        throw new Error("docs_issue did not create support case");
      apiEvidence.docsIssue = {
        feedbackId: payload.feedbackId,
        supportTaskId: payload.supportTaskId,
      };
      dbEvidence.docsIssue = loadCaseDbEvidence(
        payload.feedbackId,
        payload.supportTaskId
      );
      return payload.supportTaskId;
    });
    await step("api_submit_product_feedback_raw_only", async () => {
      const payload = await submitFeedbackViaApi(
        userAuth,
        "product_feedback",
        `Product feedback dogfood ${runId}`
      );
      if (payload.supportCaseCreated || payload.supportTaskId)
        throw new Error("product_feedback unexpectedly created support case");
      const row = loadCaseDbEvidence(payload.feedbackId, "");
      if (row.responseTaskId)
        throw new Error("product_feedback created response task in DB");
      apiEvidence.productFeedback = {
        feedbackId: payload.feedbackId,
        supportCaseCreated: payload.supportCaseCreated,
      };
      dbEvidence.productFeedback = row;
      return payload.feedbackId;
    });
    await step("lark_support_case_created", async () => {
      if (fakeLark) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        larkEvidence.cards = fakeLark.requests.map((item) => item.body);
        larkEvidence.statuses = fakeLark.requests.map((item) => item.status);
        const text = JSON.stringify(larkEvidence);
        if (!text.includes("SUPPORT_CASE_CREATED"))
          throw new Error("fake Lark did not receive SUPPORT_CASE_CREATED");
        if (!text.includes(apiEvidence.billingFeedback.feedbackId))
          throw new Error("fake Lark missing feedback id");
        if (!larkEvidence.statuses.includes(500))
          throw new Error("fake Lark failure path was not exercised");
        checkRedaction("lark evidence", larkEvidence);
        return `${larkEvidence.cards.length} fake cards`;
      }
      if (isLocalReal) {
        const log = readLocalLarkLog(apiEvidence.billingFeedback.feedbackId);
        larkEvidence.logging = log;
        larkEvidence.operatorMarker = "SUPPORT_CASE_CREATED";
        if (log.count < 1) {
          throw new Error(
            "local gateway log did not show SUPPORT_CASE_CREATED; check SUPPORT_LARK_* config."
          );
        }
        return `${log.count} local log rows`;
      }
      const log = await readStagingLarkLog(
        apiEvidence.billingFeedback.feedbackId
      );
      larkEvidence.logging = log;
      larkEvidence.operatorMarker = "SUPPORT_CASE_CREATED";
      larkEvidence.action = "NO_ACTION_REQUIRED";
      if (
        process.env.SUPPORT_CASE_DOGFOOD_REQUIRE_LARK_LOG === "1" &&
        (!log || log.count < 1)
      ) {
        throw new Error(
          "staging Cloud Logging did not show SUPPORT_CASE_CREATED"
        );
      }
      return log
        ? `${log.count} log rows`
        : "operator manual Lark marker recorded";
    });
    const adminAuth = await step("admin_login", loginAdmin);
    if (!adminAuth) throw new Error("admin login failed");
    await step("admin_front_reply", async () => {
      const replyBody = `Support dogfood reply ${runId}: we received and triaged your billing report.`;
      const result = await adminDogfood(
        browser,
        adminAuth,
        apiEvidence.billingFeedback.supportTaskId,
        replyBody,
        dbEvidence.billingCase.topicTitle ||
          `Billing Support: Developer Support - Billing Support`
      );
      apiEvidence.adminReply = {
        responseTaskId: apiEvidence.billingFeedback.supportTaskId,
        status: result.status,
        replyId: result.replyId,
      };
      return result.responseTaskId || apiEvidence.billingFeedback.supportTaskId;
    });
    if (isLocalReal) {
      await step("local_outbox_drain", () => runLocalOutboxWorker());
    }
    dbEvidence.reply = await step("db_reply_notifications", () => {
      const row = loadReplyDbEvidence(
        apiEvidence.billingFeedback.supportTaskId
      );
      if (!row || row.taskStatus !== "responded")
        throw new Error(`task not responded: ${JSON.stringify(row)}`);
      if (!row.replyId) throw new Error("reply row missing");
      if (Number(row.inAppCount || 0) < 1)
        throw new Error("support reply in-app notification missing");
      if (isLocalReal && Number(row.supportReplyDeliveryCount || 0) < 1) {
        throw new Error(
          "support_reply delivery log missing after real outbox drain"
        );
      }
      if (
        Number(row.supportReplyOutboxCount || 0) +
          Number(row.supportReplyDeliveryCount || 0) <
        1
      ) {
        throw new Error("support_reply email outbox or delivery log missing");
      }
      return row;
    });
    await step("evidence_redaction", () => {
      checkRedaction("api evidence", apiEvidence);
      checkRedaction("db evidence", dbEvidence);
      checkRedaction("trace", trace);
      return "no secret-like values in evidence";
    });
  } catch (error) {
    failStep("fatal", error);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (fakeLark) await fakeLark.close().catch(() => {});
    writeOutputs();
  }
  if (failed.length > 0) {
    console.error(`Support case dogfood failed. Evidence: ${evidenceDir}`);
    process.exit(1);
  }
  console.log(`Support case dogfood passed. Evidence: ${evidenceDir}`);
}

main();
