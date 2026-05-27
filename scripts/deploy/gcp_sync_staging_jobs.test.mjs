import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, "gcp_sync_staging_jobs.sh");

function scriptText() {
  return fs.readFileSync(scriptPath, "utf8");
}

test("gateway staging job sync resolves the real gateway service URL", () => {
  const text = scriptText();

  assert.match(text, /gateway_service_name="synapse-staging-gateway"/);
  assert.match(
    text,
    /gcloud run services describe "\$\{gateway_service_name\}".*--format='value\(status\.url\)'/s,
  );
});

test("gateway staging job sync disables webhook and trigger envs on one-shot jobs", () => {
  const text = scriptText();

  assert.match(text, /DEPOSIT_INDEXER_TRIGGER_ENABLED=false/);
  assert.match(text, /NOTIFICATION_OUTBOX_TRIGGER_ENABLED=false/);
  assert.match(text, /ALCHEMY_DEPOSIT_WEBHOOK_ENABLED=false/);
  assert.match(
    text,
    /DEPOSIT_INDEXER_TRIGGER_URL=\$\{gateway_service_url\}\/internal\/jobs\/deposit-indexer\/trigger/,
  );
  assert.match(
    text,
    /NOTIFICATION_OUTBOX_TRIGGER_URL=\$\{gateway_service_url\}\/internal\/jobs\/notification-outbox\/trigger/,
  );
});

test("gateway-admin staging job sync keeps its existing secret contract", () => {
  const text = scriptText();

  assert.match(text, /--set-secrets "\$\(join_by_comma "\$\{gateway_admin_secret_env\[@\]\}"\)"/);
});
