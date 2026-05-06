#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  // Dedicated data-generation/catalog fixture paths. Ordinary invoke,
  // billing, withdrawal, and admin approval E2E must not add to this list.
  "scripts/e2e/admin_analytics_10k_fullchain.mjs",
  "scripts/e2e/lib/llm_local_fixtures.mjs",
]);

export const RULES = [
  {
    code: "E2E-SERVICE-CREATE-001",
    pattern:
      /(?:httpx|requests)\.post\([^\n]*(?:\/api\/v1\/services|\/v1\/services)(?:["']|\s*,|\))|api\(\s*["']post["']\s*,\s*["']\/v1\/services["']|api\(\s*["']\/v1\/services["'][\s\S]{0,220}method\s*:\s*["']POST["']|fetch\([\s\S]{0,220}(?:\/api\/v1\/services|\/v1\/services)[\s\S]{0,220}method\s*:\s*["']POST["']/i,
    message:
      "local/staging E2E must not POST /api/v1/services; use Synapse-Network-Provider catalog services.",
  },
  {
    code: "E2E-SERVICE-FALLBACK-001",
    pattern:
      /GATEWAY_E2E_ALLOW_SERVICE_CREATION|mock_service_url|_MockProviderHandler|GATEWAY_E2E_MOCK_SERVICE_PORT|--mock-upstream|startMockUpstream|mock upstream|mockProvider|mockServer|WITHDRAWAL_ONE_TICKET_MOCK_PORT|ADMIN_WITHDRAWAL_APPROVAL_MOCK_PORT|ADMIN_WITHDRAWAL_APPROVAL_SERVICE_PRICE_USDC/,
    message:
      "service creation fallback and in-process mock provider services are forbidden in local/staging E2E.",
  },
  {
    code: "E2E-SERVICE-PREFIX-001",
    pattern:
      /provider_onboard_|apiref_test_|svc_e2e_|api_ref_|awa_provider_withdraw_|wot_provider_|Admin Withdrawal Approval Provider|Withdrawal One Ticket Provider/,
    message:
      "temporary provider/service prefixes are forbidden in local/staging E2E paths.",
  },
];

function walk(root, scanRoot = ROOT) {
  const full = path.join(scanRoot, root);
  if (!fs.existsSync(full)) return [];
  const stat = fs.statSync(full);
  if (stat.isFile()) return [root];
  const files = [];
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__pycache__") continue;
    const rel = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(rel, scanRoot));
    } else if (/\.(py|js|mjs|ts|tsx)$/.test(entry.name)) {
      files.push(rel);
    }
  }
  return files;
}

export function scanTextForServiceCreation(text, file = "<inline>") {
  const failures = [];
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      failures.push({ file, ...rule });
    }
  }
  return failures;
}

export function findServiceCreationFailures(scanRoot = ROOT) {
  const failures = [];
  for (const file of SCAN_ROOTS.flatMap((root) =>
    walk(root, scanRoot)
  ).sort()) {
    if (ALLOWED_FILES.has(file)) continue;
    const text = fs.readFileSync(path.join(scanRoot, file), "utf8");
    failures.push(...scanTextForServiceCreation(text, file));
  }
  return failures;
}

export function main() {
  const failures = findServiceCreationFailures(ROOT);
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
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
