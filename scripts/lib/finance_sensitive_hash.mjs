import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../..");

const SENSITIVE_PATH_PATTERNS = [
  /^services\/gateway\/src\/.*(finance|withdraw|refund|balance|ledger|settlement).*\.py$/,
  /^services\/gateway-admin\/src\/.*(provider_withdraw_review|finance_admin|approval|reconciliation).*\.py$/,
  /^services\/admin-front\/src\/.*withdrawal-reviews.*\.(ts|tsx)$/,
  /^contracts\/.*(Withdraw|Withdrawal|SynapseCore).*\.sol$/,
  /^test\/.*(withdraw|withdrawal|refund).*\.ts$/,
  /^scripts\/e2e\/admin_withdrawal_approval_.*\.mjs$/,
  /^scripts\/ui\/dogfood_admin_withdrawal_approval\.mjs$/,
  /^scripts\/lib\/(finance_sensitive_hash|totp_window)\.mjs$/,
];

function listGitFiles(rootDir) {
  const tracked = execFileSync("git", ["ls-files"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  return [...new Set([
    ...tracked.split(/\r?\n/).filter(Boolean),
    ...untracked.split(/\r?\n/).filter(Boolean),
  ])];
}

export function listFinanceSensitiveFiles(rootDir = REPO_ROOT) {
  return listGitFiles(rootDir)
    .filter((relativePath) => SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(relativePath)))
    .filter((relativePath) => fs.existsSync(path.join(rootDir, relativePath)))
    .sort();
}

export function computeFinanceSensitiveTreeHash(rootDir = REPO_ROOT) {
  const files = listFinanceSensitiveFiles(rootDir);
  const hash = crypto.createHash("sha256");
  for (const relativePath of files) {
    const filePath = path.join(rootDir, relativePath);
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(filePath));
    hash.update("\0");
  }
  return {
    hash: hash.digest("hex"),
    files,
  };
}

export function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Json(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}
