#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function findRepoRoot(startDir) {
  let currentDir = startDir;

  while (true) {
    const hasDocs = fs.existsSync(path.join(currentDir, "docs"));
    const hasLlms = fs.existsSync(path.join(currentDir, "llms.txt"));
    const hasPackageJson = fs.existsSync(path.join(currentDir, "package.json"));

    if (hasDocs && hasLlms && hasPackageJson) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Unable to locate repository root from ${startDir}`);
    }

    currentDir = parentDir;
  }
}

const rootDir = findRepoRoot(__dirname);
const docsDir = path.join(rootDir, "docs");
const llmsPath = path.join(rootDir, "llms.txt");
const inventoryPath = path.join(docsDir, "00_Governance", "Documentation_Inventory.md");
const packageJsonPath = path.join(rootDir, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const availableNpmScripts = new Set(Object.keys(packageJson.scripts ?? {}));
const requiredVerifiedWithCanonicalDocs = new Set([
  "docs/02_System_Architecture/02_Gateway_Runtime_Architecture.md",
  "docs/02_System_Architecture/03_Identity_Authentication_and_Risk_Control.md",
  "docs/03_Core_Workflows/02_Discovery_and_Gateway_Call.md",
  "docs/04_Database_Design/01_SQL_Schema_Overview.md",
  "docs/06_Reference/03_Service_Manifest_and_Runtime_Object_Reference.md",
  "docs/06_Reference/04_Development_Testing_and_Integration_Reference.md",
  "docs/06_Reference/05_Runtime_API_Contract.md",
  "docs/06_Reference/06_Runtime_Error_Code_Catalog.md",
]);

const allowedRootDocs = new Set([
  "AGENTS.md",
  "ARCHITECTURE.md",
  "Design.md",
  "Harness_engineering.md",
  "README.md",
  "文档迁移.md",
]);

const retiredPaths = [
  "docs/agent",
  "docs/api.md",
  "docs/Gateway_Error_Codes.md",
  "docs/Gateway_Database_Design.md",
  "docs/测试文档.md",
  "docs/平台资金监控方案.md",
  "docs/充值退款审批流程.md",
];

const historicalPrefixAllowlist = [
  "docs/exec-plans/completed/",
  "docs/plan/",
];

const historicalFilesAllowlist = new Set([
  "docs/文档迁移.md",
  "docs/00_Governance/Agent_Docs_Migration_Map.md",
]);

const requiredLlmsAnchors = [
  "docs/AGENTS.md",
  "docs/README.md",
  "docs/ARCHITECTURE.md",
  "docs/Harness_engineering.md",
  "docs/00_Governance/Documentation_Constraints.md",
  "docs/00_Governance/Documentation_Inventory.md",
  "docs/06_Reference/Validation_Entry_Points.md",
  "npm run ci:docs",
];

const requiredReadmeAnchors = [
  "[00_Governance/Documentation_Constraints.md](./00_Governance/Documentation_Constraints.md)",
  "[00_Governance/Documentation_Inventory.md](./00_Governance/Documentation_Inventory.md)",
  "[06_Reference/Validation_Entry_Points.md](./06_Reference/Validation_Entry_Points.md)",
  "`npm run ci:docs`",
];

const allowedInventoryTiers = new Set([
  "root-entrypoint",
  "governance-entrypoint",
  "canonical-module",
  "project-entrypoint",
]);

const allowedInventoryOwners = new Set([
  "repo governance",
  "architecture",
  "runtime/backend",
  "runtime/backend + sdk",
  "finance/backend",
  "devops",
  "admin control plane",
  "frontend/product",
]);

const allowedLifecycleStatuses = new Set(["canonical", "supplementary", "incubation", "legacy", "archive"]);

const errors = [];

function toRepoPath(targetPath) {
  return path.relative(rootDir, targetPath).split(path.sep).join("/");
}

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function walkMarkdownFiles(startDir) {
  const results = [];
  const entries = fs.readdirSync(startDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMarkdownFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }

  return results;
}

function isHistoricalFile(repoPath) {
  if (historicalFilesAllowlist.has(repoPath)) {
    return true;
  }
  return historicalPrefixAllowlist.some((prefix) => repoPath.startsWith(prefix));
}

function normalizeLinkTarget(rawTarget) {
  const withoutAnchor = rawTarget.split("#")[0];
  if (!withoutAnchor || withoutAnchor.startsWith("http://") || withoutAnchor.startsWith("https://") || withoutAnchor.startsWith("mailto:")) {
    return null;
  }
  return withoutAnchor;
}

function linkHitsRetiredTarget(rawTarget) {
  const target = normalizeLinkTarget(rawTarget);
  if (!target) {
    return false;
  }
  return retiredPaths.some((retiredPath) => {
    const retiredName = retiredPath.replaceAll("\\", "/");
    return target.includes(retiredName) || target.includes(path.basename(retiredName));
  });
}

function firstLines(content, count) {
  return content.split(/\r?\n/).slice(0, count);
}

function metadataValueFromHeader(header, prefix) {
  const line = header.find((candidate) => candidate.startsWith(prefix));
  if (!line) {
    return null;
  }

  return normalizeMetadataValue(line.slice(prefix.length));
}

function npmScriptsFromMetadataValue(rawValue) {
  if (!rawValue) {
    return [];
  }

  return Array.from(rawValue.matchAll(/npm run ([a-z0-9:-]+)/gi), (match) => match[1]).filter(Boolean);
}

function normalizeMetadataValue(rawValue) {
  let normalized = rawValue.trim();
  while (normalized.startsWith("`")) {
    normalized = normalized.slice(1);
  }
  while (normalized.endsWith("`")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function parseIsoDate(rawValue, fieldName) {
  if (typeof rawValue !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    throw new TypeError(`${fieldName} must use YYYY-MM-DD format, received: ${rawValue}`);
  }

  const parsed = new Date(`${rawValue}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${fieldName} is not a valid UTC calendar date: ${rawValue}`);
  }

  return parsed;
}

