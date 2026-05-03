#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function parseEnvFile(file) {
  const result = {};
  const content = fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function existing(files) {
  return files.filter((file) => fs.existsSync(path.join(ROOT, file)));
}

function detectAppEnv() {
  const explicit = (
    process.env.SYNAPSE_FRONTEND_ENV ||
    process.env.NEXT_PUBLIC_APP_ENV ||
    ""
  ).trim();
  if (explicit) return explicit;
  for (const file of [
    ".env.local",
    ".env",
    ".env.staging",
    ".env.prod",
    ".env.production",
  ]) {
    if (!fs.existsSync(path.join(ROOT, file))) continue;
    const value = String(parseEnvFile(file).NEXT_PUBLIC_APP_ENV || "").trim();
    if (value) return value;
  }
  return "local";
}

const appEnv = detectAppEnv();
const normalizedAppEnv = appEnv === "production" ? "prod" : appEnv;
const ENV_FILES = existing([
  ".env",
  ...(normalizedAppEnv === "staging" ? [".env.staging"] : []),
  ...(normalizedAppEnv === "prod" ? [".env.prod", ".env.production"] : []),
  ...(normalizedAppEnv === "local" ? [".env.local"] : []),
]);
const fileEnv = ENV_FILES.reduce(
  (acc, file) => ({ ...acc, ...parseEnvFile(file) }),
  {}
);
const env = { ...fileEnv, ...process.env };

function defaultTxExplorerBaseUrlForEnv(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "staging" || normalized === "stage") {
    return "https://sepolia.arbiscan.io";
  }
  if (normalized === "prod" || normalized === "production") {
    return "https://arbiscan.io";
  }
  return "http://localhost:5100";
}

const checks = [
  {
    key: "NEXT_PUBLIC_GATEWAY_BASE_URL",
    required: true,
    description:
      "User-front Gateway API base URL. Local should be http://127.0.0.1:8000; staging/prod should be the public API domain.",
    validate: (value) => isHttpUrl(value),
    fix: "Set NEXT_PUBLIC_GATEWAY_BASE_URL to the Gateway API origin for this environment.",
  },
  {
    key: "NEXT_PUBLIC_ANALYTICS_ENDPOINT",
    required: true,
    description:
      "Browser analytics/event ingestion endpoint. It should point at the Gateway /api/v1/events route for the same environment.",
    validate: (value) => isHttpUrl(value),
    fix: "Set NEXT_PUBLIC_ANALYTICS_ENDPOINT, for example http://127.0.0.1:8000/api/v1/events locally.",
  },
  {
    key: "NEXT_PUBLIC_APP_ENV",
    required: true,
    description:
      "Public environment marker used by UI guards and diagnostics: local, staging, or prod.",
    validate: (value) =>
      ["local", "staging", "prod", "production"].includes(
        String(value || "").trim()
      ),
    fix: "Set NEXT_PUBLIC_APP_ENV=local, staging, or prod.",
  },
  {
    key: "NEXT_PUBLIC_DOCS_BASE_URL",
    required: true,
    description:
      "Dedicated developer docs origin. Local should be http://localhost:3100; staging/prod should use the docs subdomain.",
    validate: (value) => isHttpUrl(value),
    fix: "Set NEXT_PUBLIC_DOCS_BASE_URL to http://localhost:3100 locally, https://docs-staging.synapse-network.ai in staging, or https://docs.synapse-network.ai in prod.",
  },
  {
    key: "NEXT_PUBLIC_TX_EXPLORER_BASE_URL",
    required: false,
    description:
      "Public transaction explorer origin used by invoice/tx links. Local defaults to Otterscan; staging/prod must use the matching chain explorer.",
    validate: (value) => !value || isHttpUrl(value),
    fix: "Set NEXT_PUBLIC_TX_EXPLORER_BASE_URL to http://localhost:5100 locally, https://sepolia.arbiscan.io in staging, or https://arbiscan.io in prod.",
  },
  {
    key: "NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS",
    required: false,
    description:
      "Service discovery cache TTL in milliseconds. Keeps marketplace/discovery responsive without stale data lasting too long.",
    validate: (value) => !value || Number.isFinite(Number(value)),
    fix: "Use an integer such as 20000.",
  },
];

function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isLocalHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(
      parsed.hostname
    );
  } catch {
    return false;
  }
}

function collectClientSourceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const childPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if ([".next", "coverage", "node_modules"].includes(entry.name)) continue;
      files.push(...collectClientSourceFiles(childPath));
      continue;
    }
    if (/\.(test|spec)\.(js|jsx|mjs|ts|tsx)$/.test(entry.name)) {
      continue;
    }
    if (/\.(js|jsx|mjs|ts|tsx)$/.test(entry.name)) {
      files.push(childPath);
    }
  }
  return files;
}

