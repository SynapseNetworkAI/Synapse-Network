#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SOURCE_ROOT = path.join(ROOT, "services/docs-front/content/docs");
const MIRROR_REPO_ROOT = path.resolve(
  process.env.SYNAPSE_DOCS_MIRROR_ROOT ||
    path.join(ROOT, "../Synapse-Network-Docs")
);
const DEST_ROOT = path.join(MIRROR_REPO_ROOT, "content/docs");

function fail(message) {
  console.error(`FATAL DOCS-MIRROR-001: ${message}`);
  process.exit(1);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function removeChildren(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }

  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function listFiles(dir) {
  const output = [];
  const walk = (current, relativeBase = "") => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = path.join(relativeBase, entry.name);
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else {
        output.push(rel);
      }
    }
  };
  walk(dir);
  return output.sort();
}

if (!fs.existsSync(SOURCE_ROOT)) {
  fail(`source docs tree is missing: ${SOURCE_ROOT}`);
}

if (!fs.existsSync(MIRROR_REPO_ROOT)) {
  fail(`mirror repo is missing: ${MIRROR_REPO_ROOT}`);
}

ensureDir(DEST_ROOT);
removeChildren(DEST_ROOT);
copyRecursive(SOURCE_ROOT, DEST_ROOT);

const files = listFiles(DEST_ROOT);
console.log(`Synced ${files.length} public docs files to ${DEST_ROOT}`);
for (const file of files) {
  console.log(`- ${file}`);
}
