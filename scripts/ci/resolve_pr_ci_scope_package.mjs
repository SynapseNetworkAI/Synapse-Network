import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const GUARDRAIL_SCRIPTS = new Set([
  "ci:pr",
  "ci:financial-security",
  "ci:finance-approval-safety",
  "ci:architecture-quality",
  "ci:quality-budget",
  "ci:format-check",
  "ci:agent-guardrails",
  "ci:diff-coverage",
  "ci:gateway",
  "ci:admin-gateway",
  "ci:frontend",
  "ci:admin-front",
  "ci:contracts",
  "ci:provider-service",
  "ci:sdk-python",
  "ci:docs",
  "ci:github-actions-runtime",
  "ci:e2e-env-isolation",
  "ci:release-go-no-go",
  "ci:performance-reliability",
  "ci:gateway-stress-review",
]);

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

function jsonAt(ref, path) {
  const raw =
    ref === "WORKTREE"
      ? readFileSync(path, "utf8")
      : tryGit(["show", `${ref}:${path}`]);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepEqual(left, right) {
  return stableJson(left) === stableJson(right);
}

function changedScriptNames(beforeScripts, afterScripts) {
  const names = unique([
    ...Object.keys(beforeScripts || {}),
    ...Object.keys(afterScripts || {}),
  ]).sort();
  return names.filter(
    (name) => (beforeScripts || {})[name] !== (afterScripts || {})[name],
  );
}

function classifyAgentLessonScript(scriptName, scriptValue) {
  if (
    scriptName === "ci:agent-lessons" &&
    /\bscripts\/ci\/agent_lessons_check\.mjs\b/.test(scriptValue)
  ) {
    return { riskScopes: ["agent-lessons"] };
  }
  return null;
}

function classifyPrLocalScript(scriptName, scriptValue) {
  if (
    /^ci:pr:(local|fast|full)$/.test(scriptName) &&
    /\bscripts\/ci\/pr_local\.sh\b/.test(scriptValue)
  ) {
    return { commands: ["ci_meta_checks"], riskScopes: ["ci-meta"] };
  }
  return null;
}

function classifyGuardrailScript(scriptName, scriptValue) {
  if (
    GUARDRAIL_SCRIPTS.has(scriptName) ||
    /\bscripts\/ci\/(pr_checks|diff_coverage|finance_|security_|e2e_env_isolation|quality_budget|format_check|code_quality_|gateway_checks|admin_gateway_checks|frontend_checks|admin_front_checks)/.test(
      scriptValue,
    )
  ) {
    return {
      fullReason: `package.json guardrail script changed: ${scriptName}`,
    };
  }
  return null;
}

function classifyMonitoringScript(scriptName, scriptValue) {
  if (
    /gcp-alerts|lark-alert|monitoring-alert/i.test(scriptName) ||
    /gcp_alerts|lark_alert|monitoring_alert/i.test(scriptValue)
  ) {
    return { commands: ["monitoring_alert_rules"], riskScopes: ["monitoring"] };
  }
  return null;
}

function classifyGcpCostScript(scriptName, scriptValue) {
  if (
    scriptName === "ci:gcp-gross-cost-audit" &&
    /\bscripts\/ops\/gcp_gross_cost_audit\.mjs\b/.test(scriptValue)
  ) {
    return {
      commands: ["ci_meta_checks", "quality_budget_check", "docs_checks"],
      riskScopes: ["gcp-cost-audit"],
    };
  }
  return null;
}

function classifyWeeklyHygieneScript(scriptName, scriptValue) {
  if (
    /^weekly:hygiene$/.test(scriptName) &&
    /\bscripts\/ops\/weekly_hygiene\.mjs\b/.test(scriptValue)
  ) {
    return {
      commands: ["ci_meta_checks", "quality_budget_check", "docs_checks"],
      riskScopes: ["weekly-hygiene"],
    };
  }

  if (
    /^ci:weekly-hygiene-evidence$/.test(scriptName) &&
    /\bscripts\/ci\/weekly_hygiene_evidence_check\.mjs\b/.test(scriptValue)
  ) {
    return {
      commands: ["ci_meta_checks", "quality_budget_check", "docs_checks"],
      riskScopes: ["weekly-hygiene"],
    };
  }

  return null;
}

function classifyDocsPublicScript(scriptName, scriptValue) {
  if (
    scriptName === "ci:ai-visibility-assets" &&
    /\bscripts\/ci\/ai_visibility_assets_check\.mjs\b/.test(scriptValue)
  ) {
    return {
      commands: ["ci_meta_checks", "quality_budget_check", "docs_checks"],
      riskScopes: ["ai-visibility-assets"],
    };
  }

  if (
    scriptName === "docs:sync-public-mirror" &&
    /\bscripts\/tools\/sync_public_docs_mirror\.mjs\b/.test(scriptValue)
  ) {
    return {
      commands: ["docs_checks"],
      riskScopes: ["docs-public-mirror"],
    };
  }

  if (
    /^(e2e:prod-public-docs-links|ci:prod-public-docs-links-evidence)$/.test(
      scriptName,
    ) &&
    /prod_public_docs_links_(e2e|evidence_check)\.mjs\b/.test(scriptValue)
  ) {
    return {
      commands: ["docs_checks", "e2e_script_model_drift_scan"],
      riskScopes: ["docs-public-links"],
    };
  }

  return null;
}

function classifyContractScript(scriptName, scriptValue) {
  if (
    /contract|arbitrum|hardhat|arb-sepolia/i.test(scriptName) ||
    /\b(hardhat|scripts\/chain)\b/.test(scriptValue)
  ) {
    return {
      commands: ["contracts_checks"],
      riskScopes: ["chain-contracts"],
      needsRootNpmDeps: true,
    };
  }
  return null;
}

function classifyE2eScript(scriptName) {
  if (/^e2e:/.test(scriptName) || /^ci:.*evidence$/.test(scriptName)) {
    return {
      commands: ["e2e_script_model_drift_scan"],
      riskScopes: ["e2e-evidence"],
    };
  }
  return null;
}

function classifyLocalDevScript(scriptName) {
  if (/^dev:/.test(scriptName) || /^local:/.test(scriptName)) {
    return {
      commands: ["local_runtime_guard_scan"],
      riskScopes: ["local-dev"],
    };
  }
  return null;
}

const SCRIPT_CLASSIFIERS = [
  classifyAgentLessonScript,
  classifyPrLocalScript,
  classifyWeeklyHygieneScript,
  classifyGcpCostScript,
  classifyDocsPublicScript,
  classifyMonitoringScript,
  classifyContractScript,
  classifyE2eScript,
  classifyLocalDevScript,
  classifyGuardrailScript,
];

function classifyScriptChange(scriptName, scriptValue) {
  for (const classifier of SCRIPT_CLASSIFIERS) {
    const result = classifier(scriptName, scriptValue);
    if (result) return result;
  }
  return {
    fullReason: `package.json script changed without a narrow CI mapping: ${scriptName}`,
  };
}

function addScopeResult(target, result) {
  for (const command of result.commands || []) {
    target.commands.add(command);
  }
  for (const scope of result.riskScopes || []) {
    target.riskScopes.add(scope);
  }
  target.needsRootNpmDeps ||= Boolean(result.needsRootNpmDeps);
}

export function classifyPackageJsonChange(mergeBase, head, options = {}) {
  const before = jsonAt(mergeBase, "package.json");
  const after = jsonAt(
    options.preferWorkingTree ? "WORKTREE" : head,
    "package.json",
  );
  if (!before || !after) {
    return { fullReason: "package.json could not be parsed from both refs" };
  }

  const beforeWithoutScripts = { ...before };
  const afterWithoutScripts = { ...after };
  delete beforeWithoutScripts.scripts;
  delete afterWithoutScripts.scripts;
  if (!deepEqual(beforeWithoutScripts, afterWithoutScripts)) {
    return {
      fullReason: "package.json dependency or package metadata changed",
    };
  }

  const scripts = changedScriptNames(before.scripts || {}, after.scripts || {});
  if (scripts.length === 0) {
    return {
      commands: [],
      riskScopes: [],
      reason: "package.json changed without script/dependency changes",
    };
  }

  const scopeResult = {
    commands: new Set(),
    riskScopes: new Set(["package-scripts"]),
    needsRootNpmDeps: false,
  };

  for (const scriptName of scripts) {
    const scriptValue = String((after.scripts || {})[scriptName] || "");
    const scriptResult = classifyScriptChange(scriptName, scriptValue);
    if (scriptResult.fullReason) return scriptResult;
    addScopeResult(scopeResult, scriptResult);
  }

  return {
    commands: [...scopeResult.commands],
    riskScopes: [...scopeResult.riskScopes],
    reason: `package.json script-only change mapped narrowly: ${scripts.join(
      ", ",
    )}`,
    needsRootNpmDeps: scopeResult.needsRootNpmDeps,
  };
}

export { classifyScriptChange };