function findDynamicPublicEnvReads() {
  const findings = [];
  const sourceRoot = path.join(ROOT, "src");
  for (const filePath of collectClientSourceFiles(sourceRoot)) {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/process\.env\[[^\]]+\]/.test(line)) {
        findings.push(
          `${path.relative(ROOT, filePath)}:${index + 1}: ${line.trim()}`
        );
      }
    });
  }
  return findings;
}

function valueOf(key) {
  return String(env[key] ?? "").trim();
}

const failures = [];
for (const check of checks) {
  const value = valueOf(check.key);
  if (check.required && !value) {
    failures.push({ ...check, reason: "missing" });
    continue;
  }
  if (value && check.validate && !check.validate(value)) {
    failures.push({
      ...check,
      reason: `invalid value: ${JSON.stringify(value)}`,
    });
  }
}

const supportEmail = valueOf("NEXT_PUBLIC_SUPPORT_EMAIL");
const supportPortal = valueOf("NEXT_PUBLIC_SUPPORT_PORTAL_URL");
const txExplorerBaseUrl =
  valueOf("NEXT_PUBLIC_TX_EXPLORER_BASE_URL") ||
  defaultTxExplorerBaseUrlForEnv(appEnv);
if (
  ["staging", "prod"].includes(normalizedAppEnv) &&
  isLocalHttpUrl(txExplorerBaseUrl)
) {
  failures.push({
    key: "NEXT_PUBLIC_TX_EXPLORER_BASE_URL",
    reason: `invalid value for ${normalizedAppEnv}: ${JSON.stringify(
      txExplorerBaseUrl
    )}`,
    description:
      "Invoice and transaction links must point to the public chain explorer for staging/prod, not a local Otterscan instance.",
    fix: "Use https://sepolia.arbiscan.io for staging or https://arbiscan.io for prod.",
  });
}
if (!supportEmail && !supportPortal) {
  failures.push({
    key: "NEXT_PUBLIC_SUPPORT_EMAIL or NEXT_PUBLIC_SUPPORT_PORTAL_URL",
    reason: "missing",
    description:
      "Public billing/deposit support contact shown in Credits, Dashboard, feedback fallback, and docs support surfaces.",
    fix: "Set NEXT_PUBLIC_SUPPORT_EMAIL=support@synapse-network.ai or NEXT_PUBLIC_SUPPORT_PORTAL_URL=https://... for this environment.",
  });
}
if (supportPortal && !isHttpUrl(supportPortal)) {
  failures.push({
    key: "NEXT_PUBLIC_SUPPORT_PORTAL_URL",
    reason: `invalid value: ${JSON.stringify(supportPortal)}`,
    description: "Optional public support portal URL opened from support CTAs.",
    fix: "Use a full https:// URL or leave it empty and configure NEXT_PUBLIC_SUPPORT_EMAIL.",
  });
}
if (supportEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(supportEmail)) {
  failures.push({
    key: "NEXT_PUBLIC_SUPPORT_EMAIL",
    reason: `invalid value: ${JSON.stringify(supportEmail)}`,
    description: "Public support mailbox used to build mailto links.",
    fix: "Use a plain public email address such as support@synapse-network.ai.",
  });
}

const dynamicPublicEnvReads = findDynamicPublicEnvReads();
if (dynamicPublicEnvReads.length > 0) {
  failures.push({
    key: "client NEXT_PUBLIC env access",
    reason: `dynamic process.env access in ${dynamicPublicEnvReads.length} location(s)`,
    description:
      "Browser code must use static process.env.NEXT_PUBLIC_FOO reads so Next.js can inline public env values.",
    fix: `Replace dynamic process.env[name] with explicit process.env.NEXT_PUBLIC_* reads:\n  ${dynamicPublicEnvReads.join(
      "\n  "
    )}`,
  });
}

if (failures.length > 0) {
  console.error("\n[user-front-env] Configuration preflight failed.");
  console.error(
    `[user-front-env] appEnv=${appEnv} files=${
      ENV_FILES.length ? ENV_FILES.join(", ") : "none"
    }`
  );
  for (const failure of failures) {
    console.error(`\n- ${failure.key}: ${failure.reason}`);
    console.error(`  purpose: ${failure.description}`);
    console.error(`  fix: ${failure.fix}`);
  }
  console.error(
    "\n[user-front-env] Refusing to start/build until the public frontend env contract is complete.\n"
  );
  process.exit(1);
}

console.log(
  `[user-front-env] ok appEnv=${appEnv} files=${
    ENV_FILES.length ? ENV_FILES.join(",") : "none"
  }`
);
