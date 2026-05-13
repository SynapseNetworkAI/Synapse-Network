export const BASELINE_STATIC_COMMANDS = [
  "runtime_preflight",
  "ci_meta_checks",
  "local_runtime_guard_scan",
  "security_secret_scan",
  "e2e_env_isolation_check",
];

export const BASELINE_QUALITY_COMMANDS = [
  "code_quality_architecture_scan",
  "quality_budget_check",
  "format_check",
  "diff_coverage_gate",
];

export const BASELINE_POLICY_COMMANDS = [
  "security_money_scan",
  "security_money_ts_scan",
  "finance_approval_safety_scan",
  "finance_mypy_scan",
  "e2e_script_model_drift_scan",
  "docs_checks",
  "release_go_no_go_checks",
  "monitoring_alert_rules",
];

export const BASELINE_COMMANDS = [
  ...BASELINE_STATIC_COMMANDS,
  ...BASELINE_QUALITY_COMMANDS,
  ...BASELINE_POLICY_COMMANDS,
];

export const FULL_COMMANDS = [
  ...BASELINE_COMMANDS,
  "gateway_stress_review_checks",
  "frontend_checks",
  "admin_front_checks",
  "gateway_checks",
  "performance_reliability_checks",
  "admin_gateway_checks",
  "provider_service_checks",
  "sdk_python_checks",
  "contracts_checks",
];

export const ORDER = [...FULL_COMMANDS, "terraform_staging_validate"];

export const docsPatterns = [/^docs\//, /^llms\.txt$/, /\.md$/];

export const rootE2eScriptPatterns = [
  /^scripts\/e2e_fullflow_test\.py$/,
  /^scripts\/fullchain_browser_test\.py$/,
  /^scripts\/verify_chain\.py$/,
];

export const fullTriggerPatterns = [
  /^scripts\/deploy\//,
  /^scripts\/dev\/install_git_hooks\.sh$/,
  /^semgrep\//,
  /^AGENTS\.md$/,
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
];

export const knownPatterns = [
  ...docsPatterns,
  /^services\/gateway\//,
  /^services\/gateway-admin\//,
  /^services\/user-front\//,
  /^services\/admin-front\//,
  /^contracts\//,
  /^scripts\/chain\//,
  /^scripts\/ci\//,
  /^scripts\/ops\//,
  /^scripts\/git\//,
  /^scripts\/e2e\//,
  ...rootE2eScriptPatterns,
  /^scripts\/perf\//,
  /^scripts\/local\//,
  /^scripts\/staging\//,
  /^scripts\/prod\//,
  /^scripts\/tools\//,
  /^scripts\/python\//,
  /^infra\/monitoring\//,
  /^infra\/terraform\//,
  /^infra\/docker\//,
  /^infra\/postgres\//,
  /^migrations\//,
  /^\.github\/instructions\//,
  /^\.github\/workflows\//,
  /^\.githooks\//,
  /^hardhat\.config\./,
  /^package\.json$/,
  /^tsconfig/,
  /^ruff\.toml$/,
  /^\.jscpd\.json$/,
];

const CI_GATE_COMMANDS = [
  [/^scripts\/ci\/frontend_checks\.sh$/, "frontend_checks", "user-front"],
  [/^scripts\/ci\/admin_front_checks\.sh$/, "admin_front_checks", "admin-front"],
  [/^scripts\/ci\/gateway_checks\.sh$/, "gateway_checks", "gateway"],
  [
    /^scripts\/ci\/admin_gateway_checks\.sh$/,
    "admin_gateway_checks",
    "gateway-admin",
  ],
  [
    /^scripts\/ci\/provider_service_checks\.sh$/,
    "provider_service_checks",
    "provider-service",
  ],
  [/^scripts\/ci\/sdk_python_checks\.sh$/, "sdk_python_checks", "sdk-python"],
  [/^scripts\/ci\/contracts_checks\.sh$/, "contracts_checks", "contracts"],
  [/^scripts\/ci\/docs_checks\.sh$/, "docs_checks", "docs"],
  [
    /^scripts\/ci\/performance_reliability_checks\.sh$/,
    "performance_reliability_checks",
    "performance",
  ],
  [
    /^scripts\/ci\/gateway_stress_review_checks\.sh$/,
    "gateway_stress_review_checks",
    "gateway",
  ],
];

export function matchesAny(file, patterns) {
  return patterns.some((pattern) => pattern.test(file));
}

export function isDocsFile(file) {
  return matchesAny(file, docsPatterns);
}

export function isFullTriggerFile(file) {
  return matchesAny(file, fullTriggerPatterns);
}

export function isKnownFile(file) {
  return matchesAny(file, knownPatterns);
}

function classifyWorkflowFile(file) {
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)) {
    return {
      commands: ["ci_meta_checks"],
      riskScopes: ["github-actions"],
      reason: "GitHub workflow change mapped to workflow/static CI checks",
    };
  }
  return null;
}