function diffDays(laterDate, earlierDate) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((laterDate.getTime() - earlierDate.getTime()) / msPerDay);
}

function extractInventoryEntries() {
  if (!fs.existsSync(inventoryPath)) {
    errors.push("Missing documentation inventory: docs/00_Governance/Documentation_Inventory.md");
    return [];
  }

  const content = readFile(inventoryPath);
  const match = content.match(/<!-- docs-inventory:start -->\s*```json\s*([\s\S]*?)```\s*<!-- docs-inventory:end -->/);
  if (!match) {
    errors.push("Documentation_Inventory.md is missing the machine-readable docs inventory JSON block.");
    return [];
  }

  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) {
      errors.push("Documentation inventory JSON block must be an array.");
      return [];
    }
    return parsed;
  } catch (error) {
    errors.push(`Documentation inventory JSON block is invalid: ${error.message}`);
    return [];
  }
}

function checkRootDocs() {
  const rootEntries = fs.readdirSync(docsDir, { withFileTypes: true });
  const rootMarkdown = rootEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name);

  for (const fileName of rootMarkdown) {
    if (!allowedRootDocs.has(fileName)) {
      errors.push(`Unexpected root docs file: docs/${fileName}. Move it into a canonical module or update Documentation_Constraints.md and the docs gate first.`);
    }
  }
}

function checkRetiredPathsDoNotExist() {
  for (const retiredPath of retiredPaths) {
    if (fs.existsSync(path.join(rootDir, retiredPath))) {
      errors.push(`Retired path exists again: ${retiredPath}`);
    }
  }
}

function checkLlmsAnchors() {
  const llmsContent = readFile(llmsPath);
  for (const anchor of requiredLlmsAnchors) {
    if (!llmsContent.includes(anchor)) {
      errors.push(`llms.txt is missing required anchor: ${anchor}`);
    }
  }

  for (const retiredPath of retiredPaths) {
    const normalized = retiredPath.replaceAll("\\", "/");
    if (llmsContent.includes(normalized)) {
      errors.push(`llms.txt still references retired path: ${normalized}`);
    }
  }
}

function checkReadmeAnchors() {
  const readmeContent = readFile(path.join(docsDir, "README.md"));
  for (const anchor of requiredReadmeAnchors) {
    if (!readmeContent.includes(anchor)) {
      errors.push(`docs/README.md is missing required anchor: ${anchor}`);
    }
  }
}

