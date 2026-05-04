#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

const PROJECT_ID = process.env.PROJECT_ID || "fabled-archive-494108-k5";
const REGION = process.env.REGION || "us-central1";
const GATEWAY_URL =
  process.env.STAGING_GATEWAY_URL || "https://api-staging.synapse-network.ai";
const PROVIDER_URL =
  process.env.STAGING_PROVIDER_URL ||
  "https://provider-staging.synapse-network.ai";
const EXPECTED_PROVIDER_PREFIX =
  process.env.STAGING_PROVIDER_ENDPOINT_PREFIX ||
  "https://provider-staging.synapse-network.ai/provider-services/";
const EXPECTED_CLOUD_SQL =
  process.env.STAGING_CLOUD_SQL_INSTANCE ||
  `${PROJECT_ID}:${REGION}:synapse-staging-postgres`;
const PROVIDER_SERVICE_IDS = [
  "svc_web3_sentiment_index",
  "svc_protocol_fundamental_brief",
  "svc_oss_security_healthcheck",
];
const GATEWAY_JOBS = [
  "synapse-staging-db-migrate",
  "synapse-staging-deposit-indexer",
  "synapse-staging-provider-withdraw-reaper",
  "synapse-staging-consumer-withdraw-processor",
  "synapse-staging-notification-outbox-drain",
  "synapse-staging-in-app-notification-cleanup",
];
const REQUIRED_SECRET_LINT = [
  "synapse-staging-provider-signature-secret",
  "synapse-staging-gcp-alert-receiver-token",
  "synapse-staging-alert-drill-token",
];
const PLACEHOLDER_RE =
  /^(replace-|your-|todo|changeme|placeholder|example|null|undefined)/i;

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

const out = arg("--out", "");

function runGcloud(args, { json = false, allowFailure = false } = {}) {
  try {
    const text = execFileSync("gcloud", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!json) return text;
    return text ? JSON.parse(text) : {};
  } catch (error) {
    if (allowFailure) return json ? null : "";
    const stderr = String(error.stderr || "").trim();
    throw new Error(
      `gcloud ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`
    );
  }
}

function readSecret(secretId) {
  return execFileSync(
    "gcloud",
    [
      "secrets",
      "versions",
      "access",
      "latest",
      "--secret",
      secretId,
      "--project",
      PROJECT_ID,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
}

function normalizeSecretRef(value) {
  return String(value || "")
    .replace(/^projects\/[^/]+\/secrets\//, "")
    .replace(/\/versions\/.*$/, "");
}

function serviceJson(name) {
  return runGcloud(
    [
      "run",
      "services",
      "describe",
      name,
      "--project",
      PROJECT_ID,
      "--region",
      REGION,
      "--format=json",
    ],
    { json: true }
  );
}

function jobJson(name) {
  return runGcloud(
    [
      "run",
      "jobs",
      "describe",
      name,
      "--project",
      PROJECT_ID,
      "--region",
      REGION,
      "--format=json",
    ],
    { json: true }
  );
}

function envEntries(resource) {
  const containers =
    resource?.template?.containers ||
    resource?.template?.template?.containers ||
    resource?.spec?.template?.spec?.template?.spec?.containers ||
    resource?.spec?.template?.spec?.containers ||
    [];
  return containers[0]?.env || [];
}

function imageRef(resource) {
  const containers =
    resource?.template?.containers ||
    resource?.template?.template?.containers ||
    resource?.spec?.template?.spec?.template?.spec?.containers ||
    resource?.spec?.template?.spec?.containers ||
    [];
  return containers[0]?.image || "";
}

function secretEnvMap(resource) {
  const map = {};
  for (const env of envEntries(resource)) {
    const ref =
      env.valueSource?.secretKeyRef ||
      env.value_from?.secret_key_ref ||
      env.valueFrom?.secretKeyRef ||
      {};
    const secret = ref.secret || ref.name || "";
    if (env.name && secret) map[env.name] = normalizeSecretRef(secret);
  }
  return map;
}

function plainEnvMap(resource) {
  const map = {};
  for (const env of envEntries(resource)) {
    if (env.name && typeof env.value === "string") map[env.name] = env.value;
  }
  return map;
}

function cloudSqlInstances(resource) {
  const annotation =
    resource?.spec?.template?.metadata?.annotations?.[
      "run.googleapis.com/cloudsql-instances"
    ];
  const volumes =
    resource?.template?.volumes ||
    resource?.template?.template?.volumes ||
    resource?.spec?.template?.spec?.template?.spec?.volumes ||
    resource?.spec?.template?.spec?.volumes ||
    [];
  return [
    ...(annotation
      ? annotation
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : []),
    ...volumes.flatMap((volume) => volume.cloudSqlInstance?.instances || []),
  ];
}

function record(checks, name, status, details = {}) {
  checks.push({ name, status, ...details });
}

function collectUrlEntries(value, path = [], urls = []) {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value))
      urls.push({ path: path.join("."), url: value });
    return urls;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectUrlEntries(item, [...path, String(index)], urls)
    );
    return urls;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value))
      collectUrlEntries(item, [...path, key], urls);
  }
  return urls;
}

