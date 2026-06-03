import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "../..");
export const EVIDENCE_ROOT = path.join(
  ROOT,
  "output/e2e/admin-menu-config-local"
);

export const REQUIRED_FILES = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "api-evidence.json",
  "dom-evidence.json",
  "db-evidence.json",
  "screenshot-evidence.json",
  "auth-policy-evidence.json",
];

export const REQUIRED_CHECKS = [
  "preflight:admin-front-local",
  "auth-policy:login-google-fa-disabled",
  "admin:password-login-run-1",
  "admin:password-login-run-2",
  "api:visible-menu-run-1",
  "api:visible-menu-run-2",
  "dom:sidebar-config-center-run-1",
  "dom:sidebar-config-center-run-2",
  "db:admin-menu-config-center-published",
];

export const REQUIRED_SCREENSHOTS = [
  "screenshots/login-no-google-fa-run-1.png",
  "screenshots/dashboard-menu-visible-run-1.png",
  "screenshots/config-overview-run-1.png",
  "screenshots/config-business-policy-run-1.png",
  "screenshots/config-runtime-run-1.png",
  "screenshots/config-published-run-1.png",
  "screenshots/login-no-google-fa-run-2.png",
  "screenshots/dashboard-menu-visible-run-2.png",
  "screenshots/config-overview-run-2.png",
  "screenshots/config-business-policy-run-2.png",
  "screenshots/config-runtime-run-2.png",
  "screenshots/config-published-run-2.png",
];

export const REQUIRED_MENU_ITEMS = [
  {
    itemId: "config-center",
    label: "配置中心",
    href: "/config",
    parentItemId: "business-control",
    nodeType: "page",
  },
  {
    itemId: "business-policy-config",
    label: "业务策略配置",
    href: "/config/business-policy",
    parentItemId: "config-center",
    nodeType: "page",
  },
  {
    itemId: "runtime-config",
    label: "运行时来源",
    href: "/config/runtime",
    parentItemId: "config-center",
    nodeType: "page",
  },
  {
    itemId: "published-config",
    label: "已发布快照",
    href: "/config/published",
    parentItemId: "config-center",
    nodeType: "page",
  },
];

export const REQUIRED_BUSINESS_POLICY_TABS = [
  "Finance",
  "Consumer Withdraw",
  "Risk",
  "Reconciliation",
];

export const FORBIDDEN_EVIDENCE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i,
  /qwer@1234/i,
];

export const forbiddenLoginTexts = [
  "Google Authenticator Token",
  "Google Authenticator 验证码",
  "000000",
];

export const forbiddenPageTexts = [
  "Internal server error",
  "Unhandled Runtime Error",
  "Failed to fetch",
  "Unauthorized",
  "Missing admin session",
  "加载配置中心失败",
  "暂时无法连接管理后台",
];

export const forbiddenConfigOverviewTexts = [
  "Platform Fee Rate",
  "Gateway Routing Tax",
  "Manual Review Threshold",
  "Auto Single Limit",
  "Alert Delta",
  "查看原始快照 JSON",
];

export const businessPolicyTabProofs = [
  {
    tab: "Finance",
    expectedTexts: [
      "Platform Fee Rate",
      "Gateway Routing Tax",
      "Consumer Deposit Min",
    ],
  },
  {
    tab: "Consumer Withdraw",
    expectedTexts: [
      "Manual Review Threshold",
      "Max Daily Count",
      "Maturity Seconds",
    ],
  },
  {
    tab: "Risk",
    expectedTexts: [
      "Auto Single Limit",
      "Auto 24h Limit",
      "Withdrawal Window Hours",
    ],
  },
  {
    tab: "Reconciliation",
    expectedTexts: ["Alert Delta"],
  },
];

export function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

export function buildLocalConfig() {
  return {
    adminFrontUrl: stripSlash(
      process.env.ADMIN_FRONT_URL || "http://localhost:3200"
    ),
    adminGatewayUrl: stripSlash(
      process.env.ADMIN_GATEWAY_URL || "http://localhost:8300"
    ),
    adminEmail: process.env.ADMIN_EMAIL || "cliff@synapse-network.ai",
    adminPassword: process.env.ADMIN_PASSWORD || "qwer@1234",
    adminDsn:
      process.env.ADMIN_DATABASE_DSN ||
      process.env.LOCAL_GATEWAY_ADMIN_POSTGRES_DSN ||
      "postgresql://synapse_admin_app:local-dev-admin-app-password@127.0.0.1:15432/synapse_gateway_admin",
    headless: process.env.ADMIN_MENU_CONFIG_HEADLESS !== "0",
  };
}

export function forbiddenRuntimeRawValuesFor(config) {
  return [
    config.adminPassword,
    "local-dev-admin-app-password",
    "postgresql://",
    "Bearer ",
  ].filter(Boolean);
}

export function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function assertLocalOnly(config) {
  for (const [name, value] of [
    ["ADMIN_FRONT_URL", config.adminFrontUrl],
    ["ADMIN_GATEWAY_URL", config.adminGatewayUrl],
  ]) {
    if (!isLocalUrl(value))
      throw new Error(`Refusing non-local ${name}: ${value}`);
  }
  const dsnIsLocal =
    config.adminDsn.includes("127.0.0.1") ||
    config.adminDsn.includes("localhost");
  if (!dsnIsLocal) throw new Error("Refusing non-local ADMIN_DATABASE_DSN.");
}

export function redactWithConfig(value, config) {
  let text = String(value ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/gi,
      "postgresql://[REDACTED]@"
    )
    .replace(
      /"((?:password|authorization|access_token|token|secret|cookie|session)[^"]*)"\s*:\s*"[^"]+"/gi,
      '"$1":"[REDACTED]"'
    );
  if (config?.adminPassword) {
    text = text.replaceAll(config.adminPassword, "[REDACTED_PASSWORD]");
  }
  return text;
}

export function sanitizeWithConfig(value, config) {
  if (Array.isArray(value))
    return value.map((next) => sanitizeWithConfig(next, config));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, next]) => [
        key,
        shouldRedactKey(key) ? "[REDACTED]" : sanitizeWithConfig(next, config),
      ])
    );
  }
  return typeof value === "string" ? redactWithConfig(value, config) : value;
}

function shouldRedactKey(key) {
  if (key === "passwordOnly") return false;
  return /password|authorization|bearer|jwt|token|secret|cookie|session/i.test(
    key
  );
}