function validateCanonicalReadmeMetadata(repoPath, header) {
  const hasCodePaths = header.some((line) => line.startsWith("- Code paths: "));
  const hasLastVerified = header.some((line) => line.startsWith("- Last verified against code: "));
  const verifiedWith = metadataValueFromHeader(header, "- Verified with: ");
  if (!hasCodePaths) {
    errors.push(`${repoPath} is canonical but missing '- Code paths:' in the top metadata block.`);
  }
  if (!verifiedWith) {
    errors.push(`${repoPath} is canonical but missing '- Verified with:' in the top metadata block.`);
  }
  if (!hasLastVerified) {
    errors.push(`${repoPath} is canonical but missing '- Last verified against code:' in the top metadata block.`);
  }

  validateVerifiedWithScripts(repoPath, verifiedWith);
}

function validateVerifiedWithScripts(repoPath, verifiedWith) {
  for (const scriptName of npmScriptsFromMetadataValue(verifiedWith)) {
    if (!availableNpmScripts.has(scriptName)) {
      errors.push(`${repoPath} references missing npm script in '- Verified with:': ${scriptName}`);
    }
  }
}

function validateRequiredDeepCanonicalMetadata(repoPath, header) {
  if (!requiredVerifiedWithCanonicalDocs.has(repoPath)) {
    return;
  }

  const verifiedWith = metadataValueFromHeader(header, "- Verified with: ");
  if (!verifiedWith) {
    errors.push(`${repoPath} is a high-value canonical truth page but missing '- Verified with:' in the top metadata block.`);
    return;
  }

  validateVerifiedWithScripts(repoPath, verifiedWith);
}

function validateNonCanonicalReadmeMetadata(repoPath, header, status) {
  const hasWhyRetained = header.some((line) => line.startsWith("- Why retained: "));
  if (!hasWhyRetained) {
    errors.push(`${repoPath} is ${status} but missing '- Why retained:' in the top metadata block.`);
  }

  if (status === "incubation") {
    const hasCanonicalTarget = header.some((line) => line.startsWith("- Canonical target: "));
    if (!hasCanonicalTarget) {
      errors.push(`${repoPath} is incubation but missing '- Canonical target:' in the top metadata block.`);
    }
    return;
  }

  const hasCanonicalCounterpart = header.some((line) => line.startsWith("- Canonical counterpart: "));
  const hasSupersededBy = header.some((line) => line.startsWith("- Superseded by: "));
  if (!hasCanonicalCounterpart && !hasSupersededBy) {
    errors.push(
      `${repoPath} is ${status} but missing '- Canonical counterpart:' or '- Superseded by:' in the top metadata block.`
    );
  }
}

function validateReadmeLifecycleMetadata(repoPath, header) {
  const status = metadataValueFromHeader(header, "- Status: ");

  if (!status) {
    errors.push(`${repoPath} is a README entrypoint but missing '- Status:' in the top metadata block.`);
    return;
  }

  if (!allowedLifecycleStatuses.has(status)) {
    errors.push(`${repoPath} has unsupported lifecycle status in header: ${status}`);
    return;
  }

  if (status === "canonical") {
    validateCanonicalReadmeMetadata(repoPath, header);
    return;
  }

  validateNonCanonicalReadmeMetadata(repoPath, header, status);
}

function checkReadmeLifecycleMetadata() {
  const files = walkMarkdownFiles(docsDir).filter((filePath) => path.basename(filePath) === "README.md");

  for (const filePath of files) {
    const repoPath = toRepoPath(filePath);
    const header = firstLines(readFile(filePath), 12);
    validateReadmeLifecycleMetadata(repoPath, header);
  }
}

function checkCanonicalMetadata() {
  const files = walkMarkdownFiles(docsDir);

  for (const filePath of files) {
    const repoPath = toRepoPath(filePath);
    if (repoPath.startsWith("docs/exec-plans/")) {
      continue;
    }

    const header = firstLines(readFile(filePath), 12);
    const statusLine = header.find((line) => line.startsWith("- Status: "));
    if (!statusLine) {
      continue;
    }

    const status = normalizeMetadataValue(statusLine.replace("- Status:", ""));
    if (!allowedLifecycleStatuses.has(status)) {
      errors.push(`${repoPath} has unsupported lifecycle status in header: ${status}`);
      continue;
    }

    if (status === "canonical") {
      const hasCodePaths = header.some((line) => line.startsWith("- Code paths: "));
      const hasLastVerified = header.some((line) => line.startsWith("- Last verified against code: "));
      if (!hasCodePaths) {
        errors.push(`${repoPath} is canonical but missing '- Code paths:' in the top metadata block.`);
      }
      if (!hasLastVerified) {
        errors.push(`${repoPath} is canonical but missing '- Last verified against code:' in the top metadata block.`);
      }
      validateRequiredDeepCanonicalMetadata(repoPath, header);
    }
  }
}

