#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

const routeScanTargets = [
  "services/user-front/src",
  "services/user-front/next.config.mjs",
  "services/docs-front/next.config.mjs",
  "services/docs-front/src/app",
  "scripts/ui",
  "scripts/e2e",
  "services/gateway/tests",
];

const urlScanTargets = [
  "README.md",
  "docs/projects/frontend",
  "docs/reference/Agent_Task_Map.md",
  "docs/reference/Agent_Task_Map.json",
  ...routeScanTargets,
];

const ignoredDirs = new Set([
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "output",
]);

const routePatterns = [
  /source:\s*["'`]\/docs(?:["'`/?#]|$)/,
  /href=\{?["'`]\/docs(?:["'`/?#]|$)/,
  /["'`]\/docs(?:\/|\?|#|["'`])/,
];

const urlPatterns = [
  /https?:\/\/(?:www\.)?synapse-network\.ai\/docs(?:\/|\?|#|["'`)\s]|$)/i,
  /https:\/\/staging\.synapse-network\.ai\/docs(?:\/|\?|#|["'`)\s]|$)/i,
  /http:\/\/localhost:3000\/docs(?:\/|\?|#|["'`)\s]|$)/i,
];

function collectFiles(target) {
  const absolute = path.join(ROOT, target);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [absolute];

  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const child = path.join(absolute, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(path.relative(ROOT, child)));
      continue;
    }
    if (!/\.(md|mdx|json|js|jsx|mjs|ts|tsx|py|sh)$/.test(entry.name)) {
      continue;
    }
    files.push(child);
  }
  return files;
}

function uniqueFiles(targets) {
  return [...new Set(targets.flatMap(collectFiles))];
}

function scan(files, patterns, label) {
  const findings = [];
  for (const filePath of files) {
    const relative = path.relative(ROOT, filePath);
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (patterns.some((pattern) => pattern.test(line))) {
        findings.push(`${relative}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  if (findings.length > 0) {
    console.error(`FATAL DOCS-CANONICAL-LINKS-001: ${label}`);
    console.error(
      "Why dangerous: public docs must use docs.synapse-network.ai directly; the main-site /docs compatibility layer has been removed."
    );
    console.error(
      "Agent fix: link through NEXT_PUBLIC_DOCS_BASE_URL / DOCS_BASE_URL or a docs-front canonical URL, not /docs on user-front."
    );
    console.error(findings.map((finding) => `- ${finding}`).join("\n"));
    process.exit(1);
  }
}

scan(
  uniqueFiles(routeScanTargets),
  routePatterns,
  "legacy /docs route literal found in live code or scripts."
);
scan(
  uniqueFiles(urlScanTargets),
  urlPatterns,
  "legacy main-site docs URL found."
);

console.log("[docs-canonical-links] docs links use the dedicated docs origin");