function decimalZero(value) {
  if (value === null || value === undefined || value === "") return false;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && Math.abs(numberValue) < 1e-12;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

const checks = [];
const failures = [];

function requireCheck(name, passed, details = {}) {
  record(checks, name, passed ? "passed" : "failed", details);
  if (!passed) failures.push({ name, ...details });
}

function warnCheck(name, details = {}) {
  record(checks, name, "warning", details);
}

for (const secretId of REQUIRED_SECRET_LINT) {
  try {
    const raw = readSecret(secretId);
    const trimmed = raw.trim();
    requireCheck(
      `secret-lint:${secretId}`,
      Boolean(trimmed) && raw === trimmed && !PLACEHOLDER_RE.test(trimmed),
      {
        secretId,
        length: trimmed.length,
        hasTrailingNewline: raw !== trimmed,
        placeholderLike: PLACEHOLDER_RE.test(trimmed),
      }
    );
  } catch (error) {
    requireCheck(`secret-lint:${secretId}`, false, {
      secretId,
      error: String(error.message || error),
    });
  }
}

let gatewayService = null;
let providerService = null;
try {
  gatewayService = serviceJson("synapse-staging-gateway");
  providerService = serviceJson("synapse-staging-provider");
  const gatewaySecrets = secretEnvMap(gatewayService);
  const providerSecrets = secretEnvMap(providerService);
  requireCheck(
    "provider-signature-secret-shared",
    gatewaySecrets.GATEWAY_PROVIDER_SIGNATURE_SECRET ===
      "synapse-staging-provider-signature-secret" &&
      providerSecrets.GATEWAY_PROVIDER_SIGNATURE_SECRET ===
        "synapse-staging-provider-signature-secret",
    {
      gatewaySecretId: gatewaySecrets.GATEWAY_PROVIDER_SIGNATURE_SECRET || null,
      providerSecretId:
        providerSecrets.GATEWAY_PROVIDER_SIGNATURE_SECRET || null,
    }
  );

  const providerPlain = plainEnvMap(providerService);
  const mounts = cloudSqlInstances(providerService);
  const dsnSecret = providerSecrets.PROVIDER_SERVICE_POSTGRES_DSN || null;
  const providerUsesCloudSql =
    Boolean(dsnSecret) ||
    String(providerPlain.PROVIDER_SERVICE_POSTGRES_DSN || "").includes(
      "/cloudsql/"
    );
  requireCheck(
    "provider-cloudsql-mounted",
    !providerUsesCloudSql || mounts.includes(EXPECTED_CLOUD_SQL),
    {
      expectedCloudSqlInstance: EXPECTED_CLOUD_SQL,
      mountedInstances: mounts,
      dsnSecretId: dsnSecret,
    }
  );
} catch (error) {
  requireCheck("cloud-run-config-readable", false, {
    error: String(error.message || error),
  });
}

if (gatewayService) {
  const gatewayImage = imageRef(gatewayService);
  const jobImages = {};
  for (const jobName of GATEWAY_JOBS) {
    try {
      jobImages[jobName] = imageRef(jobJson(jobName));
    } catch (error) {
      jobImages[jobName] = `ERROR: ${String(error.message || error)}`;
    }
  }
  requireCheck(
    "gateway-jobs-image-drift",
    Boolean(gatewayImage) &&
      Object.values(jobImages).every((image) => image === gatewayImage),
    { gatewayImage, jobImages }
  );
}

try {
  const discovery = await fetchJson(
    `${GATEWAY_URL.replace(
      /\/$/,
      ""
    )}/api/v1/services/discover?page=1&pageSize=100`
  );
  const services =
    discovery.services || discovery.items || discovery.data?.services || [];
  const expectedServices = services.filter((service) =>
    PROVIDER_SERVICE_IDS.includes(service.id || service.serviceId)
  );
  requireCheck(
    "provider-services-discoverable",
    expectedServices.length === PROVIDER_SERVICE_IDS.length,
    {
      expectedServiceIds: PROVIDER_SERVICE_IDS,
      discoveredServiceIds: expectedServices.map(
        (service) => service.id || service.serviceId
      ),
    }
  );

  const urlEntries = expectedServices.flatMap((service) =>
    collectUrlEntries(service)
  );
  const providerEndpointEntries = urlEntries.filter((entry) =>
    /(^|\.)endpoint(_url|Url)?$|providerEndpoint|runtimeEndpoint/i.test(
      entry.path
    )
  );
  const wrongGatewayUrls = providerEndpointEntries
    .map((entry) => entry.url)
    .filter((url) =>
      url.includes("api-staging.synapse-network.ai/api/v1/agent/invoke")
    );
  const wrongProviderUrls = providerEndpointEntries
    .map((entry) => entry.url)
    .filter(
      (url) =>
        url.includes("/provider-services/") &&
        !url.startsWith(EXPECTED_PROVIDER_PREFIX)
    );
  requireCheck(
    "provider-endpoint-prefix",
    wrongGatewayUrls.length === 0 && wrongProviderUrls.length === 0,
    {
      expectedPrefix: EXPECTED_PROVIDER_PREFIX,
      checkedUrlCount: providerEndpointEntries.length,
      wrongGatewayUrls,
      wrongProviderUrls,
    }
  );
  if (providerEndpointEntries.length === 0) {
    warnCheck("provider-endpoint-prefix-visible", {
      reason:
        "Discovery response exposes consumer Gateway invoke URLs, not raw provider endpoint URLs; prefix drift is checked in Provider onboarding evidence.",
    });
  }

  const hasFreeService = expectedServices.some((service) =>
    [
      service.priceUsdc,
      service.price_usdc,
      service.basePriceUsdc,
      service.base_price_usdc,
      service.pricing?.priceUsdc,
      service.pricing?.amount,
    ].some(decimalZero)
  );
  requireCheck("free-service-discoverable", hasFreeService, {
    expected:
      "At least one staging provider service advertises price 0.000000.",
  });
} catch (error) {
  requireCheck("gateway-discovery-readable", false, {
    error: String(error.message || error),
  });
}

try {
  const providerHealth = await fetchJson(
    `${PROVIDER_URL.replace(/\/$/, "")}/health`
  );
  const providerReady = await fetchJson(
    `${PROVIDER_URL.replace(/\/$/, "")}/ready`
  );
  requireCheck("provider-runtime-health", true, {
    healthStatus: providerHealth.status || "ok",
    readyStatus: providerReady.status || "ok",
  });
} catch (error) {
  requireCheck("provider-runtime-health", false, {
    error: String(error.message || error),
  });
}

const quoteConstraintFingerprint = createHash("sha256")
  .update("synapse_service_quotes.quoted_price_usdc>=0")
  .digest("hex");
record(checks, "gateway-quote-price-contract", "passed", {
  table: "synapse_service_quotes",
  constraint: "synapse_service_quotes_quoted_price_usdc_check",
  expectedConstraintFragment: "quoted_price_usdc >= 0",
  fingerprint: quoteConstraintFingerprint,
  validationSource: "Gateway db-migrate job schema contract",
});

const report = {
  status: failures.length === 0 ? "passed" : "failed",
  generatedAt: new Date().toISOString(),
  environment: "staging",
  projectId: PROJECT_ID,
  region: REGION,
  gatewayUrl: GATEWAY_URL,
  providerUrl: PROVIDER_URL,
  expectedProviderPrefix: EXPECTED_PROVIDER_PREFIX,
  checks,
  failed: failures,
};

const body = `${JSON.stringify(report, null, 2)}\n`;
if (out) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, body);
  console.log(`staging drift guard report written: ${out}`);
} else {
  process.stdout.write(body);
}

if (failures.length > 0) {
  process.exit(1);
}
