#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const WORKFLOW_DIR = path.join(ROOT, ".github", "workflows");

const BASELINE_ACTION_MAJORS = new Map([
  ["actions/checkout", 6],
  ["actions/setup-node", 6],
  ["actions/setup-python", 6],
  ["actions/cache", 5],
  ["actions/upload-artifact", 4],
]);

const failures = [];

function fail(file, code, message, fix) {
  failures.push({ file, code, message, fix });
}

function workflowFiles() {
  if (!fs.existsSync(WORKFLOW_DIR)) {
    return [];
  }
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter((entry) => /\.ya?ml$/i.test(entry))
    .sort()
    .map((entry) => path.join(WORKFLOW_DIR, entry));
}

function relative(filePath) {
  return path.relative(ROOT, filePath);
}

function topLevelBlock(lines, key) {
  const start = lines.findIndex(
    (line) => line.trim() === `${key}:` && !/^\s/.test(line)
  );
  if (start === -1) {
    return [];
  }

  const block = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[^\s#][^:]*:/.test(line)) {
      break;
    }
    block.push(line);
  }
  return block;
}

function hasForcedNode24(lines) {
  return topLevelBlock(lines, "env").some((line) =>
    /^\s{2}FORCE_JAVASCRIPT_ACTIONS_TO_NODE24:\s*["']?true["']?\s*$/i.test(line)
  );
}

function scanActionVersions(file, text) {
  const rel = relative(file);
  const actionPattern =
    /^\s*uses:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([^\s#]+)/gim;
  let match;
  while ((match = actionPattern.exec(text)) !== null) {
    const action = match[1];
    const ref = match[2];
    const minimumMajor = BASELINE_ACTION_MAJORS.get(action);
    if (!minimumMajor) {
      continue;
    }

    const version = /^v(\d+)(?:\D|$)/.exec(ref);
    if (!version) {
      fail(
        rel,
        "GHA-NODE24-ACTION-REF",
        `${action}@${ref} is not pinned to a major version that the runtime guard can compare.`,
        `Pin ${action} to v${minimumMajor} or newer, or extend scripts/ci/github_actions_node_runtime_check.mjs with the approved exception.`
      );
      continue;
    }

    const major = Number.parseInt(version[1], 10);
    if (major < minimumMajor) {
      fail(
        rel,
        "GHA-NODE24-ACTION-MAJOR",
        `${action}@${ref} is below the repo baseline v${minimumMajor}.`,
        `Upgrade ${action} to v${minimumMajor} or newer so GitHub Actions JavaScript actions stay Node 24 compatible.`
      );
    }
  }
}

for (const file of workflowFiles()) {
  const rel = relative(file);
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);

  if (!hasForcedNode24(lines)) {
    fail(
      rel,
      "GHA-NODE24-FORCE-MISSING",
      "workflow does not set top-level env FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true.",
      'Add a top-level env block with FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true".'
    );
  }

  if (/ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION\s*:/i.test(text)) {
    fail(
      rel,
      "GHA-NODE24-UNSECURE-OPT-OUT",
      "workflow opts out of the Node 24 migration by setting ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION.",
      "Remove ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION; do not keep JavaScript actions on the deprecated Node 20 runtime."
    );
  }

  scanActionVersions(file, text);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FATAL ${failure.code}: ${failure.file}`);
    console.error(`Why dangerous: ${failure.message}`);
    console.error(`Agent fix: ${failure.fix}`);
  }
  process.exit(1);
}

console.log(
  "[github-actions-runtime] workflows force JavaScript actions onto Node 24"
);
