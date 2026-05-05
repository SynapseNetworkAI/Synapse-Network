#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const SCAN_ROOTS = [
  "services/gateway/tests/e2e",
  "scripts/e2e",
  "scripts/fullchain_browser_test.py",
  "scripts/e2e_fullflow_test.py",
  "scripts/verify_chain.py",
];

const ALLOWED_FILES = new Set([
  "services/gateway/tests/e2e/helpers/db.py",
  "services/gateway/tests/e2e/helpers/service_fixtures.py",
  "services/gateway/tests/e2e/helpers/test_service_fixtures.py",
]);

const RULES = [
  {
    code: "E2E-SERVICE-CREATE-001",
    pattern:
      /(?:httpx|requests)\.post\([^\n]*(?:\/api\/v1\/services|\/v1\/services)(?:["']|\s*,|\))|api\(\s*["']post["']\s*,\s*["']\/v1\/services["']|fetch\([^\n]*(?:\/api\/v1\/services|\/v1\/services)["']/i,
    message:
      "local/staging E2E must not POST /api/v1/services; use Synapse-Network-Provider catalog services.",
  },
  {
    code: "E2E-SERVICE-FALLBACK-001",
    pattern:
      /GATEWAY_E2E_ALLOW_SERVICE_CREATION|mock_service_url|_MockProviderHandler|GATEWAY_E2E_MOCK_SERVICE_PORT/,
    message:
      "service creation fallback and in-process mock provider services are forbidden in local/staging E2E.",
  },
  {
    code: "E2E-SERVICE-PREFIX-001",
    pattern: /provider_onboard_|apiref_test_|svc_e2e_|api_ref_/,
    message:
      "temporary provider/service prefixes are forbidden in local/staging E2E paths.",
  },
];

function walk(root) {
  const full = path.join(ROOT, root);
  if (!fs.existsSync(full)) return [];
  const stat = fs.statSync(full);
  if (stat.isFile()) return [root];
  const files = [];
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__pycache__") continue;
    const rel = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(rel));
    } else if (/\.(py|js|mjs|ts|tsx)$/.test(entry.name)) {
      files.push(rel);
    }
  }
  return files;
}

const failures = [];
for (const file of SCAN_ROOTS.flatMap(walk).sort()) {
  if (ALLOWED_FILES.has(file)) continue;
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      failures.push({ file, ...rule });
    }
  }
}

if (failures.length > 0) {
  console.error(
    "FATAL E2E-SERVICE-CREATION-001: Gateway E2E service creation guard failed."
  );
  for (const failure of failures) {
    console.error(`${failure.code}: ${failure.file}: ${failure.message}`);
  }
  process.exit(1);
}

console.log("[e2e-service-creation-guard] passed");
