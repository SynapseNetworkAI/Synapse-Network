#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = resolve(new URL("../..", import.meta.url).pathname);
const BASE_REF = process.env.QUALITY_BASE_REF || "origin/main";
const SCOPE = process.env.QUALITY_BUDGET_SCOPE || "changed";

const PRODUCTION_FILE_MAX = 500;
const TEST_FILE_MAX = 800;
const FUNCTION_LINE_MAX = 120;
const PYTHON_FUNCTION_LINE_MAX = 80;
const NESTING_MAX = 4;
const COMPLEXITY_MAX = 12;
const ARGUMENT_MAX = 8;

// Explicit legacy debt ledger. These caps are not targets; they are stop-loss
// limits so old large files cannot silently grow while refactors pay debt down.
const BASELINED_FILE_EFFECTIVE_LINES = new Map([
  ["scripts/admin_analytics_clickhouse_regression.py", 541],
  ["scripts/ci/resolve_pr_ci_scope.mjs", 506],
  ["scripts/ci/validate_docs.js", 662],
  ["scripts/e2e/admin_analytics_10k_fullchain.mjs", 1072],
  ["scripts/e2e/email_binding_dogfood.mjs", 1180],
  ["scripts/e2e/gateway_pull_health_dogfood.mjs", 1172],
  ["scripts/e2e/llm_deepseek_gateway_e2e.mjs", 810],
  ["scripts/e2e/staging_core_dogfood.mjs", 832],
  ["scripts/e2e/support_case_dogfood.mjs", 1251],
  ["scripts/e2e/transaction_notifications_e2e.mjs", 897],
  ["scripts/e2e/withdrawal_one_ticket_evidence.mjs", 939],
  ["scripts/e2e/withdrawal_review_dogfood.mjs", 1332],
  ["scripts/fullchain_browser_test.py", 535],
  ["scripts/fullchain_wallet_test.js", 753],
  ["scripts/perf/local_production_load_rehearsal.mjs", 1019],
  ["scripts/provider_fullchain_e2e.js", 557],
  ["scripts/ui/dogfood_forum_feedback.mjs", 535],
  ["scripts/ui/verify_user_front_pages.mjs", 1026],
  ["services/admin-front/src/app/forum-support/page.tsx", 635],
  ["services/admin-front/src/components/console-ui.tsx", 574],
  [
    "services/admin-front/src/features/dashboard/analytics-dashboard-screen.tsx",
    881,
  ],
  ["services/admin-front/src/services/admin-api.ts", 1504],
  ["services/gateway-admin/src/services/auth/service.py", 653],
  ["services/gateway-admin/src/services/dashboard/service.py", 599],
  ["services/gateway-admin/src/storage/admin_approval/postgres.py", 567],
  ["services/gateway-admin/src/storage/analytics/analytics_dashboard.py", 695],
  ["services/gateway-admin/src/storage/analytics/gateway_dashboard.py", 655],
  ["services/gateway-admin/src/storage/in_memory_store.py", 657],
  ["services/gateway-admin/tests/test_app.py", 2560],
  ["services/gateway/src/api/routers/services.py", 614],
  ["services/gateway/src/services/analytics/gateway_events.py", 588],
  ["services/gateway/src/services/owner/finance_refund_exec_mixin.py", 755],
  [
    "services/gateway/src/storage/postgres/repositories/balance_repository.py",
    530,
  ],
  [
    "services/gateway/src/storage/postgres/repositories/finance_atomic_voucher_mixin.py",
    513,
  ],
  [
    "services/gateway/src/storage/postgres/repositories/service_registry_query_mixin.py",
    501,
  ],
  ["services/gateway/src/storage/postgres/schema_contracts.py", 556],
  [
    "services/gateway/tests/unit/storage/test_postgres_repositories_unit.py",
    2016,
  ],
  ["services/gateway/tests/unit/test_finance_runtime_service_unit.py", 1147],
  ["services/gateway/tests/unit/test_forwarding_runtime_service_unit.py", 1599],
  ["services/gateway/tests/unit/test_notifications_outbox_unit.py", 829],
  ["services/user-front/src/app/about/page.tsx", 690],
  ["services/user-front/src/app/docs/api-reference/[id]/page.tsx", 622],
  ["services/user-front/src/app/docs/api-reference/endpoint-data.ts", 1719],
  ["services/user-front/src/app/docs/getting-started/provider/page.tsx", 528],
  ["services/user-front/src/app/forum/page.tsx", 517],
  [
    "services/user-front/src/components/dashboard-workspace/AccountSettingsPage.tsx",
    643,
  ],
  [
    "services/user-front/src/components/dashboard-workspace/DashboardAgentsWorkspacePage.tsx",
    583,
  ],
  [
    "services/user-front/src/components/dashboard-workspace/DashboardAgentsPage.tsx",
    1225,
  ],
  [
    "services/user-front/src/components/dashboard-workspace/DashboardCredentialsPage.tsx",
    511,
  ],
  [
    "services/user-front/src/components/dashboard-workspace/DashboardInvocationsContent.tsx",
    511,
  ],
  [
    "services/user-front/src/components/dashboard-workspace/OwnerCreditsPage.tsx",
    855,
  ],
  [
    "services/user-front/src/components/provider-workspace/ProviderServiceDeployPage.tsx",
    1742,
  ],
  [
    "services/user-front/src/components/provider-workspace/ProviderServicesPage.tsx",
    844,
  ],
  [
    "services/user-front/src/components/provider-workspace/ProviderSettlementsPage.tsx",
    866,
  ],
  [
    "services/user-front/src/components/provider-workspace/ProviderWithdrawPage.tsx",
    721,
  ],
  ["services/user-front/src/i18n/resources/en/docsPage.ts", 781],
  ["services/user-front/src/i18n/resources/zh/docsPage.ts", 737],
  ["services/user-front/src/i18n/schema.ts", 1876],
  ["services/user-front/src/utils/balanceApi.ts", 922],
  ["services/user-front/src/utils/serviceApi.ts", 701],
  ["services/user-front/src/utils/serviceStatus.ts", 863],
]);

