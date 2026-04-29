#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { chromium } from "playwright";
import {
  assertLocalDsn,
  assertLocalHttpUrl,
  readDotenvFile,
  resolveE2eEnvironment,
} from "../lib/e2e_env_guard.mjs";
import { assertSeedEnvironment } from "./seed_env_guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const generatedAt = new Date();
const environment = resolveE2eEnvironment({
  value: process.env.EMAIL_BINDING_DOGFOOD_ENV,
  defaultEnv: "local",
  scriptName: "email-binding-dogfood",
});
if (environment !== "local") {
  throw new Error("email-binding-dogfood currently supports local-real only.");
}
process.env.SYNAPSE_E2E_ENV ||= "local";
process.env.SYNAPSE_SEED_ENV ||= "local";

const LOCAL_REAL_CONFIRM = "I_UNDERSTAND_THIS_SENDS_REAL_LOCAL_EMAIL";
const deliveryMode = String(
  process.env.EMAIL_BINDING_DOGFOOD_DELIVERY_MODE || "real"
)
  .trim()
  .toLowerCase();
const isRealDelivery = deliveryMode === "real";
const localGatewayEnv = readDotenvFile(
  path.join(ROOT, "services/gateway/.env.local")
);
const privateGatewayEnv = readDotenvFile(
  path.join(ROOT, "services/gateway/.env.local.private")
);
const mergedLocalEnv = {
  ...localGatewayEnv,
  ...privateGatewayEnv,
  ...process.env,
};
const timestamp = generatedAt
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "Z");
const runId =
  process.env.EMAIL_BINDING_DOGFOOD_RUN_ID ||
  `email-bind-local-${Date.now().toString(36)}`;
const evidenceDir = path.resolve(
  process.env.EMAIL_BINDING_DOGFOOD_EVIDENCE_DIR ||
    path.join(ROOT, "output/dogfood/email-binding", `${timestamp}-local-real`)
);
const screenshotsDir = path.join(evidenceDir, "screenshots");
const defaultLocalDsn =
  "postgresql://synapse_gateway_app:local-dev-gateway-app-password@localhost:5432/synapse_gateway";
const postgresDsn =
  process.env.EMAIL_BINDING_POSTGRES_DSN ||
  process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
  mergedLocalEnv.POSTGRES_DSN ||
  defaultLocalDsn;
const gatewayBaseUrl = (
  process.env.GATEWAY_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const userFrontUrl = (
  process.env.USER_FRONT_URL || "http://localhost:3000"
).replace(/\/+$/, "");
const testEmail = (
  process.env.EMAIL_BINDING_TEST_EMAIL ||
  process.env.SUPPORT_CASE_TEST_EMAIL ||
  "niubidecc@gmail.com"
)
  .trim()
  .toLowerCase();
const changeEmail = (
  process.env.EMAIL_BINDING_CHANGE_TEST_EMAIL ||
  testEmail.replace("@", `+synapse-change-${runId}@`)
)
  .trim()
  .toLowerCase();
const defaultLocalAuthorKey =
  "0x7c852118294f1a460a80c7c33d7409ea91c8436518e91e202d1f5f9e3544eb07";
const ownerKey =
  process.env.EMAIL_BINDING_E2E_OWNER_KEY ||
  process.env.SUPPORT_CASE_E2E_AUTHOR_KEY ||
  defaultLocalAuthorKey;

assertSeedEnvironment({
  scriptName: "email-binding-dogfood",
  dsn: postgresDsn,
  urls: [gatewayBaseUrl, userFrontUrl],
});

const steps = [];
const failed = [];
const warnings = [];
const trace = [];
const screenshots = [];
const screenshotEvidence = [];
const apiEvidence = {};
const dbEvidence = {};
const emailEvidence = {};
const forbiddenScreenshotText = [
  /^Connect Wallet$/i,
  /^Please connect your wallet/i,
  /\bSign In\b/i,
  /Wallet not connected/i,
];
const forbiddenPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\b0x[a-fA-F0-9]{64,}\b/,
  /private[_-]?key\s*[:=]/i,
  /signature\s*[:=]/i,
  /https:\/\/open\.larksuite\.com\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+/i,
];

fs.mkdirSync(screenshotsDir, { recursive: true });

