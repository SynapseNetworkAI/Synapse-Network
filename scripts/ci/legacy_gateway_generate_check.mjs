#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const FORBIDDEN = [
  "/api/v1/" + "gateway" + "/" + "generate",
  "/v1/" + "gateway" + "/" + "generate",
];
const ROOTS = [
  "services",
  "scripts",
  "docs",
  "services/docs-front",
  "services/user-front",
];
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".next",
  ".venv",
  "__pycache__",
  "logs",
  "tmp",
  "output",
  "evidence",
]);

function* walk(dir) {
  const entries = fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true })
    : [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        yield* walk(fullPath);
      }
      continue;
    }
    if (entry.isFile()) {
      yield fullPath;
    }
  }
}

const offenders = [];
for (const root of ROOTS) {
  for (const filePath of walk(path.join(ROOT, root))) {
    if (filePath === fileURLToPath(import.meta.url)) {
      continue;
    }
    const text = fs.readFileSync(filePath, "utf8");
    for (const forbidden of FORBIDDEN) {
      if (text.includes(forbidden)) {
        offenders.push(
          `${path.relative(
            ROOT,
            filePath
          )} contains removed endpoint ${forbidden}`
        );
      }
    }
  }
}

if (offenders.length) {
  console.error(
    "[ci:legacy-gateway-generate] removed endpoint references found"
  );
  for (const offender of offenders) {
    console.error(`- ${offender}`);
  }
  process.exit(1);
}

console.log("[ci:legacy-gateway-generate] passed");