const BASELINED_FUNCTION_FILES = new Set([
  "scripts/ci/resolve_pr_ci_scope.mjs",
  "scripts/ci/gateway_pull_health_dogfood_evidence_check.mjs",
  "scripts/ci/postgres_pool_leak_evidence_check.mjs",
  "services/gateway/src/storage/postgres/repositories/service_registry_query_mixin.py",
  "services/user-front/src/app/about/page.tsx",
  "services/user-front/src/app/docs/concepts/page.tsx",
  "services/user-front/src/app/docs/getting-started/consumer/page.tsx",
  "services/user-front/src/app/docs/getting-started/provider/page.tsx",
  "services/user-front/src/app/docs/sdk/python/page.tsx",
  "services/user-front/src/app/docs/sdk/typescript/page.tsx",
  "services/user-front/src/app/forum/page.tsx",
  "services/user-front/src/app/marketplace/page.tsx",
  "services/user-front/src/components/Navbar.tsx",
  "services/user-front/src/components/WalletAuthGuard.tsx",
  "services/user-front/src/components/dashboard-workspace/AccountSettingsPage.tsx",
  "services/user-front/src/components/dashboard-workspace/DashboardAgentsWorkspacePage.tsx",
  "services/user-front/src/components/dashboard-workspace/EmailVerificationCodeModal.tsx",
  "services/user-front/src/components/dashboard-workspace/agents/AgentsWorkspaceListPane.tsx",
  "services/user-front/src/components/provider-workspace/ProviderSellPage.tsx",
  "services/user-front/src/utils/serviceApi.ts",
  "services/user-front/src/utils/pricing.ts",
]);

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", options.quiet ? "ignore" : "pipe"],
  }).trim();
}

function tryGit(args) {
  try {
    return git(args, { quiet: true });
  } catch {
    return "";
  }
}

function unique(values) {
  return [...new Set(values)].sort();
}

function mergeBase() {
  return tryGit(["merge-base", BASE_REF, "HEAD"]) || "HEAD";
}

function changedFiles() {
  if (SCOPE === "full") {
    return git(["ls-files"]).split("\n").filter(Boolean);
  }
  const base = mergeBase();
  const tracked = tryGit(["diff", "--name-only", `${base}...HEAD`])
    .split("\n")
    .filter(Boolean);
  const staged = tryGit(["diff", "--cached", "--name-only"])
    .split("\n")
    .filter(Boolean);
  const unstaged = tryGit(["diff", "--name-only"]).split("\n").filter(Boolean);
  return unique([...tracked, ...staged, ...unstaged]);
}

function oldText(file) {
  const base = mergeBase();
  return tryGit(["show", `${base}:${file}`]);
}

function isCodeFile(file) {
  return /\.(py|ts|tsx|js|jsx|mjs|cjs)$/.test(file);
}

function isExempt(file) {
  return (
    file.startsWith("docs/") ||
    file.startsWith("infra/postgres/init/") ||
    file.includes("/generated/") ||
    file.includes(".generated.") ||
    file.endsWith("ABI.json") ||
    file.endsWith(".d.ts")
  );
}

