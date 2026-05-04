#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT_DIR = path.resolve(new URL("../..", import.meta.url).pathname);
const SRC_DIR = path.join(ROOT_DIR, "services/user-front/src");

const IGNORED_SEGMENTS = [
  `${path.sep}i18n${path.sep}resources${path.sep}`,
  `${path.sep}__snapshots__${path.sep}`,
];

const IGNORED_SUFFIXES = [
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
  ".spec.tsx",
  ".d.ts",
  ".json",
  ".css",
];

const CJK_ALLOWLIST = [
  "services/user-front/src/components/Providers.tsx",
  "services/user-front/src/components/WalletAuthGuard.tsx",
  "services/user-front/src/utils/refundApi.ts",
  "services/user-front/src/components/provider-workspace/ProviderSecretsPage.tsx",
  "services/user-front/src/components/provider-workspace/ProviderServiceDeployPage.tsx",
];

const LITERAL_ATTR_ALLOWLIST = new Map([
  ["placeholder", [/^\d+(\.\d+)?$/]],
  [
    "aria-label",
    [
      /^GitHub$/,
      /^Marketing$/,
      /^About page navigation$/,
      /^Copy code$/,
      /^Copy install command$/,
      /^Open transaction explorer$/,
      /^Previous month$/,
      /^Next month$/,
      /^Language$/,
    ],
  ],
  ["title", [/^Quick Pay & Invoke$/]],
]);

function rel(file) {
  return path.relative(ROOT_DIR, file).split(path.sep).join("/");
}

function walk(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === "dist") {
        continue;
      }
      files.push(...walk(full));
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

function isIgnoredFile(file) {
  return (
    IGNORED_SEGMENTS.some((segment) => file.includes(segment)) ||
    IGNORED_SUFFIXES.some((suffix) => file.endsWith(suffix))
  );
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function isAllowedAttr(attr, value) {
  return (LITERAL_ATTR_ALLOWLIST.get(attr) || []).some((pattern) =>
    pattern.test(value)
  );
}

const findings = [];
for (const file of walk(SRC_DIR)) {
  if (isIgnoredFile(file)) continue;
  const relative = rel(file);
  const source = readFileSync(file, "utf8");

  const toastLiteralPattern =
    /\b(?:toast(?:\.(?:error|success|loading|custom|promise))?)\(\s*(['"`])((?:(?!\1)[\s\S]){1,240})\1/g;
  for (const match of source.matchAll(toastLiteralPattern)) {
    findings.push({
      file: relative,
      line: lineNumber(source, match.index ?? 0),
      message: "User-facing toast literal must come from i18n resources.",
    });
  }

  const confirmLiteralPattern =
    /\bconfirm\(\s*(['"`])((?:(?!\1)[\s\S]){1,240})\1/g;
  for (const match of source.matchAll(confirmLiteralPattern)) {
    findings.push({
      file: relative,
      line: lineNumber(source, match.index ?? 0),
      message:
        "Browser confirm literal must be replaced with localized UI copy.",
    });
  }

  if (!CJK_ALLOWLIST.includes(relative)) {
    const cjkPattern = /[\u4e00-\u9fff]/g;
    const match = cjkPattern.exec(source);
    if (match) {
      findings.push({
        file: relative,
        line: lineNumber(source, match.index),
        message:
          "CJK text outside i18n resources must be moved into en/zh resource files.",
      });
    }
  }

  const attrPattern =
    /\b(placeholder|aria-label|title)=["']([^"'{}]*[A-Za-z][^"'{}]*)["']/g;
  for (const match of source.matchAll(attrPattern)) {
    const [, attr, value] = match;
    if (isAllowedAttr(attr, value)) continue;
    findings.push({
      file: relative,
      line: lineNumber(source, match.index ?? 0),
      message: `${attr} literal "${value}" must be localized or added to the explicit allowlist.`,
    });
  }
}

if (findings.length > 0) {
  console.error("FATAL USER-FRONT-I18N-001: user-front i18n drift detected");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} ${finding.message}`);
  }
  process.exit(1);
}

console.log("[user-front-i18n] passed");
