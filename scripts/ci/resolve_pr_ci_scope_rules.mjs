const CI_GATE_COMMANDS = [
  [/^scripts\/ci\/frontend_checks\.sh$/, "frontend_checks", "user-front"],
  [
    /^scripts\/ci\/admin_front_checks\.sh$/,
    "admin_front_checks",
    "admin-front",
  ],
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

function matchesAny(file, patterns) {
  return patterns.some((pattern) => pattern.test(file));
}

function classifyWorkflowFile(file) {
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)) {
    return {
      commands: ["github_actions_runtime_check", "ci_meta_checks"],
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
      /^scripts\/ci\/resolve_pr_ci_scope(_package|_rules)?\.mjs$/,
      /^scripts\/ci\/resolve_pr_ci_scope\.test\.mjs$/,
    ])
  ) {
    return {
      commands: ["github_actions_runtime_check", "ci_meta_checks"],
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

const CI_TOOL_CLASSIFIERS = [
  classifyWorkflowFile,
  classifyHighRiskCiFile,
  classifyPrCiToolFile,
  classifyWeeklyHygieneFile,
  classifyGcpBillingReviewFile,
  classifyCiGateFile,
  classifyGenericCiToolFile,
];

export function classifyCiToolFile(file) {
  for (const classifier of CI_TOOL_CLASSIFIERS) {
    const result = classifier(file);
    if (result) return result;
  }

  return null;
}
