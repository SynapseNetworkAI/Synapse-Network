#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { classifyPackageJsonChange } from "./resolve_pr_ci_scope_package.mjs";
import {
  BASELINE_COMMANDS,
  FULL_COMMANDS,
  ORDER,
  adminUiScriptPatterns,
  deployOpsScriptPatterns,
  docsPatterns,
  fullTriggerPatterns,
  gatewayAdminProjectionSqlPatterns,
  knownPatterns,
  matchesAny,
  narrowCiToolPatterns,
  rootE2eScriptPatterns,
} from "./resolve_pr_ci_scope_rules.mjs";

function usage() {
  console.error(
    "Usage: node scripts/ci/resolve_pr_ci_scope.mjs [--base <ref>] [--head <ref>] [--mode auto|full] [--json <path>]",
  );
  process.exit(2);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return "";
  }
}

function unique(values) {
  return [...new Set(values)];
}

function addCommand(set, command) {
  set.add(command);
}

const requestedMode = (
  argValue("--mode") ||
  process.env.SYNAPSE_CI_SCOPE ||
  "auto"
).trim();
const base =
  argValue("--base") || process.env.QUALITY_BASE_REF || "origin/main";
const head = argValue("--head") || "HEAD";
const jsonOut = argValue("--json");

if (!["auto", "full"].includes(requestedMode)) usage();

const fullResult = (reason, extra = {}) => {
  const changedFiles = extra.changedFiles || [];
  const needsTerraform = changedFiles.some((file) =>
    file.startsWith("infra/terraform/"),
  );
  return {
    mode: "full",
    failClosed: true,
    docsOnly: false,
    affectedProjects: [
      "gateway",
      "gateway-admin",
      "user-front",
      "admin-front",
      "contracts",
      "provider-service",
      "sdk-python",
    ],
    riskScopes: needsTerraform ? ["full", "terraform"] : ["full"],
    commands: needsTerraform
      ? [...FULL_COMMANDS, "terraform_staging_validate"]
      : FULL_COMMANDS,
    changedFiles,
    reasons: unique([reason, ...(extra.reasons || [])]),
    needsRootNpmDeps: true,
    needsUserFrontDeps: true,
    needsAdminFrontDeps: true,
    needsTerraform,
  };
};

let result;