function isTestLike(file) {
  return (
    /(^|\/)(tests?|__tests__|e2e|perf|drills)\//.test(file) ||
    /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file) ||
    /(^|\/)test_.*\.py$/.test(file) ||
    /_test\.py$/.test(file)
  );
}

function effectiveLines(text) {
  return text.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("#");
  }).length;
}

function lineBudget(file) {
  return (
    BASELINED_FILE_EFFECTIVE_LINES.get(file) ||
    (isTestLike(file) ? TEST_FILE_MAX : PRODUCTION_FILE_MAX)
  );
}

function stripStrings(line) {
  return line.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""');
}

function countOccurrences(text, regex) {
  return [...text.matchAll(regex)].length;
}

function nestingDepth(lines) {
  let depth = 0;
  let maxDepth = 0;
  for (const raw of lines) {
    const line = stripStrings(raw);
    if (/\b(if|for|while|switch|catch|try|else\s+if)\b/.test(line)) {
      maxDepth = Math.max(maxDepth, depth + 1);
    }
    depth += countOccurrences(line, /\{/g);
    depth -= countOccurrences(line, /\}/g);
    if (depth < 0) depth = 0;
  }
  return maxDepth;
}

function complexity(lines) {
  const text = lines.map(stripStrings).join("\n");
  return (
    1 +
    countOccurrences(text, /\b(if|for|while|case|catch)\b/g) +
    countOccurrences(text, /&&|\|\||\?/g)
  );
}

function argumentCount(signature) {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return 0;
  const args = match[1].trim();
  if (!args) return 0;
  return args.split(",").filter((item) => item.trim()).length;
}

function isJsLikeFunctionStart(line) {
  return (
    /\bfunction\s+[A-Za-z0-9_$]+\s*\(/.test(line) ||
    /\b(?:const|let|var)\s+[A-Z_a-z][A-Za-z0-9_$]*\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/.test(
      line
    ) ||
    /\b(?:const|let|var)\s+[A-Z_a-z][A-Za-z0-9_$]*\s*=\s*(?:async\s*)?[A-Za-z0-9_$]+\s*=>/.test(
      line
    )
  );
}

function collectBraceBody(lines, start) {
  let braceDepth =
    countOccurrences(lines[start], /\{/g) -
    countOccurrences(lines[start], /\}/g);
  let end = start;
  while (braceDepth > 0 && end + 1 < lines.length) {
    end += 1;
    braceDepth +=
      countOccurrences(lines[end], /\{/g) - countOccurrences(lines[end], /\}/g);
  }
  return { body: lines.slice(start, end + 1), end };
}

function scanJsLikeFunctions(file, text) {
  const lines = text.split(/\r?\n/);
  const findings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isJsLikeFunctionStart(line)) continue;

    const { body, end } = collectBraceBody(lines, index);
    const bodyLines = effectiveLines(body.join("\n"));
    const args = argumentCount(line);
    const current = {
      lines: bodyLines,
      nesting: nestingDepth(body),
      complexity: complexity(body),
      args,
    };
    findings.push(
      ...metricFindings(file, index + 1, current, FUNCTION_LINE_MAX)
    );
    index = end;
  }
  return findings;
}

function scanPythonFunctions(file, text) {
  const lines = text.split(/\r?\n/);
  const findings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const defMatch = line.match(
      /^(\s*)(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(/
    );
    if (!defMatch) continue;
    const indent = defMatch[1].length;
    let end = index + 1;
    while (end < lines.length) {
      const candidate = lines[end];
      if (candidate.trim() && candidate.search(/\S/) <= indent) break;
      end += 1;
    }
    const body = lines.slice(index, end);
    const current = {
      lines: effectiveLines(body.join("\n")),
      nesting: pythonNestingDepth(body),
      complexity: complexity(body),
      args: argumentCount(line),
    };
    findings.push(
      ...metricFindings(file, index + 1, current, PYTHON_FUNCTION_LINE_MAX)
    );
    index = end - 1;
  }
  return findings;
}

function pythonNestingDepth(lines) {
  let maxDepth = 0;
  const stack = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const indent = raw.search(/\S/);
    while (stack.length && indent <= stack[stack.length - 1]) stack.pop();
    if (/\b(if|for|while|try|except|with|match)\b.*:\s*$/.test(raw.trim())) {
      stack.push(indent);
      maxDepth = Math.max(maxDepth, stack.length);
    }
  }
  return maxDepth;
}

