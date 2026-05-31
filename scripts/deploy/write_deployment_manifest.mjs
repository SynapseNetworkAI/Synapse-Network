#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function readJson(path, fallback) {
  if (!path) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

const out = arg("--out");
if (!out) {
  console.error(
    "Usage: node scripts/deploy/write_deployment_manifest.mjs --out <path> [--scope scope.json] [--build build.json] [--revisions revisions.json] [--smoke smoke.json] [--smoke-details smoke-details.json] [--drift-guard drift-guard.json]"
  );
  process.exit(2);
}

const scope = readJson(arg("--scope"), {});
const build = readJson(arg("--build"), {});
const revisions = readJson(arg("--revisions"), {});
const smoke = readJson(arg("--smoke"), {});
const smokeDetails = readJson(arg("--smoke-details"), []);
const imageDigests = readJson(arg("--image-digests"), {});
const jobs = readJson(arg("--jobs"), { updated: [], smokeExecutions: [] });
const driftGuard = readJson(arg("--drift-guard"), {
  status: "skipped",
  reason: "not provided",
});

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatUtcDisplay(date) {
  return [
    date.getUTCFullYear(),
    "-",
    pad2(date.getUTCMonth() + 1),
    "-",
    pad2(date.getUTCDate()),
    " ",
    pad2(date.getUTCHours()),
    ":",
    pad2(date.getUTCMinutes()),
    ":",
    pad2(date.getUTCSeconds()),
  ].join("");
}

const releaseId = arg("--release-id", process.env.RELEASE_ID || "");
const generatedAtDate = new Date();
const generatedAt = generatedAtDate.toISOString();
const services = Object.fromEntries(
  Object.entries(build.services || {}).map(([service, imageTag]) => [
  service,
  {
      imageTag,
      imageDigest: imageDigests[service] || imageTag,
      imageSource: build.imageSource || "cloudbuild",
      cloudRunRevision: revisions[service] || null,
      smokeStatus: smoke[service] || "not_run",
      smokeDetails: Array.isArray(smokeDetails)
        ? smokeDetails.filter((detail) => detail && detail.service === service)
        : [],
    },
  ])
);
const gatewayServiceDigest = services.gateway?.imageDigest || null;
const gatewayJobDigests = Object.fromEntries(
  (jobs.updated || [])
    .filter((job) => job.family === "gateway")
    .map((job) => [job.job, job.effectiveImage || job.requestedImage || null])
);
const gatewayJobDigestValues = Object.values(gatewayJobDigests).filter(Boolean);
const jobImageDrift = Boolean(
  gatewayServiceDigest &&
    gatewayJobDigestValues.length > 0 &&
    gatewayJobDigestValues.some((digest) => digest !== gatewayServiceDigest)
);
const manifest = {
  environment: arg("--environment", process.env.ENVIRONMENT || "staging"),
  releaseId,
  generatedAt,
  generatedAtDisplay: arg(
    "--generated-at-display",
    process.env.GENERATED_AT_DISPLAY || formatUtcDisplay(generatedAtDate)
  ),
  timestampTimezone: arg(
    "--timestamp-timezone",
    process.env.TIMESTAMP_TIMEZONE || "UTC"
  ),
  sourceRefType: arg("--source-ref-type", process.env.SOURCE_REF_TYPE || ""),
  sourceRef: arg("--source-ref", process.env.SOURCE_REF || ""),
  resolvedCommitSha: arg(
    "--resolved-commit-sha",
    process.env.RESOLVED_COMMIT_SHA || ""
  ),
  deployScope: scope.services || [],
  deploy: scope.deploy !== false,
  noDeployReason:
    scope.deploy === false ? (scope.reason || []).join("; ") : null,
  changedFiles: scope.changedFiles || [],
  reason: scope.reason || [],
  services,
  smokeDetails: Array.isArray(smokeDetails) ? smokeDetails : [],
  jobs: {
    updated: jobs.updated || [],
    smokeExecutions: jobs.smokeExecutions || [],
    gatewayServiceDigest,
    gatewayJobDigests,
    jobImageDrift,
  },
  migration: {
    ran: String(process.env.MIGRATION_RAN || "false") === "true",
    status: process.env.MIGRATION_STATUS || "skipped",
    schemaValidationStatus: process.env.MIGRATION_STATUS || "skipped",
    quotePriceConstraintFingerprint:
      driftGuard.checks?.find?.(
        (check) => check.name === "gateway-quote-price-contract"
      )?.fingerprint || null,
  },
  driftGuard,
  terraform: {
    ran: String(process.env.TERRAFORM_RAN || "false") === "true",
    status: process.env.TERRAFORM_STATUS || "skipped",
  },
  rollbackTarget: readJson(arg("--rollback-target"), {
    previousReleaseId: null,
    previousImageDigests: {},
  }),
};

const body = `${JSON.stringify(manifest, null, 2)}\n`;
mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(out, body);
writeFileSync(
  `${out}.sha256`,
  `${createHash("sha256").update(body).digest("hex")}\n`
);
console.log(`deployment manifest written: ${out}`);