function redact(value) {
  return String(value ?? "")
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://[REDACTED]@")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[REDACTED_BEARER]")
    .replace(/\b0x[a-fA-F0-9]{64,}\b/g, "0x[REDACTED]")
    .replace(
      /\b(?:private[_-]?key|signature|secret|token|password)\s*[:=]\s*[^\s,;"']+/gi,
      "[REDACTED_SENSITIVE_FIELD]"
    )
    .replace(/\b\d{6}\b/g, "[REDACTED_CODE]");
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

function sha256Text(value) {
  return crypto
    .createHash("sha256")
    .update(String(value ?? ""))
    .digest("hex");
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
  const message = redact(
    error instanceof Error ? error.message : String(error)
  );
  steps.push({ name, ok: false, error: message });
  failed.push({ name, detail: message });
  traceEvent("step", { name, ok: false, error: message });
  console.error(`FAIL ${name} - ${message}`);
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
      // Continue.
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

function findPidByPort(port) {
  return spawnSync(
    "bash",
    [
      "-lc",
      `lsof -t -nP -iTCP:${Number(
        port
      )} -sTCP:LISTEN 2>/dev/null | head -n 1 || true`,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
    }
  ).stdout.trim();
}

function stopPid(pid) {
  if (!pid) return;
  spawnSync("kill", [pid], { cwd: ROOT, encoding: "utf8" });
  const stillRunning = spawnSync(
    "bash",
    ["-lc", `kill -0 ${Number(pid)} >/dev/null 2>&1`],
    {
      cwd: ROOT,
      encoding: "utf8",
    }
  );
  if (stillRunning.status === 0) {
    spawnSync("kill", ["-9", pid], { cwd: ROOT, encoding: "utf8" });
  }
}

async function waitForUrl(url, timeoutMs = 120000) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function api(pathname, { method = "GET", token, address, body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (address) headers["X-User-Address"] = address;
  const url = `${gatewayBaseUrl}/api${pathname}`;
  let response;
  let lastNetworkError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      break;
    } catch (error) {
      lastNetworkError = error;
      if (attempt >= 3) break;
      traceEvent("api_retry", {
        method,
        pathname,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  if (!response) {
    throw (
      lastNetworkError ||
      new Error(`${method} ${pathname} failed before response`)
    );
  }
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

async function authenticateOwner() {
  const wallet = new ethers.Wallet(ownerKey);
  const challenge = await api(
    `/v1/auth/challenge?address=${encodeURIComponent(wallet.address)}`
  );
  const message = challenge.challenge || challenge.message;
  if (!message) throw new Error("Auth challenge missing message.");
  const signature = await wallet.signMessage(message);
  const verified = await api("/v1/auth/verify", {
    method: "POST",
    body: { wallet_address: wallet.address, message, signature },
  });
  const token = verified.access_token || verified.token || verified.accessToken;
  if (!token) throw new Error("Auth verification did not return a token.");
  return {
    address: wallet.address.toLowerCase(),
    token,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    wallet,
  };
}

function validateProfile() {
  if (
    isRealDelivery &&
    process.env.EMAIL_BINDING_LOCAL_REAL_CONFIRM !== LOCAL_REAL_CONFIRM
  ) {
    throw new Error(
      `Set EMAIL_BINDING_LOCAL_REAL_CONFIRM=${LOCAL_REAL_CONFIRM} before sending a real local email.`
    );
  }
  assertLocalDsn("EMAIL_BINDING_POSTGRES_DSN", postgresDsn, {
    allowEmpty: false,
  });
  assertLocalHttpUrl("GATEWAY_BASE_URL", gatewayBaseUrl);
  assertLocalHttpUrl("USER_FRONT_URL", userFrontUrl);
  if (!testEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(testEmail)) {
    throw new Error(
      `EMAIL_BINDING_TEST_EMAIL is invalid: ${testEmail || "<empty>"}`
    );
  }
  if (
    isRealDelivery &&
    (!mergedLocalEnv.GMAIL_SMTP_USERNAME ||
      !mergedLocalEnv.GMAIL_SMTP_APP_PASSWORD)
  ) {
    throw new Error(
      "GMAIL_SMTP_USERNAME and GMAIL_SMTP_APP_PASSWORD are required for local-real email binding dogfood."
    );
  }
  pass("local_profile", "local email binding profile validated");
}

function restartGatewayForEmail() {
  exec("bash", ["scripts/local/restart_gateway.sh"], {
    env: {
      ...process.env,
      LOCAL_GATEWAY_POSTGRES_DSN: postgresDsn,
      POSTGRES_DSN: postgresDsn,
      EMAIL_OUTBOX_ENABLED: "true",
      EMAIL_TRANSPORT: mergedLocalEnv.EMAIL_TRANSPORT || "gmail_smtp",
      EMAIL_FROM:
        mergedLocalEnv.EMAIL_FROM ||
        "Synapse Network Local <local@synapse.test>",
      EMAIL_REPLY_TO:
        mergedLocalEnv.EMAIL_REPLY_TO || "support@synapse-network.ai",
      GMAIL_SMTP_USERNAME: mergedLocalEnv.GMAIL_SMTP_USERNAME || "",
      GMAIL_SMTP_APP_PASSWORD: mergedLocalEnv.GMAIL_SMTP_APP_PASSWORD || "",
      PUBLIC_APP_BASE_URL:
        mergedLocalEnv.PUBLIC_APP_BASE_URL || "http://localhost:3000",
      STARTUP_TIMEOUT_SEC: process.env.STARTUP_TIMEOUT_SEC || "40",
    },
  });
}

async function restartUserFrontForE2e() {
  const existingPid = findPidByPort(3000);
  stopPid(existingPid);
  const logFile = path.join(ROOT, "services/user-front/frontend_dev.log");
  const output = fs.openSync(logFile, "a");
  const child = spawn("yarn", ["dev", "--hostname", "0.0.0.0"], {
    cwd: path.join(ROOT, "services/user-front"),
    detached: true,
    env: {
      ...process.env,
      NEXT_PUBLIC_APP_ENV: "local",
      NEXT_PUBLIC_GATEWAY_BASE_URL: gatewayBaseUrl,
      NEXT_PUBLIC_ANALYTICS_ENDPOINT: `${gatewayBaseUrl}/api/v1/events`,
    },
    stdio: ["ignore", output, output],
  });
  child.unref();
  await waitForUrl(`${userFrontUrl}/dashboard/account/settings`, 120000);
  return "user-front restarted with local E2E public env";
}

async function assertReachable(name, url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok)
    throw new Error(`${name} not reachable: ${response.status} ${url}`);
  return `${name} ${response.status}`;
}

function resetOwnerEmailState(owner) {
  psql(`
    UPDATE synapse_owner_accounts
    SET email = NULL,
        email_verified = FALSE,
        pending_email = NULL,
        email_verification_code_hash = NULL,
        email_verification_expires_at = NULL,
        email_verification_attempts = 0,
        email_verification_requested_at = NULL,
        email_verification_send_count = 0,
        email_verification_send_count_date = NULL,
        updated_at = NOW()
    WHERE lower(email) = lower(${sqlLiteral(testEmail)})
       OR lower(pending_email) = lower(${sqlLiteral(testEmail)})
       OR lower(email) = lower(${sqlLiteral(changeEmail)})
       OR lower(pending_email) = lower(${sqlLiteral(changeEmail)});

    INSERT INTO synapse_owner_accounts (
      owner_id, owner_wallet, display_name, email, email_verified,
      notify_marketing, notify_alerts, status, created_at, updated_at
    )
    SELECT
      lower(${sqlLiteral(owner)}), lower(${sqlLiteral(
    owner
  )}), 'Email Binding Dogfood',
      NULL, FALSE, TRUE, TRUE, 'active', NOW(), NOW()
    WHERE NOT EXISTS (
      SELECT 1 FROM synapse_owner_accounts
      WHERE lower(owner_wallet) = lower(${sqlLiteral(owner)})
    );

    UPDATE synapse_owner_accounts
    SET display_name = 'Email Binding Dogfood',
      email = NULL,
      email_verified = FALSE,
      pending_email = NULL,
      email_verification_code_hash = NULL,
      email_verification_expires_at = NULL,
      email_verification_attempts = 0,
      email_verification_requested_at = NULL,
      email_verification_send_count = 0,
      email_verification_send_count_date = NULL,
      notify_marketing = TRUE,
      notify_alerts = TRUE,
      status = 'active',
      updated_at = NOW()
    WHERE lower(owner_wallet) = lower(${sqlLiteral(owner)});

    DELETE FROM synapse_notification_outbox
    WHERE template_key = 'email_verification'
      AND (
        recipient_owner_id = lower(${sqlLiteral(owner)})
        OR recipient_email IN (lower(${sqlLiteral(
          testEmail
        )}), lower(${sqlLiteral(changeEmail)}))
      );

    DELETE FROM synapse_notification_delivery_log
    WHERE recipient_owner_id = lower(${sqlLiteral(owner)})
      AND template_key = 'email_verification'
      AND recipient_email IN (lower(${sqlLiteral(
        testEmail
      )}), lower(${sqlLiteral(changeEmail)}));
  `);
}

async function requestEmailBinding(ownerAuth) {
  const payload = {
    displayName: `Email Binding Dogfood ${runId}`,
    email: testEmail,
    notifyMarketing: true,
    notifyAlerts: true,
  };
  const challenge = await api("/v1/auth/me/profile/challenge", {
    method: "POST",
    token: ownerAuth.token,
    address: ownerAuth.address,
    body: payload,
  });
  const message = challenge.challenge || challenge.message;
  if (!message) throw new Error("profile challenge missing message");
  const signature = await ownerAuth.wallet.signMessage(message);
  const saved = await api("/v1/auth/me/profile", {
    method: "PUT",
    token: ownerAuth.token,
    address: ownerAuth.address,
    body: { ...payload, message, signature },
  });
  if (String(saved.profile?.pendingEmail || "").toLowerCase() !== testEmail) {
    throw new Error(
      `profile did not enter pending email state: ${JSON.stringify(
        redactDeep(saved)
      ).slice(0, 600)}`
    );
  }
  if (String(saved.profile?.email || "")) {
    throw new Error("profile email was bound before code verification");
  }
  return saved.profile;
}

async function signedProfileUpdate(ownerAuth, payload) {
  const challenge = await api("/v1/auth/me/profile/challenge", {
    method: "POST",
    token: ownerAuth.token,
    address: ownerAuth.address,
    body: payload,
  });
  const message = challenge.challenge || challenge.message;
  if (!message) throw new Error("profile challenge missing message");
  const signature = await ownerAuth.wallet.signMessage(message);
  return api("/v1/auth/me/profile", {
    method: "PUT",
    token: ownerAuth.token,
    address: ownerAuth.address,
    body: { ...payload, message, signature },
  });
}

async function requestEmailChange(ownerAuth) {
  const payload = {
    displayName: `Email Binding Dogfood ${runId}`,
    email: changeEmail,
    notifyMarketing: true,
    notifyAlerts: true,
  };
  const saved = await signedProfileUpdate(ownerAuth, payload);
  if (String(saved.profile?.email || "").toLowerCase() !== testEmail) {
    throw new Error(
      `old verified email was not preserved during pending change: ${JSON.stringify(
        redactDeep(saved)
      ).slice(0, 600)}`
    );
  }
  if (String(saved.profile?.pendingEmail || "").toLowerCase() !== changeEmail) {
    throw new Error(
      `profile did not stage change email: ${JSON.stringify(
        redactDeep(saved)
      ).slice(0, 600)}`
    );
  }
  return saved.profile;
}

async function cancelEmailChange(ownerAuth) {
  const payload = {
    displayName: `Email Binding Dogfood ${runId}`,
    email: testEmail,
    notifyMarketing: true,
    notifyAlerts: true,
  };
  const saved = await signedProfileUpdate(ownerAuth, payload);
  if (String(saved.profile?.email || "").toLowerCase() !== testEmail) {
    throw new Error("verified email changed while cancelling pending email");
  }
  if (saved.profile?.pendingEmail) {
    throw new Error("pending email was not cleared by cancel change");
  }
  return saved.profile;
}

async function removeEmail(ownerAuth) {
  const payload = {
    displayName: `Email Binding Dogfood ${runId}`,
    email: null,
    notifyMarketing: true,
    notifyAlerts: true,
  };
  const saved = await signedProfileUpdate(ownerAuth, payload);
  if (saved.profile?.email) {
    throw new Error("email was not removed");
  }
  if (saved.profile?.emailVerified) {
    throw new Error("emailVerified remained true after removal");
  }
  if (saved.profile?.pendingEmail) {
    throw new Error("pendingEmail remained after removal");
  }
  return saved.profile;
}

function readPendingCode(owner, email = testEmail) {
  const row = queryJson(`
    SELECT row_to_json(result)
    FROM (
      SELECT
        notification_id AS "notificationId",
        recipient_email AS "recipientEmail",
        status,
        payload->>'verificationCode' AS "verificationCode",
        payload->>'expiresInMinutes' AS "expiresInMinutes",
        dedupe_key AS "dedupeKey"
      FROM synapse_notification_outbox
      WHERE recipient_owner_id = lower(${sqlLiteral(owner)})
        AND recipient_email = lower(${sqlLiteral(email)})
        AND template_key = 'email_verification'
      ORDER BY created_at DESC
      LIMIT 1
    ) result
  `);
  if (!row?.verificationCode)
    throw new Error("verification code outbox row missing");
  return row;
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
        EMAIL_TRANSPORT: mergedLocalEnv.EMAIL_TRANSPORT || "gmail_smtp",
        EMAIL_FROM:
          mergedLocalEnv.EMAIL_FROM ||
          "Synapse Network Local <local@synapse.test>",
        EMAIL_REPLY_TO:
          mergedLocalEnv.EMAIL_REPLY_TO || "support@synapse-network.ai",
        GMAIL_SMTP_USERNAME: mergedLocalEnv.GMAIL_SMTP_USERNAME || "",
        GMAIL_SMTP_APP_PASSWORD: mergedLocalEnv.GMAIL_SMTP_APP_PASSWORD || "",
        GMAIL_SMTP_HOST: mergedLocalEnv.GMAIL_SMTP_HOST || "smtp.gmail.com",
        GMAIL_SMTP_PORT: mergedLocalEnv.GMAIL_SMTP_PORT || "587",
        PUBLIC_APP_BASE_URL:
          mergedLocalEnv.PUBLIC_APP_BASE_URL || "http://localhost:3000",
        ENV_FILE: "__email_binding_dogfood_no_env_file__",
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

function readEmailEvidence(
  owner,
  email = testEmail,
  templateKey = "email_verification"
) {
  const row = queryJson(`
    SELECT row_to_json(result)
    FROM (
      SELECT
        count(*) FILTER (WHERE log.template_key = 'email_verification') AS "deliveryCount",
        bool_or(log.message_id IS NOT NULL)::text AS "messageIdPresent",
        max(log.sent_at) AS "lastSentAt"
      FROM synapse_notification_delivery_log log
      WHERE log.recipient_owner_id = lower(${sqlLiteral(owner)})
        AND log.recipient_email = lower(${sqlLiteral(email)})
        AND log.template_key = ${sqlLiteral(templateKey)}
    ) result
  `);
  return row || {};
}

function readProfileEvidence(owner) {
  const row = queryJson(`
    SELECT row_to_json(result)
    FROM (
      SELECT
        owner_wallet AS "ownerWallet",
        email,
        email_verified AS "emailVerified",
        pending_email AS "pendingEmail",
        email_verification_send_count AS "sendCount",
        email_verification_send_count_date AS "sendCountDate"
      FROM synapse_owner_accounts
      WHERE lower(owner_wallet) = lower(${sqlLiteral(owner)})
      LIMIT 1
    ) result
  `);
  if (!row) throw new Error("owner profile missing");
  return row;
}

function describeExpectation(expectation) {
  if (typeof expectation === "string") return expectation;
  if (expectation instanceof RegExp) return expectation.source;
  return expectation.description || expectation.selector || String(expectation);
}

async function waitForExpectedVisible(page, expectedVisible) {
  const entries = Array.isArray(expectedVisible)
    ? expectedVisible
    : [expectedVisible];
  const expectedText = [];
  for (const expectation of entries.filter(Boolean)) {
    if (typeof expectation === "string" || expectation instanceof RegExp) {
      await page
        .getByText(expectation)
        .first()
        .waitFor({ state: "visible", timeout: 20000 });
      expectedText.push(describeExpectation(expectation));
      continue;
    }
    if (expectation.selector) {
      await page
        .locator(expectation.selector)
        .first()
        .waitFor({ state: "visible", timeout: 20000 });
      expectedText.push(describeExpectation(expectation));
    }
  }
  return expectedText;
}

async function assertForbiddenTextAbsent(
  page,
  forbiddenVisible = forbiddenScreenshotText
) {
  const visible = [];
  for (const pattern of forbiddenVisible) {
    const locator = page.getByText(pattern).first();
    const isVisible = await locator
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (isVisible) visible.push(pattern.source || String(pattern));
  }
  if (visible.length > 0) {
    throw new Error(
      `SCREENSHOT_BLOCKED_BY_AUTH_MASK: forbidden text visible before screenshot: ${visible.join(
        ", "
      )}`
    );
  }
  return true;
}

async function screenshot(page, fileName, options = {}) {
  const expectedText = await waitForExpectedVisible(
    page,
    options.expectedVisible || []
  );
  const forbiddenTextAbsent = await assertForbiddenTextAbsent(
    page,
    options.forbiddenVisible || forbiddenScreenshotText
  );
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 5000 })
    .catch(() => "");
  const fullPath = path.join(screenshotsDir, fileName);
  await page.screenshot({ path: fullPath, fullPage: false });
  const record = {
    file: `screenshots/${fileName}`,
    url: page.url(),
    expectedText,
    forbiddenTextAbsent,
    domCheckpoint: {
      expectedVisible: expectedText.length > 0,
      bodyTextDigest: sha256Text(bodyText),
      bodyTextLength: bodyText.length,
    },
    dbCheckpoint: redactDeep(options.dbCheckpoint || {}),
    capturedAt: new Date().toISOString(),
  };
  screenshots.push(record);
  screenshotEvidence.push(record);
  traceEvent("screenshot", record);
}

async function verifyInUi(ownerAuth, code) {
  const browser = await chromium.launch({
    headless: process.env.EMAIL_BINDING_DOGFOOD_HEADLESS !== "0",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  try {
    await context.addInitScript(
      (session) => {
        localStorage.setItem("synapse_lang", "en");
        localStorage.setItem("a2a_auth_session", JSON.stringify(session));
        localStorage.setItem(
          "developer_session",
          JSON.stringify({ wallet: session.wallet })
        );
        localStorage.setItem("synapse_e2e_wallet_connected", "1");
      },
      {
        token: ownerAuth.token,
        wallet: ownerAuth.address,
        expiresAt: ownerAuth.expiresAt,
      }
    );
    const page = await context.newPage();
    await page.goto(`${userFrontUrl}/dashboard/account/settings`, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await screenshot(page, "settings-pending-email.png", {
      expectedVisible: [
        /Verification pending for/i,
        {
          selector: "#account-settings-email",
          description: "email settings input",
        },
      ],
      dbCheckpoint: {
        state: "pending",
        pendingEmailHash: sha256Text(testEmail),
      },
    });
    await page
      .getByRole("button", { name: /Enter verification code/i })
      .evaluate((button) => {
        button.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
      });
    await page
      .getByRole("heading", { name: /Verify email/i })
      .waitFor({ state: "visible", timeout: 20000 });
    await screenshot(page, "email-verification-modal.png", {
      expectedVisible: [
        /Verify email/i,
        {
          selector: "#account-email-verification-code",
          description: "verification code input",
        },
      ],
      dbCheckpoint: {
        state: "verification-modal",
        pendingEmailHash: sha256Text(testEmail),
      },
    });
    await page
      .getByRole("textbox", { name: /Email verification code/i })
      .fill(code);
    await page.getByRole("button", { name: /^Verify email$/i }).click();
    await page
      .getByText(/Email verified and linked|Verified email/i)
      .first()
      .waitFor({ state: "visible", timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(500);
    await screenshot(page, "settings-email-verified.png", {
      expectedVisible: [/Verified/i, /Linked to this wallet/i],
      dbCheckpoint: {
        state: "verified",
        emailHash: sha256Text(testEmail),
        emailVerified: true,
      },
    });
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function screenshotLifecycle(ownerAuth) {
  const browser = await chromium.launch({
    headless: process.env.EMAIL_BINDING_DOGFOOD_HEADLESS !== "0",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  try {
    await context.addInitScript(
      (session) => {
        localStorage.setItem("synapse_lang", "en");
        localStorage.setItem("a2a_auth_session", JSON.stringify(session));
        localStorage.setItem(
          "developer_session",
          JSON.stringify({ wallet: session.wallet })
        );
        localStorage.setItem("synapse_e2e_wallet_connected", "1");
      },
      {
        token: ownerAuth.token,
        wallet: ownerAuth.address,
        expiresAt: ownerAuth.expiresAt,
      }
    );
    const page = await context.newPage();
    await page.goto(`${userFrontUrl}/dashboard/account/settings`, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await page
      .getByRole("button", { name: /Cancel email change/i })
      .waitFor({ state: "visible", timeout: 20000 });
    await screenshot(page, "settings-change-pending.png", {
      expectedVisible: [/Verification pending for/i, /Cancel email change/i],
      dbCheckpoint: {
        state: "change-pending",
        emailHash: sha256Text(testEmail),
        pendingEmailHash: sha256Text(changeEmail),
      },
    });
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function screenshotRemoved(ownerAuth) {
  const browser = await chromium.launch({
    headless: process.env.EMAIL_BINDING_DOGFOOD_HEADLESS !== "0",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  try {
    await context.addInitScript(
      (session) => {
        localStorage.setItem("synapse_lang", "en");
        localStorage.setItem("a2a_auth_session", JSON.stringify(session));
        localStorage.setItem(
          "developer_session",
          JSON.stringify({ wallet: session.wallet })
        );
        localStorage.setItem("synapse_e2e_wallet_connected", "1");
      },
      {
        token: ownerAuth.token,
        wallet: ownerAuth.address,
        expiresAt: ownerAuth.expiresAt,
      }
    );
    const page = await context.newPage();
    await page.goto(`${userFrontUrl}/dashboard/account/settings`, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await screenshot(page, "settings-email-removed.png", {
      expectedVisible: [
        {
          selector: "#account-settings-email",
          description: "empty email input",
        },
        /Optional/i,
      ],
      dbCheckpoint: { state: "removed", emailVerified: false },
    });
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function checkRedaction(name, value) {
  const text = JSON.stringify(value);
  const leaked = forbiddenPatterns.find((pattern) => pattern.test(text));
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
    deliveryMode,
    generatedAt: generatedAt.toISOString(),
    runId,
    testEmailHash: sha256(testEmail),
    changeEmailHash: sha256(changeEmail),
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
              "- Screenshot: see screenshots/",
              "- API Evidence: api-evidence.json",
              "- DB Evidence: db-evidence.json",
              "- Repro Steps: rerun npm run e2e:email-binding:local-real",
              "- Expected: email binding flow passes",
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
      "# Email Binding Dogfood local-real",
      "",
      `- Status: ${report.status}`,
      `- Run ID: ${runId}`,
      `- Generated: ${report.generatedAt}`,
      `- Test email hash: ${report.testEmailHash}`,
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
      ...screenshots.map(
        (item) => `- ${item.file}: ${item.expectedText.join(", ")}`
      ),
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
    path.join(evidenceDir, "email-evidence.json"),
    `${JSON.stringify(redactDeep(emailEvidence), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(evidenceDir, "screenshot-evidence.json"),
    `${JSON.stringify(redactDeep(screenshotEvidence), null, 2)}\n`
  );
}

async function main() {
  try {
    validateProfile();
    await step("restart_gateway_email_config", () => {
      restartGatewayForEmail();
      return "gateway restarted with local Gmail SMTP settings";
    });
    await step("restart_user_front_e2e_config", () => restartUserFrontForE2e());
    await step("gateway_health", () =>
      assertReachable("gateway", `${gatewayBaseUrl}/health`)
    );
    await step("user_front_health", () =>
      assertReachable("user-front", userFrontUrl)
    );
    const ownerAuth = await step("owner_auth", authenticateOwner);
    if (!ownerAuth) throw new Error("owner auth failed");
    await step("reset_local_owner_email_state", () => {
      resetOwnerEmailState(ownerAuth.address);
      return "local owner email state reset";
    });
    apiEvidence.profileUpdate = await step("request_email_binding", () =>
      requestEmailBinding(ownerAuth)
    );
    const codeRow = await step("read_email_verification_code", () =>
      readPendingCode(ownerAuth.address)
    );
    if (!codeRow) throw new Error("verification code missing");
    dbEvidence.pending = { ...codeRow, verificationCode: "[REDACTED_CODE]" };
    await step("send_verification_email", () => {
      const output = runLocalOutboxWorker();
      emailEvidence.outboxWorker = output;
      const delivery = readEmailEvidence(ownerAuth.address);
      if (Number(delivery.deliveryCount || 0) < 1) {
        throw new Error("email_verification delivery log missing");
      }
      emailEvidence.delivery = delivery;
      return `deliveryCount=${delivery.deliveryCount}`;
    });
    await step("verify_email_in_ui", () =>
      verifyInUi(ownerAuth, codeRow.verificationCode)
    );
    dbEvidence.verified = await step("db_email_verified", () => {
      const profile = readProfileEvidence(ownerAuth.address);
      if (String(profile.email || "").toLowerCase() !== testEmail) {
        throw new Error(`email not bound: ${profile.email || "<empty>"}`);
      }
      if (!profile.emailVerified) throw new Error("email_verified is false");
      if (profile.pendingEmail)
        throw new Error("pending_email was not cleared");
      return profile;
    });
    apiEvidence.changeRequest = await step("request_email_change", () =>
      requestEmailChange(ownerAuth)
    );
    dbEvidence.changePending = await step("db_email_change_pending", () => {
      const profile = readProfileEvidence(ownerAuth.address);
      if (String(profile.email || "").toLowerCase() !== testEmail) {
        throw new Error(
          "old verified email not preserved during pending change"
        );
      }
      if (String(profile.pendingEmail || "").toLowerCase() !== changeEmail) {
        throw new Error(
          `pendingEmail mismatch: ${profile.pendingEmail || "<empty>"}`
        );
      }
      return profile;
    });
    await step("screenshot_email_change_pending", () =>
      screenshotLifecycle(ownerAuth)
    );
    const changeCodeRow = await step(
      "read_change_email_verification_code",
      () => readPendingCode(ownerAuth.address, changeEmail)
    );
    if (!changeCodeRow) throw new Error("change verification code missing");
    dbEvidence.changePendingCode = {
      ...changeCodeRow,
      verificationCode: "[REDACTED_CODE]",
    };
    await step("send_change_verification_email", () => {
      const output = runLocalOutboxWorker();
      emailEvidence.changeOutboxWorker = output;
      const delivery = readEmailEvidence(ownerAuth.address, changeEmail);
      if (Number(delivery.deliveryCount || 0) < 1) {
        throw new Error("change email verification delivery log missing");
      }
      emailEvidence.changeDelivery = delivery;
      return `deliveryCount=${delivery.deliveryCount}`;
    });
    apiEvidence.cancelChange = await step("cancel_email_change", () =>
      cancelEmailChange(ownerAuth)
    );
    dbEvidence.changeCancelled = await step("db_email_change_cancelled", () => {
      const profile = readProfileEvidence(ownerAuth.address);
      if (String(profile.email || "").toLowerCase() !== testEmail) {
        throw new Error("verified email changed after cancel");
      }
      if (profile.pendingEmail)
        throw new Error("pendingEmail not cleared after cancel");
      return profile;
    });
    apiEvidence.removeEmail = await step("remove_email", () =>
      removeEmail(ownerAuth)
    );
    dbEvidence.removed = await step("db_email_removed", () => {
      const profile = readProfileEvidence(ownerAuth.address);
      if (profile.email) throw new Error("email not cleared after remove");
      if (profile.emailVerified)
        throw new Error("emailVerified still true after remove");
      if (profile.pendingEmail)
        throw new Error("pendingEmail still set after remove");
      return profile;
    });
    await step("send_email_removed_notice", () => {
      const output = runLocalOutboxWorker();
      emailEvidence.removedNoticeWorker = output;
      const delivery = readEmailEvidence(
        ownerAuth.address,
        testEmail,
        "email_removed_notice"
      );
      emailEvidence.removedNoticeDelivery = delivery;
      return `deliveryCount=${delivery.deliveryCount || 0}`;
    });
    await step("screenshot_email_removed", () => screenshotRemoved(ownerAuth));
    await step("evidence_redaction", () => {
      checkRedaction("api evidence", apiEvidence);
      checkRedaction("db evidence", dbEvidence);
      checkRedaction("email evidence", emailEvidence);
      checkRedaction("trace", trace);
      return "no secret-like values in evidence";
    });
  } catch (error) {
    failStep("fatal", error);
  } finally {
    writeOutputs();
  }
  if (failed.length > 0) {
    console.error(`Email binding dogfood failed. Evidence: ${evidenceDir}`);
    process.exit(1);
  }
  console.log(`Email binding dogfood passed. Evidence: ${evidenceDir}`);
}

main();
