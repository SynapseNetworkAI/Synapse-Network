#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();

const HIGH_RISK_FILES = [
  "services/user-front/src/components/dashboard-workspace/OwnerCreditsPage.tsx",
  "services/user-front/src/components/dashboard-workspace/DashboardAgentsPage.tsx",
  "services/user-front/src/components/dashboard-workspace/DashboardCredentialsPage.tsx",
  "services/user-front/src/components/dashboard-workspace/ManageSpendCapModal.tsx",
  "services/user-front/src/components/dashboard/agents/QuickStartGuide.tsx",
  "services/user-front/src/components/PaidInvokePanel.tsx",
  "services/user-front/src/components/NotificationCenter.tsx",
  "services/user-front/src/components/provider-workspace/ProviderHealthPage.tsx",
  "services/user-front/src/components/provider-workspace/ProviderServicesPage.tsx",
  "services/user-front/src/components/provider-workspace/ProviderServiceDeployPage.tsx",
  "services/user-front/src/components/provider-workspace/ProviderWithdrawPage.tsx",
  "services/user-front/src/components/provider-workspace/ProviderSettlementsPage.tsx",
  "services/user-front/src/utils/providerWithdrawApi.ts",
  "services/user-front/src/utils/providerWithdrawWallet.ts",
];

const WITHDRAWAL_COPY_FILES = [
  "services/user-front/src/i18n/resources/en/creditsPage.ts",
  "services/user-front/src/i18n/resources/zh/creditsPage.ts",
  "services/user-front/src/i18n/resources/en/providerSettlements.ts",
  "services/user-front/src/i18n/resources/zh/providerSettlements.ts",
  "services/user-front/src/i18n/resources/en/walletActions.ts",
  "services/user-front/src/i18n/resources/zh/walletActions.ts",
];

const BLOCKED_PATTERNS = [
  {
    name: "raw-error-message-toast",
    pattern:
      /toast\.error\(\s*(?:err|error)\s+instanceof\s+Error\s*\?\s*(?:err|error)\.message/g,
  },
  {
    name: "raw-error-message-alias",
    pattern:
      /const\s+(?:message|msg)\s*=\s*(?:err|error)\s+instanceof\s+Error\s*\?\s*(?:err|error)\.message/g,
  },
  {
    name: "raw-backend-withdraw-message",
    pattern:
      /Unable to prepare a withdrawal ticket right now:\s*\$\{|\bHTTPException\b|'\{\\?'code\\?':/g,
  },
  {
    name: "raw-provider-withdraw-message",
    pattern: /\b(?:row|intent|payload)\.message\b/g,
  },
  {
    name: "raw-error-message-return",
    pattern: /return\s+(?:rawMessage|error\.message|err\.message)\b/g,
  },
  {
    name: "raw-error-message-fallback",
    pattern: /normalizeAuthApiError\(\s*(?:text|message|parsed\.detail)/g,
  },
];

const WITHDRAWAL_COPY_BLOCKED_PATTERNS = [
  {
    name: "internal-withdraw-copy",
    pattern:
      /:\s*"[^"]*(?:ticket|backend|ledger|HTTPException|CHAIN_RPC|PROVIDER_|RPC)[^"]*"/gi,
  },
];

const findings = [];

for (const relPath of HIGH_RISK_FILES) {
  const absPath = path.join(ROOT, relPath);
  if (!fs.existsSync(absPath)) {
    continue;
  }

  const text = fs.readFileSync(absPath, "utf8");
  for (const rule of BLOCKED_PATTERNS) {
    if (
      rule.name === "raw-error-message-return" &&
      relPath.endsWith("providerWithdrawWallet.ts")
    ) {
      continue;
    }
    for (const match of text.matchAll(rule.pattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      findings.push({
        path: relPath,
        line,
        rule: rule.name,
      });
    }
  }
}

for (const relPath of WITHDRAWAL_COPY_FILES) {
  const absPath = path.join(ROOT, relPath);
  if (!fs.existsSync(absPath)) {
    continue;
  }

  const text = fs.readFileSync(absPath, "utf8");
  for (const rule of WITHDRAWAL_COPY_BLOCKED_PATTERNS) {
    for (const match of text.matchAll(rule.pattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      findings.push({
        path: relPath,
        line,
        rule: rule.name,
      });
    }
  }
}

if (findings.length > 0) {
  console.error(
    "FATAL USER-FRONT-ERROR-001: raw backend/wallet errors can reach users."
  );
  console.error(
    "Why dangerous: RPC, HTTPException, provider, or backend internals confuse users and bypass i18n."
  );
  console.error(
    "Agent fix: log raw errors to console, then show a localized message resolved from stable error code or a generic i18n fallback."
  );
  for (const finding of findings) {
    console.error(`- ${finding.path}:${finding.line} ${finding.rule}`);
  }
  process.exit(1);
}

console.log("user-front user error scan passed");
