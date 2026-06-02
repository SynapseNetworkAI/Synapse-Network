#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
const STAGING_HOST_RE = /(^|\.)synapse-network\.ai$/i;
const STAGING_MARKERS_RE =
  /(api-staging\.synapse-network\.ai|admin-api-staging\.synapse-network\.ai|provider-staging\.synapse-network\.ai|staging\.synapse-network\.ai|arb-sepolia|arbitrum-sepolia|fabled-archive-494108-k5|synapse-staging-|\/cloudsql\/)/i;

export function readDotenvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const parsed = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    parsed[match[1]] = value;
  }
  return parsed;
}

export function resolveE2eEnvironment({
  value,
  defaultEnv = "local",
  scriptName = "e2e",
} = {}) {
  const raw = String(value || process.env.SYNAPSE_E2E_ENV || defaultEnv || "")
    .trim()
    .toLowerCase();
  if (!["local", "staging"].includes(raw)) {
    throw new Error(
      `${scriptName}: SYNAPSE_E2E_ENV must be local or staging; got ${
        raw || "<empty>"
      }`
    );
  }
  if (raw === "local" && hasShellProjectContext()) {
    process.stderr.write(
      `[e2e-env-guard] warning: Google project context is present but ignored in local E2E (${scriptName}).\n`
    );
  }
  return raw;
}

export function hasShellProjectContext() {
  return Boolean(
    process.env.PROJECT_ID ||
      process.env.GCP_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.CLOUDSDK_CORE_PROJECT ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
}

export function projectIdFromEnv() {
  return (
    process.env.PROJECT_ID ||
    process.env.GCP_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.CLOUDSDK_CORE_PROJECT ||
    ""
  ).trim();
}

export function isLocalHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return (
      ["http:", "https:"].includes(url.protocol) &&
      LOCAL_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

export function isStagingHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && STAGING_HOST_RE.test(url.hostname);
  } catch {
    return false;
  }
}

export function assertLocalHttpUrl(name, value) {
  if (!isLocalHttpUrl(value)) {
    throw new Error(
      `LOCAL_E2E_REFUSES_NON_LOCAL_ENDPOINT: ${name}=${value || "<empty>"}`
    );
  }
}

export function assertStagingHttpUrl(name, value) {
  if (!isStagingHttpUrl(value)) {
    throw new Error(
      `STAGING_E2E_REQUIRES_STAGING_ENDPOINT: ${name}=${value || "<empty>"}`
    );
  }
}

export function assertLocalValue(
  name,
  value,
  { allowExternalWebhook = false, allowEmpty = true } = {}
) {
  const text = String(value || "");
  if (!text) {
    if (allowEmpty) return;
    throw new Error(`LOCAL_E2E_MISSING_REQUIRED_VALUE: ${name}`);
  }
  if (
    allowExternalWebhook &&
    /^https:\/\/open\.larksuite\.com\/open-apis\/bot\/v2\/hook\//i.test(text)
  ) {
    return;
  }
  if (STAGING_MARKERS_RE.test(text)) {
    throw new Error(`LOCAL_E2E_REFUSES_STAGING_VALUE: ${name}`);
  }
}

export function assertLocalDsn(name, value, { allowEmpty = true } = {}) {
  const text = String(value || "");
  if (!text) {
    if (allowEmpty) return;
    throw new Error(`LOCAL_E2E_MISSING_REQUIRED_DSN: ${name}`);
  }
  assertLocalValue(name, text, { allowEmpty: false });
  if (!/(@|\b)(localhost|127\.0\.0\.1)(:|\/)/i.test(text)) {
    throw new Error(`LOCAL_E2E_REFUSES_NON_LOCAL_DSN: ${name}`);
  }
}

export function assertStagingProxyDsn(name, value, { allowEmpty = true } = {}) {
  const text = String(value || "");
  if (!text) {
    if (allowEmpty) return;
    throw new Error(`STAGING_E2E_MISSING_REQUIRED_DSN: ${name}`);
  }
  if (!/(@|\b)(localhost|127\.0\.0\.1)(:|\/)/i.test(text)) {
    throw new Error(`STAGING_E2E_REQUIRES_CLOUD_SQL_AUTH_PROXY_DSN: ${name}`);
  }
}

export function requireStagingConfirmation(name, expected) {
  if (process.env[name] !== expected) {
    throw new Error(`Set ${name}=${expected} before running live staging E2E.`);
  }
}

export function readStagingSecret(
  secretId,
  { projectId = projectIdFromEnv(), required = false } = {}
) {
  const envName = String(process.env.SYNAPSE_E2E_ENV || "")
    .trim()
    .toLowerCase();
  if (envName !== "staging") {
    throw new Error(
      `LOCAL_E2E_FORBIDS_GCP_SECRET_MANAGER: attempted to read ${secretId}`
    );
  }
  if (process.env.ALLOW_GCP_SECRET_MANAGER !== "1") {
    throw new Error(
      `STAGING_E2E_REQUIRES_ALLOW_GCP_SECRET_MANAGER: attempted to read ${secretId}`
    );
  }
  if (!/^synapse-staging-[A-Za-z0-9_-]+$/.test(secretId)) {
    throw new Error(`STAGING_E2E_FORBIDS_NON_STAGING_SECRET: ${secretId}`);
  }
  if (!projectId) {
    if (required)
      throw new Error(`STAGING_E2E_MISSING_PROJECT_ID: ${secretId}`);
    return "";
  }
  try {
    return execFileSync(
      "gcloud",
      [
        "secrets",
        "versions",
        "access",
        "latest",
        `--secret=${secretId}`,
        `--project=${projectId}`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
  } catch (error) {
    if (required) {
      throw new Error(
        `STAGING_E2E_SECRET_READ_FAILED: ${secretId}: ${error.message}`
      );
    }
    return "";
  }
}

export function readProductionSecret(
  secretId,
  {
    projectId = projectIdFromEnv() || "synapse-network-prod",
    required = false,
    confirmEnv = "PROD_E2E_CONFIRM",
    confirmValue = "I_UNDERSTAND_THIS_MUTATES_PRODUCTION",
  } = {}
) {
  const envName = String(process.env.SYNAPSE_E2E_ENV || "")
    .trim()
    .toLowerCase();
  if (envName !== "prod") {
    throw new Error(
      `NON_PROD_E2E_FORBIDS_PROD_SECRET_MANAGER: attempted to read ${secretId}`
    );
  }
  if (process.env.ALLOW_GCP_SECRET_MANAGER !== "1") {
    throw new Error(
      `PROD_E2E_REQUIRES_ALLOW_GCP_SECRET_MANAGER: attempted to read ${secretId}`
    );
  }
  if (process.env[confirmEnv] !== confirmValue) {
    throw new Error(
      `Set ${confirmEnv}=${confirmValue} before reading ${secretId}.`
    );
  }
  if (!/^synapse-prod-[A-Za-z0-9_-]+$/.test(secretId)) {
    throw new Error(`PROD_E2E_FORBIDS_NON_PROD_SECRET: ${secretId}`);
  }
  if (!projectId) {
    if (required) throw new Error(`PROD_E2E_MISSING_PROJECT_ID: ${secretId}`);
    return "";
  }
  try {
    return execFileSync(
      "gcloud",
      [
        "secrets",
        "versions",
        "access",
        "latest",
        `--secret=${secretId}`,
        `--project=${projectId}`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
  } catch (error) {
    if (required) {
      throw new Error(
        `PROD_E2E_SECRET_READ_FAILED: ${secretId}: ${error.message}`
      );
    }
    return "";
  }
}