function checkRetiredLinks() {
  const files = walkMarkdownFiles(docsDir);
  const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;

  for (const filePath of files) {
    const repoPath = toRepoPath(filePath);
    if (isHistoricalFile(repoPath)) {
      continue;
    }

    const content = readFile(filePath);
    let match;
    while ((match = markdownLinkPattern.exec(content)) !== null) {
      const rawTarget = match[1];
      if (linkHitsRetiredTarget(rawTarget)) {
        errors.push(`${repoPath} links to retired path: ${rawTarget}`);
      }
    }
  }
}

function explicitCanonicalDocs() {
  const files = walkMarkdownFiles(docsDir);
  const results = [];

  for (const filePath of files) {
    const header = firstLines(readFile(filePath), 12);
    const statusLine = header.find((line) => line.startsWith("- Status: "));
    if (!statusLine) {
      continue;
    }

    const status = normalizeMetadataValue(statusLine.replace("- Status:", ""));
    if (status === "canonical") {
      results.push(toRepoPath(filePath));
    }
  }

  return results;
}

function officialModuleReadmes() {
  return new Set([
    "docs/00_Governance/README.md",
    "docs/01_Product_Frontend/README.md",
    "docs/02_System_Architecture/README.md",
    "docs/03_Core_Workflows/README.md",
    "docs/03_Projects/README.md",
    "docs/04_Database_Design/README.md",
    "docs/05_DevOps_Deployment/README.md",
    "docs/06_Reference/README.md",
    "docs/admin/README.md",
  ]);
}

function projectEntrypointDocs() {
  const projectsDir = path.join(docsDir, "03_Projects");
  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  const results = new Set();

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const readmePath = path.join(projectsDir, entry.name, "README.md");
    if (fs.existsSync(readmePath)) {
      results.add(toRepoPath(readmePath));
    }
  }

  return results;
}

function requiredInventoryPaths() {
  const rootDocs = Array.from(allowedRootDocs).map((fileName) => `docs/${fileName}`);
  return new Set([
    ...rootDocs,
    "docs/00_Governance/Documentation_Constraints.md",
    "docs/00_Governance/Documentation_Lifecycle.md",
    "docs/00_Governance/Ownership_And_Review_Matrix.md",
    "docs/00_Governance/Drift_Checklist.md",
    "docs/00_Governance/Documentation_Inventory.md",
    "docs/06_Reference/Validation_Entry_Points.md",
    ...officialModuleReadmes(),
    ...projectEntrypointDocs(),
    ...explicitCanonicalDocs(),
  ]);
}

function inventoryRequiredFields() {
  return [
    "path",
    "tier",
    "status",
    "owner",
    "lastReviewed",
    "reviewCadenceDays",
    "codePaths",
    "validation",
  ];
}

function ensureInventoryEntryFields(entry) {
  for (const fieldName of inventoryRequiredFields()) {
    if (!(fieldName in entry)) {
      errors.push(`Documentation inventory entry is missing required field '${fieldName}'.`);
    }
  }
}

function validateInventoryCodePaths(entry) {
  if (!Array.isArray(entry.codePaths) || entry.codePaths.length === 0) {
    errors.push(`${entry.path} must declare at least one codePaths entry.`);
    return;
  }

  for (const codePath of entry.codePaths) {
    if (typeof codePath !== "string") {
      errors.push(`${entry.path} contains a non-string codePaths entry.`);
      continue;
    }

    const fullPath = path.join(rootDir, codePath);
    if (!fs.existsSync(fullPath)) {
      errors.push(`${entry.path} references missing code path in inventory: ${codePath}`);
    }
  }
}

function validateInventoryValidationAnchors(entry) {
  if (!Array.isArray(entry.validation) || entry.validation.length === 0) {
    errors.push(`${entry.path} must declare at least one validation anchor.`);
  }
}