function classifyHighRiskCiFile(file) {
  if (
    matchesAny(file, [
      /^scripts\/ci\/security_/,
      /^scripts\/ci\/finance_/,
      /^scripts\/ci\/state_idempotency_safety_check\.mjs$/,
    ])
  ) {
    return {
      fullReason: `${file} changes security/finance CI guardrail behavior`,
    };
  }
  return null;
}

function classifyPrCiToolFile(file) {
  if (
    matchesAny(file, [
      /^scripts\/ci\/pr_checks\.sh$/,
      /^scripts\/ci\/pr_local\.sh$/,
      /^scripts\/ci\/bootstrap_ci_tools\.sh$/,
      /^scripts\/ci\/ci_meta_checks\.sh$/,
      /^scripts\/ci\/resolve_pr_ci_scope(_package|_rules)?\.mjs$/,
      /^scripts\/ci\/resolve_pr_ci_scope\.test\.mjs$/,
    ])
  ) {
    return {
      commands: ["ci_meta_checks"],
      riskScopes: ["ci-meta"],
      reason: "PR CI resolver/runner change mapped to CI meta checks",
    };
  }
  return null;
}

function classifyWeeklyHygieneFile(file) {
  if (/^scripts\/ops\/weekly_hygiene\.mjs$/.test(file)) {
    return {
      commands: ["ci_meta_checks", "quality_budget_check", "docs_checks"],
      riskScopes: ["weekly-hygiene"],
      reason: "Weekly hygiene harness change mapped to hygiene/static checks",
    };
  }
  return null;
}

function classifyGcpBillingReviewFile(file) {
  if (
    matchesAny(file, [
      /^scripts\/ops\/gcp_billing_review(?:_[a-z0-9_]+)?\.mjs$/,
      /^scripts\/ops\/gcp_billing_review\.sh$/,
      /^scripts\/ops\/fixtures\/gcp_billing_review_fixture\.json$/,
    ])
  ) {
    return {
      commands: ["ci_meta_checks", "quality_budget_check", "docs_checks"],
      riskScopes: ["cost-review"],
      reason:
        "GCP billing review automation change mapped to cost/static checks",
    };
  }
  return null;
}

function classifyCleanupFile(file) {
  if (/^scripts\/git\/cleanup_old_branches\.sh$/.test(file)) {
    return {
      commands: ["ci_meta_checks", "docs_checks"],
      riskScopes: ["repo-hygiene"],
      reason: "Branch cleanup automation mapped to CI meta and docs checks",
    };
  }
  return null;
}

function classifyCiGateFile(file) {
  for (const [pattern, command, project] of CI_GATE_COMMANDS) {
    if (pattern.test(file)) {
      return {
        commands: ["ci_meta_checks", command],
        riskScopes: ["ci-gate"],
        project,
        needsUserFrontDeps: project === "user-front",
        needsAdminFrontDeps: project === "admin-front",
        reason: `${file} mapped to ${command} without full CI`,
      };
    }
  }
  return null;
}

function classifyGenericCiToolFile(file) {
  if (
    matchesAny(file, [
      /^scripts\/ci\/[a-z0-9_]+_check(\.test)?\.mjs$/,
      /^scripts\/ci\/[a-z0-9_]+_evidence_check(\.test)?\.mjs$/,
      /^scripts\/ci\/[a-z0-9_]+_scan(\.test)?\.mjs$/,
    ])
  ) {
    return {
      commands: ["ci_meta_checks"],
      riskScopes: ["ci-tool"],
      reason: `${file} mapped to CI meta checks without full CI`,
    };
  }
  return null;
}

function classifyGenericOpsFile(file) {
  if (matchesAny(file, [/^scripts\/ops\//, /^scripts\/git\//])) {
    return {
      commands: ["ci_meta_checks"],
      riskScopes: ["ops-automation"],
      reason: `${file} mapped to CI meta checks as ops automation`,
    };
  }
  return null;
}

function classifyLocalInfraFile(file) {
  if (matchesAny(file, [/^infra\/docker\//, /^infra\/postgres\//])) {
    return {
      commands: ["local_runtime_guard_scan", "docs_checks"],
      riskScopes: ["local-infra"],
      reason: `${file} mapped to local runtime and docs checks`,
    };
  }
  return null;
}

const CI_TOOL_CLASSIFIERS = [
  classifyWorkflowFile,
  classifyHighRiskCiFile,
  classifyPrCiToolFile,
  classifyWeeklyHygieneFile,
  classifyGcpBillingReviewFile,
  classifyCleanupFile,
  classifyCiGateFile,
  classifyGenericCiToolFile,
  classifyGenericOpsFile,
  classifyLocalInfraFile,
];

export function classifyCiToolFile(file) {
  for (const classifier of CI_TOOL_CLASSIFIERS) {
    const result = classifier(file);
    if (result) return result;
  }

  return null;
}
