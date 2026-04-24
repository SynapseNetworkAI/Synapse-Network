#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const SERVICES = ["gateway", "gateway-admin", "user-front", "admin-front"];

function usage() {
  console.error(`Usage: node scripts/deploy/resolve_deploy_scope.mjs --base <sha> --head <sha> [--scope auto|gateway|gateway-admin|user-front|admin-front|all] [--json <path>]`);
  process.exit(2);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function unique(values) {
  return [...new Set(values)];
}

const base = argValue("--base");
const head = argValue("--head") || "HEAD";
const requestedScope = (argValue("--scope") || "auto").trim();
const jsonOut = argValue("--json");

if (!head) usage();
if (![...SERVICES, "all", "auto"].includes(requestedScope)) {
  console.error(`Invalid deploy scope: ${requestedScope}`);
  usage();
}

let changedFiles = [];
if (base) {
  changedFiles = git(["diff", "--name-only", `${base}...${head}`])
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
} else {
  changedFiles = git(["diff-tree", "--no-commit-id", "--name-only", "-r", head])
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

let services = [];
let requiresMigration = false;
let requiresTerraformApply = false;
const reasons = [];

function addService(service, reason) {
  services.push(service);
  reasons.push(reason);
}

if (requestedScope !== "auto") {
  services = requestedScope === "all" ? [...SERVICES] : [requestedScope];
  reasons.push(`manual deploy_scope=${requestedScope}`);
} else {
  for (const file of changedFiles) {
    if (file.startsWith("services/gateway/")) addService("gateway", "services/gateway changed");
    if (file.startsWith("services/gateway-admin/")) addService("gateway-admin", "services/gateway-admin changed");
    if (file.startsWith("services/user-front/")) addService("user-front", "services/user-front changed");
    if (file.startsWith("services/admin-front/")) addService("admin-front", "services/admin-front changed");

    if (
      file.startsWith("infra/terraform/") ||
      file.startsWith(".github/workflows/") ||
      file.startsWith("scripts/deploy/") ||
      file === "package.json" ||
      file === "yarn.lock" ||
      file === "package-lock.json"
    ) {
      services = [...SERVICES];
      requiresTerraformApply = file.startsWith("infra/terraform/");
      reasons.push(`${file} requires full deploy consideration`);
    }

    if (
      file.includes("/migrations/") ||
      file.endsWith("_schema.sql") ||
      file.endsWith("migrate_db.sh") ||
      file === "scripts/deploy/migrate_db.sh"
    ) {
      addService("gateway", "schema or migration changed");
      requiresMigration = true;
    }

    if (file.startsWith("contracts/") || file.startsWith("scripts/chain/")) {
      addService("gateway", "contract/runtime chain config changed");
      addService("user-front", "contract/frontend chain config changed");
    }
  }
}

services = unique(services);
const docsOnly = changedFiles.length > 0 && changedFiles.every((file) =>
  file.startsWith("docs/") ||
  file.endsWith(".md") ||
  file.startsWith("docs/evidence/") ||
  file === "llms.txt"
);

if (requestedScope === "auto" && docsOnly) {
  services = [];
  reasons.length = 0;
  reasons.push("docs-only change");
}

const result = {
  deploy: services.length > 0,
  services,
  requiresMigration,
  requiresTerraformApply,
  changedFiles,
  reason: unique(reasons),
};

const body = `${JSON.stringify(result, null, 2)}\n`;
if (jsonOut) {
  writeFileSync(jsonOut, body);
}
process.stdout.write(body);
