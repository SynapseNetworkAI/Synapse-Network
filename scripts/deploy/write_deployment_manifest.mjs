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
  console.error("Usage: node scripts/deploy/write_deployment_manifest.mjs --out <path> [--scope scope.json] [--build build.json] [--revisions revisions.json] [--smoke smoke.json]");
  process.exit(2);
}

const scope = readJson(arg("--scope"), {});
const build = readJson(arg("--build"), {});
const revisions = readJson(arg("--revisions"), {});
const smoke = readJson(arg("--smoke"), {});
const imageDigests = readJson(arg("--image-digests"), {});

const releaseId = arg("--release-id", process.env.RELEASE_ID || "");
const manifest = {
  environment: arg("--environment", process.env.ENVIRONMENT || "staging"),
  releaseId,
  generatedAt: new Date().toISOString(),
  sourceRefType: arg("--source-ref-type", process.env.SOURCE_REF_TYPE || ""),
  sourceRef: arg("--source-ref", process.env.SOURCE_REF || ""),
  resolvedCommitSha: arg("--resolved-commit-sha", process.env.RESOLVED_COMMIT_SHA || ""),
  deployScope: scope.services || [],
  deploy: scope.deploy !== false,
  noDeployReason: scope.deploy === false ? (scope.reason || []).join("; ") : null,
  changedFiles: scope.changedFiles || [],
  reason: scope.reason || [],
  services: Object.fromEntries(
    Object.entries(build.services || {}).map(([service, imageTag]) => [
      service,
      {
        imageTag,
        imageDigest: imageDigests[service] || imageTag,
        cloudRunRevision: revisions[service] || null,
        smokeStatus: smoke[service] || "not_run",
      },
    ]),
  ),
  migration: {
    ran: String(process.env.MIGRATION_RAN || "false") === "true",
    status: process.env.MIGRATION_STATUS || "skipped",
  },
  terraform: {
    ran: String(process.env.TERRAFORM_RAN || "false") === "true",
    status: process.env.TERRAFORM_STATUS || "skipped",
  },
  rollbackTarget: readJson(arg("--rollback-target"), { previousReleaseId: null, previousImageDigests: {} }),
};

const body = `${JSON.stringify(manifest, null, 2)}\n`;
mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(out, body);
writeFileSync(`${out}.sha256`, `${createHash("sha256").update(body).digest("hex")}\n`);
console.log(`deployment manifest written: ${out}`);
