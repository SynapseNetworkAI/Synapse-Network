#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const FULL_COMMANDS = [
  "runtime_preflight",
  "security_money_scan",
  "security_money_ts_scan",
  "finance_approval_safety_scan",
  "finance_mypy_scan",
  "local_runtime_guard_scan",
  "e2e_script_model_drift_scan",
  "migration_seed_guard_scan",
  "code_quality_architecture_scan",
  "diff_coverage_gate",
  "security_secret_scan",
  "gateway_stress_review_checks",
  "monitoring_alert_rules",
  "docs_checks",
  "release_go_no_go_checks",
  "frontend_checks",
  "admin_front_checks",
  "gateway_checks",
  "performance_reliability_checks",
  "admin_gateway_checks",
  "provider_service_checks",
  "sdk_python_checks",
  "contracts_checks",
];

const BASELINE_COMMANDS = [
  "runtime_preflight",
  "local_runtime_guard_scan",
  "migration_seed_guard_scan",
  "security_secret_scan",
  "docs_checks",
  "release_go_no_go_checks",
];

const ORDER = [...FULL_COMMANDS, "terraform_staging_validate"];

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
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
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

function matchesAny(file, patterns) {
  return patterns.some((pattern) => pattern.test(file));
}

const requestedMode = (argValue("--mode") || process.env.SYNAPSE_CI_SCOPE || "auto").trim();
const base = argValue("--base") || process.env.QUALITY_BASE_REF || "origin/main";
const head = argValue("--head") || "HEAD";
const jsonOut = argValue("--json");

if (!["auto", "full"].includes(requestedMode)) usage();

const fullResult = (reason, extra = {}) => {
  const changedFiles = extra.changedFiles || [];
  const needsTerraform = changedFiles.some((file) => file.startsWith("infra/terraform/"));
  return {
    mode: "full",
    failClosed: true,
    docsOnly: false,
    affectedProjects: ["gateway", "gateway-admin", "user-front", "admin-front", "contracts", "provider-service", "sdk-python"],
    riskScopes: needsTerraform ? ["full", "terraform"] : ["full"],
    commands: needsTerraform ? [...FULL_COMMANDS, "terraform_staging_validate"] : FULL_COMMANDS,
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
    result = fullResult("unable to resolve merge-base; running full CI fail-closed");
  } else {
    const diffOutput = tryGit(["diff", "--name-only", `${mergeBase}...${head}`]);
    if (diffOutput) {
      changedFiles.push(...diffOutput.split("\n").map((item) => item.trim()).filter(Boolean));
    }
    const untrackedOutput = tryGit(["ls-files", "--others", "--exclude-standard"]);
    if (untrackedOutput) {
      changedFiles.push(...untrackedOutput.split("\n").map((item) => item.trim()).filter(Boolean));
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

    const docsPatterns = [
      /^docs\//,
      /^llms\.txt$/,
      /\.md$/,
    ];
    const fullTriggerPatterns = [
      /^\.github\/workflows\//,
      /^scripts\/ci\//,
      /^scripts\/deploy\//,
      /^scripts\/dev\/install_git_hooks\.sh$/,
      /^semgrep\//,
      /^AGENTS\.md$/,
      /^package\.json$/,
      /^package-lock\.json$/,
      /^yarn\.lock$/,
      /^pnpm-lock\.yaml$/,
    ];
    const knownPatterns = [
      ...docsPatterns,
      /^services\/gateway\//,
      /^services\/gateway-admin\//,
      /^services\/user-front\//,
      /^services\/admin-front\//,
      /^contracts\//,
      /^scripts\/chain\//,
      /^scripts\/ops\/lark_alert_relay\.mjs$/,
      /^scripts\/e2e\//,
      /^scripts\/perf\//,
      /^scripts\/local\//,
      /^scripts\/staging\//,
      /^scripts\/prod\//,
      /^scripts\/tools\//,
      /^scripts\/python\//,
      /^infra\/monitoring\//,
      /^infra\/terraform\//,
      /^migrations\//,
      /^\.github\/instructions\//,
      /^\.githooks\//,
      /^hardhat\.config\./,
      /^tsconfig/,
      /^ruff\.toml$/,
      /^\.jscpd\.json$/,
    ];

    for (const file of changedFiles) {
      const isDocsFile = matchesAny(file, docsPatterns);
      docsOnly &&= isDocsFile;

      if (matchesAny(file, fullTriggerPatterns)) {
        forceFullReason = `${file} changes CI/tooling/root dependency behavior`;
        break;
      }
      if (!matchesAny(file, knownPatterns)) {
        unknownFile = file;
        break;
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
        if (/services\/user-front\/src\/.*(wallet|withdraw|billing|credits|payment|finance|audit|contract)/i.test(file)) {
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
        if (/services\/admin-front\/src\/.*(withdraw|finance|reconciliation|approval|risk|audit|analytics)/i.test(file)) {
          addCommand(commands, "security_money_ts_scan");
          addCommand(commands, "finance_approval_safety_scan");
          riskScopes.add("admin-front-finance-ui");
        }
      }

      if (file.startsWith("contracts/") || file.startsWith("scripts/chain/") || /^hardhat\.config\./.test(file)) {
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

      if (file.startsWith("infra/monitoring/") || file === "scripts/ops/lark_alert_relay.mjs") {
        riskScopes.add("monitoring");
        addCommand(commands, "monitoring_alert_rules");
      }

      if (file.startsWith("infra/terraform/")) {
        riskScopes.add("terraform");
        needsTerraform = true;
        addCommand(commands, "terraform_staging_validate");
      }

      if (file.includes("/migrations/") || file.endsWith("_schema.sql") || file === "scripts/deploy/migrate_db.sh") {
        riskScopes.add("schema-migration");
        addCommand(commands, "migration_seed_guard_scan");
        addCommand(commands, "gateway_checks");
      }
    }

    if (forceFullReason) {
      result = fullResult(forceFullReason, { changedFiles });
    } else if (unknownFile) {
      result = fullResult(`unknown file category ${unknownFile}; running full CI fail-closed`, { changedFiles });
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
        needsRootNpmDeps: orderedCommands.includes("contracts_checks"),
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
