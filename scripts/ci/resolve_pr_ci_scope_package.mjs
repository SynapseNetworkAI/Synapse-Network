import { execFileSync } from "node:child_process";

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
  const raw = tryGit(["show", `${ref}:${path}`]);
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
    (name) => (beforeScripts || {})[name] !== (afterScripts || {})[name]
  );
}

function classifyScriptChange(scriptName, scriptValue) {
  if (
    scriptName === "ci:agent-lessons" &&
    /\bscripts\/ci\/agent_lessons_check\.mjs\b/.test(scriptValue)
  ) {
    return { riskScopes: ["agent-lessons"] };
  }

  if (
    GUARDRAIL_SCRIPTS.has(scriptName) ||
    /\bscripts\/ci\/(pr_checks|diff_coverage|finance_|security_|e2e_env_isolation|quality_budget|format_check|code_quality_|gateway_checks|admin_gateway_checks|frontend_checks|admin_front_checks)/.test(
      scriptValue
    )
  ) {
    return {
      fullReason: `package.json guardrail script changed: ${scriptName}`,
    };
  }

  if (
    /gcp-alerts|lark-alert|monitoring-alert/i.test(scriptName) ||
    /gcp_alerts|lark_alert|monitoring_alert/i.test(scriptValue)
  ) {
    return { commands: ["monitoring_alert_rules"], riskScopes: ["monitoring"] };
  }

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

  if (/^e2e:/.test(scriptName) || /^ci:.*evidence$/.test(scriptName)) {
    return {
      commands: ["e2e_script_model_drift_scan"],
      riskScopes: ["e2e-evidence"],
    };
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

export function classifyPackageJsonChange(mergeBase, head) {
  const before = jsonAt(mergeBase, "package.json");
  const after = jsonAt(head, "package.json");
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
      ", "
    )}`,
    needsRootNpmDeps: scopeResult.needsRootNpmDeps,
  };
}
