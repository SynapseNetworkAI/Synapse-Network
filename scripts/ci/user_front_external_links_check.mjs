#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const SOURCE_ROOT = path.join(ROOT, "services/user-front/src");
const FORBIDDEN_TX_EXPLORER_PATTERNS = [
  /https:\/\/etherscan\.io\/tx/i,
  /https:\/\/basescan\.org\/tx/i,
  /https:\/\/arbiscan\.io\/tx/i,
  /https:\/\/sepolia\.arbiscan\.io\/tx/i,
];

function collectSourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const childPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if ([".next", "coverage", "node_modules"].includes(entry.name)) continue;
      files.push(...collectSourceFiles(childPath));
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) continue;
    files.push(childPath);
  }
  return files;
}

const findings = [];
for (const filePath of collectSourceFiles(SOURCE_ROOT)) {
  const relativePath = path.relative(ROOT, filePath);
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (FORBIDDEN_TX_EXPLORER_PATTERNS.some((pattern) => pattern.test(line))) {
      findings.push(`${relativePath}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (findings.length > 0) {
  console.error(
    "FATAL USER-FRONT-EXTERNAL-LINKS-001: hardcoded tx explorer link found."
  );
  console.error(
    "Why dangerous: invoice and tx links must follow local/staging/prod chain environments instead of always opening one explorer."
  );
  console.error(
    "Agent fix: use getTransactionExplorerUrl(txHash) from services/user-front/src/utils/explorer.ts."
  );
  console.error(findings.map((finding) => `- ${finding}`).join("\n"));
  process.exit(1);
}

console.log(
  "[user-front-external-links] transaction explorer links are environment-aware"
);
