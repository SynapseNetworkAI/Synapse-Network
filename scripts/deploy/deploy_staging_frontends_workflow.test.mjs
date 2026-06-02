import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const workflowPath = path.join(
  ROOT,
  ".github/workflows/deploy-staging-frontends.yml"
);
const productionWorkflowPath = path.join(
  ROOT,
  ".github/workflows/deploy-production-frontends.yml"
);

function workflowText() {
  return fs.readFileSync(workflowPath, "utf8");
}

function productionWorkflowText() {
  return fs.readFileSync(productionWorkflowPath, "utf8");
}

test("staging frontend workflow is standalone and does not run database migration jobs", () => {
  const text = workflowText();

  assert.doesNotMatch(
    text,
    /uses:\s*\.\/\.github\/workflows\/deploy-staging\.yml/,
    "frontend releases must not call the reusable all-service workflow"
  );
  assert.doesNotMatch(
    text,
    /gcloud\s+run\s+jobs\s+execute/,
    "frontend releases must not execute Cloud Run jobs"
  );
  assert.doesNotMatch(
    text,
    /db-migrate|gateway-admin-db-migrate|migration guard/i,
    "frontend releases must not run SQL or migration guards"
  );
});

test("staging frontend workflow accepts the three frontend services", () => {
  const text = workflowText();

  assert.match(text, /deploy_scope:[\s\S]*options:[\s\S]*-\s+admin-front/);
  assert.match(text, /deploy_scope:[\s\S]*options:[\s\S]*-\s+user-front/);
  assert.match(text, /deploy_scope:[\s\S]*options:[\s\S]*-\s+docs-front/);
});

test("staging frontend workflow has bounded long-running steps", () => {
  const text = workflowText();

  assert.match(text, /timeout-minutes:\s*25/);
  assert.match(
    text,
    /timeout\s+15m\s+bash\s+scripts\/deploy\/gcp_cloudbuild_staging_images\.sh/
  );
  assert.match(text, /timeout\s+8m\s+bash\s+deploy-frontend-services\.sh/);
  assert.match(
    text,
    /timeout\s+5m\s+bash\s+scripts\/deploy\/gcp_smoke_staging_services\.sh/
  );
  assert.match(text, /failedStep/);
});

test("staging frontend workflow can deploy a prebuilt image digest without Cloud Build", () => {
  const text = workflowText();

  assert.match(text, /prebuilt_image_digest:/);
  assert.match(
    text,
    /PREBUILT_IMAGE_DIGEST:\s*\$\{\{ inputs\.prebuilt_image_digest \}\}/
  );
  assert.match(text, /name:\s*Use prebuilt frontend image digest/);
  assert.match(
    text,
    /Build frontend image[\s\S]*env\.PREBUILT_IMAGE_DIGEST == ''/,
    "Cloud Build must be skipped when an immutable prebuilt digest is attached"
  );
  assert.match(
    text,
    /Resolve immutable image refs[\s\S]*env\.PREBUILT_IMAGE_DIGEST == ''/,
    "digest resolution must not re-resolve a prebuilt image@sha256 ref"
  );
  assert.match(text, /imageSource:\s*'prebuilt_digest'/);
});

test("production frontend workflow is deploy-only for prebuilt digests", () => {
  const text = productionWorkflowText();

  assert.match(text, /name:\s*Deploy Production Frontends/);
  assert.match(text, /environment:\s*production/);
  assert.match(text, /prebuilt_image_digest:/);
  assert.match(text, /name:\s*Use prebuilt production frontend image digest/);
  assert.match(
    text,
    /Build production frontend image[\s\S]*env\.PREBUILT_IMAGE_DIGEST == ''/,
    "production frontend Cloud Build must be skipped when a prebuilt digest is attached"
  );
  assert.match(text, /synapse-prod-admin-front/);
  assert.match(text, /synapse-prod-user-front/);
  assert.match(text, /synapse-prod-docs-front/);
  assert.doesNotMatch(
    text,
    /gcloud\s+run\s+jobs\s+execute|db-migrate|gateway-admin-db-migrate|migration guard/i,
    "production frontend releases must not run SQL or migration guards"
  );
});