function metricFindings(file, line, metrics, lineMax) {
  const findings = [];
  if (metrics.lines > lineMax) {
    findings.push(
      `FATAL QUALITY-FUNCTION-LINES: ${file}:${line} has ${metrics.lines} effective lines; split it below ${lineMax}.`
    );
  }
  if (metrics.nesting > NESTING_MAX) {
    findings.push(
      `FATAL QUALITY-NESTING: ${file}:${line} has nesting depth ${metrics.nesting}; use guard clauses or state handlers.`
    );
  }
  if (metrics.complexity > COMPLEXITY_MAX) {
    findings.push(
      `FATAL QUALITY-COMPLEXITY: ${file}:${line} has complexity ${metrics.complexity}; extract smaller helpers.`
    );
  }
  if (metrics.args > ARGUMENT_MAX) {
    findings.push(
      `FATAL QUALITY-ARGS: ${file}:${line} has ${metrics.args} parameters; introduce a request/context object.`
    );
  }
  return findings;
}

function addedDisableLines() {
  const base = mergeBase();
  const diff = [
    tryGit(["diff", "-U0", `${base}...HEAD`, "--"]),
    tryGit(["diff", "--cached", "-U0", "--"]),
    tryGit(["diff", "-U0", "--"]),
  ].join("\n");
  const entries = [];
  let currentFile = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length);
      continue;
    }
    if (!currentFile || !line.startsWith("+") || line.startsWith("+++"))
      continue;
    const added = line.slice(1);
    const comment = commentPortion(added);
    if (
      /(eslint-disable|@ts-ignore|@ts-expect-error|type:\s*ignore|noqa|ruff:\s*noqa)/.test(
        comment
      )
    ) {
      entries.push({ file: currentFile, line: comment });
    }
  }
  return entries;
}

function commentPortion(line) {
  const stripped = stripStrings(line);
  const markers = ["//", "#", "/*"];
  const indexes = markers
    .map((marker) => stripped.indexOf(marker))
    .filter((index) => index >= 0);
  if (indexes.length === 0) return "";
  return line.slice(Math.min(...indexes));
}

function hasDisableReason(line) {
  return /(--|because|reason|WHY|why|:.*\S.*\s-\s|\s#\s\S+)/.test(line);
}

function currentFileHasDisableReason(file, addedLine) {
  const absolute = resolve(REPO_ROOT, file);
  if (!existsSync(absolute)) return false;
  const marker = addedLine.trim().replace(/\s+#.*$/, "");
  const lines = readFileSync(absolute, "utf8").split(/\r?\n/);
  if (
    lines.some((line) => {
      const comment = commentPortion(line).trim();
      return comment.startsWith(marker) && hasDisableReason(comment);
    })
  ) {
    return true;
  }

  const markerText = marker.replace(/^#\s*/, "");
  return lines.some((line) => {
    const comment = commentPortion(line).trim();
    return (
      comment.includes("quality-budget-disable-reason:") &&
      comment.includes(markerText) &&
      hasDisableReason(comment)
    );
  });
}

function scanFileBudget(file) {
  const findings = [];
  if (!isCodeFile(file) || isExempt(file)) return findings;
  const absolute = resolve(REPO_ROOT, file);
  if (!existsSync(absolute)) return findings;

  const text = readFileSync(absolute, "utf8");
  const lineCount = effectiveLines(text);
  const maxLines = lineBudget(file);
  if (lineCount > maxLines) {
    findings.push(
      `FATAL QUALITY-FILE-LINES: ${file} has ${lineCount} effective lines; budget is ${maxLines}. Split the file or lower the legacy baseline first.`
    );
  }
  if (isTestLike(file) || BASELINED_FUNCTION_FILES.has(file)) {
    return findings;
  }
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) {
    findings.push(...scanJsLikeFunctions(file, text));
  }
  if (/\.py$/.test(file)) {
    findings.push(...scanPythonFunctions(file, text));
  }
  return findings;
}

export function scanQualityBudget(files) {
  const findings = files.flatMap((file) => scanFileBudget(file));
  for (const entry of addedDisableLines()) {
    if (
      !hasDisableReason(entry.line) &&
      !currentFileHasDisableReason(entry.file, entry.line)
    ) {
      findings.push(
        `FATAL QUALITY-DISABLE-REASON: ${
          entry.file
        } adds '${entry.line.trim()}' without an inline reason.`
      );
    }
  }
  return findings;
}

export function testApi() {
  return {
    effectiveLines,
    commentPortion,
    hasDisableReason,
    scanJsLikeFunctions,
    scanPythonFunctions,
  };
}

function main() {
  const files = changedFiles();
  const findings = scanQualityBudget(files);
  if (findings.length > 0) {
    console.error(findings.join("\n"));
    process.exit(1);
  }
  console.log(`[quality-budget] passed ${files.length} changed file(s)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
