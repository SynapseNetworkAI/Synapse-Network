#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { generateTotpCode } from "../lib/totp_window.mjs";

const adminApi = (process.env.SYNAPSE_ADMIN_GATEWAY_BASE_URL || "https://admin-api-staging.synapse-network.ai").replace(/\/+$/, "");
const cookieName = process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session";
const email = process.env.STAGING_ADMIN_E2E_EMAIL || "staging-admin-e2e@synapse-network.ai";
const projectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.CLOUDSDK_CORE_PROJECT || "";

function shQuote(value) {
  return `'${String(value ?? "").replace(/'/g, "'\"'\"'")}'`;
}

function secret(secretId) {
  if (!projectId) return "";
  const result = spawnSync("gcloud", [
    "secrets",
    "versions",
    "access",
    "latest",
    `--secret=${secretId}`,
    `--project=${projectId}`,
  ], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function parseSessionCookie(setCookieHeader) {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader.join(",") : String(setCookieHeader || "");
  const cookie = header
    .split(/,(?=\s*[^;,]+=)/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${cookieName}=`));
  return cookie ? cookie.split(";")[0].slice(cookieName.length + 1) : "";
}

const existingSession = process.env.ADMIN_SESSION_TOKEN || process.env.SYNAPSE_ADMIN_SESSION_TOKEN || "";
const existingCsrf = process.env.ADMIN_CSRF_TOKEN || process.env.SYNAPSE_ADMIN_CSRF_TOKEN || "";
if (existingSession) {
  console.log(`export SYNAPSE_ADMIN_COOKIE_HEADER=${shQuote(`${cookieName}=${existingSession}`)}`);
  console.log(`export SYNAPSE_ADMIN_CSRF_TOKEN=${shQuote(existingCsrf)}`);
  process.exit(0);
}

const password = process.env.STAGING_ADMIN_E2E_PASSWORD || secret("synapse-staging-admin-e2e-password");
const otpSecret = process.env.STAGING_ADMIN_E2E_OTP_SECRET || secret("synapse-staging-admin-e2e-otp-secret");
if (!password || !otpSecret) {
  console.error("FATAL STAGING-ADMIN-SESSION-001: missing STAGING_ADMIN_E2E_PASSWORD/STAGING_ADMIN_E2E_OTP_SECRET or PROJECT_ID for Secret Manager lookup.");
  process.exit(1);
}

const response = await fetch(`${adminApi}/api/admin/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({
    email,
    password,
    otpCode: generateTotpCode(otpSecret),
  }),
});
const payload = await response.json().catch(() => ({}));
const setCookie = typeof response.headers.getSetCookie === "function"
  ? response.headers.getSetCookie()
  : response.headers.get("set-cookie");
const sessionToken = parseSessionCookie(setCookie);
const csrfToken = payload?.data?.csrfToken || payload?.csrfToken || "";
if (!response.ok || !payload?.success || !sessionToken) {
  console.error(`FATAL STAGING-ADMIN-SESSION-002: admin login failed: ${response.status}`);
  process.exit(1);
}

console.log(`export SYNAPSE_ADMIN_COOKIE_HEADER=${shQuote(`${cookieName}=${sessionToken}`)}`);
console.log(`export SYNAPSE_ADMIN_CSRF_TOKEN=${shQuote(csrfToken)}`);
