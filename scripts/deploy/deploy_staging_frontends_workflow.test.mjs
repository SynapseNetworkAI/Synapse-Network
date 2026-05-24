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
const stagingWorkflowPath = path.join(
  ROOT,
  ".github/workflows/deploy-staging.yml"
);

function workflowText() {
  return fs.readFileSync(workflowPath, "utf8");
}

function stagingWorkflowText() {
  return fs.readFileSync(stagingWorkflowPath, "utf8");
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

test("staging frontend workflow supports prebuilt immutable image deploys", () => {
  const text = workflowText();

  assert.match(text, /prebuilt_image_digest:/);
  assert.match(text, /Use prebuilt frontend image digest/);
  assert.match(
    text,
    /Build frontend image[\s\S]*env\.PREBUILT_IMAGE_DIGEST == ''/
  );
  assert.match(
    text,
    /Resolve immutable image refs[\s\S]*env\.PREBUILT_IMAGE_DIGEST == ''/
  );
  assert.match(text, /@sha256:\[0-9a-f\]\{64\}/);
  assert.match(text, /imageSource:\s*'prebuilt_digest'/);
});

test("local staging image builder uses an ephemeral detached worktree and attaches immutable digest", () => {
  const script = fs.readFileSync(
    path.join(ROOT, "scripts/deploy/local_build_staging_image.sh"),
    "utf8"
  );

  assert.match(script, /git .*worktree add --detach/);
  assert.match(script, /trap cleanup EXIT/);
  assert.match(script, /STAGING_IMAGE_BUILD_BACKEND=local-docker/);
  assert.match(script, /@sha256:\[0-9a-f\]\{64\}/);
  assert.match(script, /attach-prebuilt-image/);
  assert.match(script, /user-front\|docs-front/);
});

test("admin-front staging deploy does not execute admin database migration", () => {
  const text = stagingWorkflowText();

  assert.match(
    text,
    /Admin front image only; skipping Gateway-admin DB migration guard\./
  );
  assert.doesNotMatch(
    text,
    /\*,gateway-admin,\*\|\*,admin-front,\*/,
    "admin-front must not share the gateway-admin migration case"
  );
});

test("production admin-front image builds cannot inherit staging admin API endpoints", () => {
  const localBuilder = fs.readFileSync(
    path.join(ROOT, "scripts/deploy/local_build_frontend_image.sh"),
    "utf8"
  );
  const cloudBuildHelper = fs.readFileSync(
    path.join(ROOT, "scripts/deploy/gcp_cloudbuild_staging_images.sh"),
    "utf8"
  );

  assert.match(localBuilder, /export NEXT_PUBLIC_APP_ENV="prod"/);
  assert.match(localBuilder, /export NEXT_PUBLIC_ADMIN_API_BASE_URL=""/);
  assert.match(
    localBuilder,
    /export ADMIN_API_PROXY_TARGET="https:\/\/admin-api\.synapse-network\.ai"/
  );
  assert.match(
    localBuilder,
    /bash "scripts\/deploy\/gcp_cloudbuild_staging_images\.sh"/
  );
  assert.doesNotMatch(localBuilder, /TOOL_ROOT/);
  assert.match(cloudBuildHelper, /admin_front_app_env="prod"/);
  assert.match(cloudBuildHelper, /admin_front_public_api_base_url=""/);
  assert.match(
    cloudBuildHelper,
    /admin_front_proxy_target="https:\/\/admin-api\.synapse-network\.ai"/
  );
  assert.match(
    cloudBuildHelper,
    /refusing to build production admin-front with staging admin API settings/
  );
  assert.doesNotMatch(
    cloudBuildHelper,
    /NEXT_PUBLIC_ADMIN_API_BASE_URL=\$\{NEXT_PUBLIC_ADMIN_API_BASE_URL:-https:\/\/admin-api-staging\.synapse-network\.ai\}/
  );
});