function validateInventoryLifecycleFields(entry) {
  if (!allowedInventoryTiers.has(entry.tier)) {
    errors.push(`${entry.path} has unsupported inventory tier: ${entry.tier}`);
  }

  if (!allowedInventoryOwners.has(entry.owner)) {
    errors.push(`${entry.path} has unsupported inventory owner: ${entry.owner}`);
  }

  if (!allowedLifecycleStatuses.has(entry.status)) {
    errors.push(`${entry.path} has unsupported inventory status: ${entry.status}`);
  }

  if (!Number.isInteger(entry.reviewCadenceDays) || entry.reviewCadenceDays <= 0) {
    errors.push(`${entry.path} must use a positive integer reviewCadenceDays.`);
  }
}

function validateInventoryFreshness(entry, today) {
  let lastReviewedDate;
  try {
    lastReviewedDate = parseIsoDate(entry.lastReviewed, `${entry.path} lastReviewed`);
  } catch (error) {
    errors.push(error.message);
    return;
  }

  if (lastReviewedDate.getTime() > today.getTime()) {
    errors.push(`${entry.path} has future lastReviewed date: ${entry.lastReviewed}`);
    return;
  }

  if (["legacy", "archive"].includes(entry.status)) {
    return;
  }

  const ageInDays = diffDays(today, lastReviewedDate);
  if (ageInDays > entry.reviewCadenceDays) {
    errors.push(
      `${entry.path} review freshness expired: lastReviewed=${entry.lastReviewed}, age=${ageInDays}d, cadence=${entry.reviewCadenceDays}d.`
    );
  }
}

function validateInventoryDocumentAlignment(entry) {
  const fullDocPath = path.join(rootDir, entry.path);
  if (!fs.existsSync(fullDocPath)) {
    errors.push(`Documentation inventory references missing document: ${entry.path}`);
    return;
  }

  const header = firstLines(readFile(fullDocPath), 12);
  const statusLine = header.find((line) => line.startsWith("- Status: "));
  const lastVerifiedLine = header.find((line) => line.startsWith("- Last verified against code: "));

  if (statusLine) {
    const docStatus = normalizeMetadataValue(statusLine.replace("- Status:", ""));
    if (docStatus !== entry.status) {
      errors.push(`${entry.path} status mismatch between document header (${docStatus}) and inventory (${entry.status}).`);
    }
  }

  if (lastVerifiedLine) {
    const docLastVerified = normalizeMetadataValue(
      lastVerifiedLine.replace("- Last verified against code:", "")
    );
    if (docLastVerified !== entry.lastReviewed) {
      errors.push(
        `${entry.path} last review mismatch between document header (${docLastVerified}) and inventory (${entry.lastReviewed}).`
      );
    }
  }
}

function validateInventoryEntry(entry, seenPaths, inventoryMap, today) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    errors.push("Documentation inventory contains a non-object entry.");
    return;
  }

  ensureInventoryEntryFields(entry);

  if (typeof entry.path !== "string" || !entry.path.endsWith(".md")) {
    errors.push(`Documentation inventory entry has invalid path: ${entry.path}`);
    return;
  }

  if (seenPaths.has(entry.path)) {
    errors.push(`Documentation inventory contains duplicate path: ${entry.path}`);
    return;
  }

  seenPaths.add(entry.path);
  inventoryMap.set(entry.path, entry);

  validateInventoryLifecycleFields(entry);
  validateInventoryCodePaths(entry);
  validateInventoryValidationAnchors(entry);
  validateInventoryFreshness(entry, today);
  validateInventoryDocumentAlignment(entry);
}

function ensureRequiredInventoryCoverage(inventoryMap) {
  for (const requiredPath of requiredInventoryPaths()) {
    if (!inventoryMap.has(requiredPath)) {
      errors.push(`Documentation inventory is missing required document: ${requiredPath}`);
    }
  }
}

function checkInventory() {
  const entries = extractInventoryEntries();
  if (entries.length === 0) {
    return;
  }

  const seenPaths = new Set();
  const inventoryMap = new Map();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (const entry of entries) {
    validateInventoryEntry(entry, seenPaths, inventoryMap, today);
  }

  ensureRequiredInventoryCoverage(inventoryMap);
}

function main() {
  checkRootDocs();
  checkRetiredPathsDoNotExist();
  checkLlmsAnchors();
  checkReadmeAnchors();
  checkReadmeLifecycleMetadata();
  checkCanonicalMetadata();
  checkRetiredLinks();
  checkInventory();

  if (errors.length > 0) {
    console.error("[ci:docs] documentation validation failed\n");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("[ci:docs] documentation validation passed");
}

main();