if (requestedMode === "full") {
  result = fullResult("SYNAPSE_CI_SCOPE=full requested");
} else {
  let mergeBase = "";
  let changedFiles = [];
  const reasons = [];

  if (base) {
    mergeBase = tryGit(["merge-base", base, head]);
    if (!mergeBase && base.startsWith("origin/")) {
      const branch = base.slice("origin/".length);
      tryGit(["fetch", "origin", branch, "--depth=200"]);
      mergeBase = tryGit(["merge-base", base, head]);
    }
  }

  if (!mergeBase) {
    result = fullResult(
      "unable to resolve merge-base; running full CI fail-closed",
    );
  } else {
    const diffOutput = tryGit([
      "diff",
      "--name-only",
      `${mergeBase}...${head}`,
    ]);
    if (diffOutput) {
      changedFiles.push(
        ...diffOutput
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
      );
    }
    const untrackedOutput = tryGit([
      "ls-files",
      "--others",
      "--exclude-standard",
    ]);
    if (untrackedOutput) {
      changedFiles.push(
        ...untrackedOutput
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
      );
    }
    changedFiles = unique(changedFiles).sort();

    const commands = new Set(BASELINE_COMMANDS);
    const affectedProjects = new Set();
    const riskScopes = new Set(["baseline"]);
    let docsOnly = changedFiles.length > 0;
    let needsUserFrontDeps = false;
    let needsAdminFrontDeps = false;
    let needsTerraform = false;
    let unknownFile = "";
    let forceFullReason = "";

    const packageJsonScope = changedFiles.includes("package.json")
      ? classifyPackageJsonChange(mergeBase, head)
      : null;

    for (const file of changedFiles) {
      const isDocsFile = matchesAny(file, docsPatterns);
      const isNarrowCiToolFile = matchesAny(file, narrowCiToolPatterns);
      docsOnly &&= isDocsFile;

      if (isNarrowCiToolFile) {
        docsOnly = false;
        riskScopes.add("agent-lessons");
        reasons.push("agent lessons CI tool change mapped narrowly");
        continue;
      }

      if (matchesAny(file, fullTriggerPatterns)) {
        forceFullReason = `${file} changes CI/tooling/root dependency behavior`;
        break;
      }
      if (!matchesAny(file, knownPatterns)) {
        unknownFile = file;
        break;
      }

      if (file === "package.json") {
        docsOnly = false;
        if (packageJsonScope?.fullReason) {
          forceFullReason = packageJsonScope.fullReason;
          break;
        }
        for (const command of packageJsonScope?.commands || []) {
          addCommand(commands, command);
        }
        for (const scope of packageJsonScope?.riskScopes || []) {
          riskScopes.add(scope);
        }
        if (packageJsonScope?.needsRootNpmDeps) {
          addCommand(commands, "contracts_checks");
        }
        if (packageJsonScope?.reason) {
          reasons.push(packageJsonScope.reason);
        }
        continue;
      }

      if (file === "package-lock.json") {
        docsOnly = false;
        riskScopes.add("root-npm-lock");
        addCommand(commands, "ci_meta_checks");
        addCommand(commands, "contracts_checks");
        reasons.push(
          "root npm lockfile changed; running baseline plus root toolchain checks",
        );
        continue;
      }

      if (matchesAny(file, rootE2eScriptPatterns)) {
        docsOnly = false;
        affectedProjects.add("gateway");
        affectedProjects.add("user-front");
        riskScopes.add("e2e-fixtures");
        addCommand(commands, "e2e_script_model_drift_scan");
        addCommand(commands, "code_quality_architecture_scan");
        addCommand(commands, "diff_coverage_gate");
        continue;
      }

      if (matchesAny(file, adminUiScriptPatterns)) {
        docsOnly = false;
        affectedProjects.add("admin-front");
        affectedProjects.add("gateway-admin");
        needsAdminFrontDeps = true;
        riskScopes.add("admin-ui-e2e");
        addCommand(commands, "e2e_script_model_drift_scan");
        addCommand(commands, "code_quality_architecture_scan");
        addCommand(commands, "diff_coverage_gate");
        addCommand(commands, "admin_front_checks");
        addCommand(commands, "admin_gateway_checks");
        continue;
      }

      if (matchesAny(file, gatewayAdminProjectionSqlPatterns)) {
        docsOnly = false;
        affectedProjects.add("gateway-admin");
        riskScopes.add("gateway-admin");
        riskScopes.add("schema-migration");
        addCommand(commands, "security_money_scan");
        addCommand(commands, "finance_approval_safety_scan");
        addCommand(commands, "finance_mypy_scan");
        addCommand(commands, "e2e_script_model_drift_scan");
        addCommand(commands, "code_quality_architecture_scan");
        addCommand(commands, "diff_coverage_gate");
        addCommand(commands, "admin_gateway_checks");
        continue;
      }

      if (
        file.startsWith(".github/workflows/") ||
        file.startsWith(".github/instructions/") ||
        file.startsWith(".githooks/") ||
        file.startsWith("scripts/ci/")
      ) {
        docsOnly = false;
        riskScopes.add("ci-tooling");
        addCommand(commands, "ci_meta_checks");
        continue;
      }

      if (matchesAny(file, deployOpsScriptPatterns)) {
        docsOnly = false;
        riskScopes.add("ops-automation");
        riskScopes.add("monitoring");
        addCommand(commands, "ci_meta_checks");
        addCommand(commands, "monitoring_alert_rules");
        continue;
      }

      if (file.startsWith("scripts/ops/") || file.startsWith("scripts/git/")) {
        docsOnly = false;
        riskScopes.add("ops-automation");
        addCommand(commands, "ci_meta_checks");
        if (/alert|monitoring|lark/i.test(file)) {
          riskScopes.add("monitoring");
          addCommand(commands, "monitoring_alert_rules");
        }
        continue;
      }

      if (file.startsWith("scripts/seo/")) {
        docsOnly = false;
        riskScopes.add("ai-visibility-assets");
        addCommand(commands, "ci_meta_checks");
        addCommand(commands, "quality_budget_check");
        addCommand(commands, "docs_checks");
        continue;
      }

      if (file.startsWith("services/gateway/")) {
        affectedProjects.add("gateway");
        riskScopes.add("gateway");
        addCommand(commands, "security_money_scan");
        addCommand(commands, "finance_approval_safety_scan");
        addCommand(commands, "finance_mypy_scan");
        addCommand(commands, "e2e_script_model_drift_scan");
        addCommand(commands, "code_quality_architecture_scan");
        addCommand(commands, "diff_coverage_gate");
        addCommand(commands, "gateway_checks");

        if (/services\/gateway\/(src|tests|migrations)\//.test(file)) {
          addCommand(commands, "gateway_stress_review_checks");
          addCommand(commands, "performance_reliability_checks");
          riskScopes.add("gateway-runtime");
        }
      }

      if (file.startsWith("services/gateway-admin/")) {
        affectedProjects.add("gateway-admin");
        riskScopes.add("gateway-admin");
        addCommand(commands, "security_money_scan");
        addCommand(commands, "finance_approval_safety_scan");
        addCommand(commands, "finance_mypy_scan");
        addCommand(commands, "e2e_script_model_drift_scan");
        addCommand(commands, "code_quality_architecture_scan");
        addCommand(commands, "diff_coverage_gate");
        addCommand(commands, "admin_gateway_checks");
      }

      if (file.startsWith("services/user-front/")) {
        affectedProjects.add("user-front");
        needsUserFrontDeps = true;
        addCommand(commands, "code_quality_architecture_scan");
        addCommand(commands, "diff_coverage_gate");
        addCommand(commands, "frontend_checks");
        if (
          /services\/user-front\/src\/.*(wallet|withdraw|billing|credits|payment|finance|audit|contract)/i.test(
            file,
          )
        ) {
          addCommand(commands, "security_money_ts_scan");
          riskScopes.add("user-front-money-ui");
        }
      }

      if (file.startsWith("services/admin-front/")) {
        affectedProjects.add("admin-front");
        needsAdminFrontDeps = true;
        addCommand(commands, "code_quality_architecture_scan");
        addCommand(commands, "diff_coverage_gate");
        addCommand(commands, "admin_front_checks");
        if (
          /services\/admin-front\/src\/.*(withdraw|finance|reconciliation|approval|risk|audit|analytics)/i.test(
            file,
          )
        ) {
          addCommand(commands, "security_money_ts_scan");
          addCommand(commands, "finance_approval_safety_scan");
          riskScopes.add("admin-front-finance-ui");
        }
      }

      if (
        file.startsWith("contracts/") ||
        file.startsWith("scripts/chain/") ||
        /^hardhat\.config\./.test(file)
      ) {
        affectedProjects.add("contracts");
        affectedProjects.add("gateway");
        affectedProjects.add("user-front");
        needsUserFrontDeps = true;
        riskScopes.add("chain-contracts");
        addCommand(commands, "contracts_checks");
        addCommand(commands, "security_money_scan");
        addCommand(commands, "gateway_checks");
        addCommand(commands, "frontend_checks");
      }

      if (
        file.startsWith("infra/monitoring/") ||
        file === "scripts/ops/lark_alert_relay.mjs"
      ) {
        riskScopes.add("monitoring");
        addCommand(commands, "monitoring_alert_rules");
      }

      if (file.startsWith("infra/terraform/")) {
        riskScopes.add("terraform");
        needsTerraform = true;
        addCommand(commands, "terraform_staging_validate");
      }

      if (
        file.includes("/migrations/") ||
        file.endsWith("_schema.sql") ||
        file === "scripts/deploy/migrate_db.sh"
      ) {
        riskScopes.add("schema-migration");
        addCommand(commands, "gateway_checks");
      }
    }

    if (forceFullReason) {
      result = fullResult(forceFullReason, { changedFiles });
    } else if (unknownFile) {
      result = fullResult(
        `unknown file category ${unknownFile}; running full CI fail-closed`,
        { changedFiles },
      );
    } else {
      if (docsOnly) {
        reasons.push("docs-only change; running baseline gates only");
      } else {
        reasons.push("dynamic PR CI scope resolved from changed files");
      }
      const orderedCommands = ORDER.filter((command) => commands.has(command));
      result = {
        mode: "auto",
        failClosed: false,
        docsOnly,
        affectedProjects: unique([...affectedProjects]).sort(),
        riskScopes: unique([...riskScopes]).sort(),
        commands: orderedCommands,
        changedFiles,
        reasons,
        needsRootNpmDeps:
          orderedCommands.includes("contracts_checks") ||
          Boolean(packageJsonScope?.needsRootNpmDeps),
        needsUserFrontDeps,
        needsAdminFrontDeps,
        needsTerraform,
      };
    }
  }
}

const body = `${JSON.stringify(result, null, 2)}\n`;
if (jsonOut) {
  writeFileSync(jsonOut, body);
}
process.stdout.write(body);
