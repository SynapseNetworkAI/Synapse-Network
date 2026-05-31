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

export const narrowCiToolPatterns = [
  /^scripts\/ci\/agent_lessons_check(\.test)?\.mjs$/,
  /^scripts\/ci\/resolve_pr_ci_scope(\.test)?\.mjs$/,
  /^scripts\/ci\/resolve_pr_ci_scope_(package|rules)\.mjs$/,
];

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
  /^migrations\//,
  /^\.github\/instructions\//,
  /^\.github\/workflows\//,
  /^\.githooks\//,
  /^hardhat\.config\./,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^tsconfig/,
  /^ruff\.toml$/,
  /^\.jscpd\.json$/,
];

export function matchesAny(file, patterns) {
  return patterns.some((pattern) => pattern.test(file));
}

export function isDocsFile(file) {
  return matchesAny(file, docsPatterns);
}

export function isNarrowCiToolFile(file) {
  return matchesAny(file, narrowCiToolPatterns);
}

export function isFullTriggerFile(file) {
  return matchesAny(file, fullTriggerPatterns);
}

export function isKnownFile(file) {
  return matchesAny(file, knownPatterns);
}
