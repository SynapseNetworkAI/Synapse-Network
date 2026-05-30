#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const REGION = process.env.REGION || "us-central1";
const STAGING_PROJECT_ID =
  process.env.STAGING_PROJECT_ID ||
  process.env.PROJECT_ID ||
  "fabled-archive-494108-k5";
const PROD_PROJECT_ID =
  process.env.PROD_PROJECT_ID || "synapse-network-prod";
const STAGING_SECRET_ID =
  process.env.STAGING_REFRESH_TOKEN_SECRET_ID ||
  "x-official-oauth2-refresh-token";

const checks = [];

function runGcloud(args, { json = false, allowFailure = false } = {}) {
  try {
    const text = execFileSync("gcloud", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return json ? (text ? JSON.parse(text) : null) : text;
  } catch (error) {
    if (allowFailure) return json ? null : "";
    const stderr = String(error.stderr || "").trim();
    throw new Error(
      `gcloud ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`
    );
  }
}

function record(status, name, details) {
  checks.push({ status, name, details });
}

function pass(name, details) {
  record("PASS", name, details);
}

function warn(name, details) {
  record("WARN", name, details);
}

function enabledSecretVersionCount(projectId, secretId) {
  const output = runGcloud(
    [
      "secrets",
      "versions",
      "list",
      secretId,
      "--project",
      projectId,
      "--filter=state=enabled",
      "--format=value(name)",
    ],
    { allowFailure: true }
  );
  return output ? output.split(/\r?\n/).filter(Boolean).length : 0;
}

function schedulerJobs(projectId) {
  const rows = runGcloud(
    [
      "scheduler",
      "jobs",
      "list",
      "--project",
      projectId,
      `--location=${REGION}`,
      "--format=json",
    ],
    { json: true }
  );
  const map = new Map();
  for (const row of rows || []) {
    const id = String(row.name || "").split("/").pop();
    map.set(id, row);
  }
  return map;
}

function serviceJson(projectId, serviceName) {
  return runGcloud(
    [
      "run",
      "services",
      "describe",
      serviceName,
      "--project",
      projectId,
      `--region=${REGION}`,
      "--format=json",
    ],
    { json: true }
  );
}

function cloudRunMinScale(service) {
  const v2Min = service?.template?.scaling?.minInstanceCount;
  if (v2Min !== undefined && v2Min !== null && v2Min !== "") {
    return Number(v2Min);
  }
  const annotations =
    service?.spec?.template?.metadata?.annotations ||
    service?.metadata?.annotations ||
    {};
  const annotation = annotations["autoscaling.knative.dev/minScale"];
  return annotation === undefined || annotation === "" ? 0 : Number(annotation);
}

function repositoryJson(projectId, repository) {
  return runGcloud(
    [
      "artifacts",
      "repositories",
      "describe",
      repository,
      "--project",
      projectId,
      `--location=${REGION}`,
      "--format=json",
    ],
    { json: true }
  );
}

function cleanupKeepCount(repo) {
  const policies = repo?.cleanupPolicies || {};
  for (const policy of Object.values(policies)) {
    const count = policy?.mostRecentVersions?.keepCount;
    if (count !== undefined && count !== null) return Number(count);
  }
  return null;
}

function vpcConnectorJson(projectId, connectorName) {
  return runGcloud(
    [
      "compute",
      "networks",
      "vpc-access",
      "connectors",
      "describe",
      connectorName,
      "--project",
      projectId,
      `--region=${REGION}`,
      "--format=json",
    ],
    { json: true, allowFailure: true }
  );
}

function checkSecretVersions() {
  const enabled = enabledSecretVersionCount(STAGING_PROJECT_ID, STAGING_SECRET_ID);
  if (enabled <= 1) {
    pass(
      "staging refresh token enabled secret versions",
      `${STAGING_SECRET_ID}: enabled=${enabled} or secret absent`
    );
  } else {
    warn(
      "staging refresh token enabled secret versions",
      `${STAGING_SECRET_ID}: enabled=${enabled}, expected <= 1`
    );
  }
}

function checkSchedules() {
  const expectedStaging = {
    "synapse-staging-deposit-indexer-schedule": "*/30 * * * *",
    "synapse-staging-consumer-withdraw-chain-recovery-schedule": "*/30 * * * *",
    "synapse-staging-withdrawal-expiry-sweeper-schedule": "*/30 * * * *",
    "synapse-staging-notification-outbox-drain-schedule": "*/30 * * * *",
  };
  const expectedProd = {
    "synapse-prod-deposit-indexer-schedule": "*/10 * * * *",
    "synapse-prod-consumer-withdraw-chain-recovery-schedule": "*/10 * * * *",
    "synapse-prod-withdrawal-expiry-sweeper-schedule": "*/10 * * * *",
    "synapse-prod-notification-outbox-drain-schedule": "*/10 * * * *",
  };

  for (const [projectId, expected] of [
    [STAGING_PROJECT_ID, expectedStaging],
    [PROD_PROJECT_ID, expectedProd],
  ]) {
    const jobs = schedulerJobs(projectId);
    for (const [id, schedule] of Object.entries(expected)) {
      const actual = jobs.get(id)?.schedule || "<missing>";
      if (actual === schedule) {
        pass(`scheduler ${id}`, `schedule=${actual}`);
      } else {
        warn(`scheduler ${id}`, `schedule=${actual}, expected=${schedule}`);
      }
    }
  }
}

function checkCloudRunMinScale() {
  const gateway = serviceJson(PROD_PROJECT_ID, "synapse-prod-gateway");
  const minScale = cloudRunMinScale(gateway);
  if (minScale === 0) {
    pass("prod gateway minScale", "minScale=0");
  } else {
    warn("prod gateway minScale", `minScale=${minScale}, expected=0`);
  }
}

function checkArtifactRegistry() {
  for (const [projectId, repository] of [
    [STAGING_PROJECT_ID, "synapse-staging"],
    [PROD_PROJECT_ID, "synapse-prod"],
  ]) {
    const repo = repositoryJson(projectId, repository);
    const dryRun = Boolean(repo?.cleanupPolicyDryRun);
    const count = cleanupKeepCount(repo);
    if (!dryRun && count === 3) {
      pass(`${repository} Artifact Registry cleanup`, "dryRun=false keepCount=3");
    } else {
      warn(
        `${repository} Artifact Registry cleanup`,
        `dryRun=${dryRun} keepCount=${count ?? "<missing>"}, expected false/3`
      );
    }
  }
}

function checkVpcConnector() {
  const connector = vpcConnectorJson(PROD_PROJECT_ID, "syn-prod-vpcconn");
  if (!connector) {
    warn(
      "prod VPC connector",
      "syn-prod-vpcconn not readable; check API enablement/permissions"
    );
    return;
  }
  const minInstances = Number(connector.minInstances ?? 0);
  if (minInstances <= 0) {
    pass("prod VPC connector minInstances", `minInstances=${minInstances}`);
  } else {
    warn(
      "prod VPC connector minInstances",
      `minInstances=${minInstances}; fixed-cost connector still active`
    );
  }
}

function main() {
  checkSecretVersions();
  checkSchedules();
  checkCloudRunMinScale();
  checkArtifactRegistry();
  checkVpcConnector();

  for (const item of checks) {
    console.log(`${item.status} ${item.name} - ${item.details}`);
  }

  const warnCount = checks.filter((item) => item.status === "WARN").length;
  console.log(
    `summary: pass=${checks.length - warnCount} warn=${warnCount} region=${REGION}`
  );
}

main();
