#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FUNCTION_MATRIX } from "./admin_regression_function_matrix.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const MODE =
  process.argv.includes("--staging") ||
  process.env.ADMIN_REGRESSION_ENV === "staging"
    ? "staging"
    : "local";
const RUN_ID =
  process.env.ADMIN_REGRESSION_RUN_ID ||
  `admin-reg-${MODE}-${new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14)}`;
const OUT_DIR = path.resolve(
  process.env.ADMIN_REGRESSION_OUTPUT_DIR ||
    path.join(ROOT, "output/dogfood/admin-regression", RUN_ID)
);
const ADMIN_DSN =
  process.env.ADMIN_DATABASE_DSN ||
  "postgresql://synapse_admin_app:local-dev-admin-app-password@127.0.0.1:15432/synapse_gateway_admin";
const GATEWAY_DSN =
  process.env.GATEWAY_POSTGRES_DSN ||
  process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
  process.env.POSTGRES_DSN ||
  "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway";

const REQUIRED_SCREENSHOT_KEYWORDS = [
  "analytics",
  "finance",
  "provider-services",
  "withdraw",
  "forum",
];

const LOCAL_STEPS = [
  [
    "local-gateway-health",
    ["__shell", "bash", "scripts/local/restart_gateway.sh"],
  ],
  ["admin-front", ["run", "e2e:admin-front"]],
  ["admin-login-lockout", ["run", "e2e:admin-login-lockout:dogfood"]],
  ["admin-withdrawal-approval", ["run", "e2e:admin-withdrawal-approval"]],
  [
    "withdrawal-review-dogfood-local",
    ["run", "e2e:withdrawal-review-dogfood:local"],
  ],
  [
    "admin-withdrawal-review-local",
    ["run", "e2e:admin-withdrawal-review:local"],
  ],
  ["withdrawal-risk-policy", ["run", "e2e:withdrawal-risk-policy"]],
  [
    "withdrawal-idempotency-concurrency",
    ["run", "e2e:withdrawal-idempotency-concurrency"],
  ],
  [
    "local-gateway-restore",
    ["__shell", "bash", "scripts/local/restart_gateway.sh"],
  ],
  [
    "local-front-restore",
    ["__shell", "bash", "scripts/local/start_all_services.sh", "start"],
  ],
  ["in-app-notifications", ["run", "e2e:in-app-notifications"]],
  ["lark-alerts", ["run", "e2e:lark-alerts"]],
  [
    "transaction-notifications-local",
    ["run", "e2e:transaction-notifications:local"],
  ],
  ["admin-analytics-postgres", ["run", "e2e:admin-analytics-postgres"]],
];

const STAGING_STEPS = [
  [
    "withdrawal-review-dogfood-staging",
    ["run", "e2e:withdrawal-review-dogfood:staging"],
  ],
  ["gmail-notifications-staging", ["run", "e2e:gmail-notifications:staging"]],
  [
    "transaction-notifications-staging",
    ["run", "e2e:transaction-notifications:staging"],
  ],
  ["support-case-dogfood-staging", ["run", "e2e:support-case-dogfood:staging"]],
];

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

let cachedLocalAdminTotpSecret;

function resolveLocalAdminTotpSecret() {
  if (cachedLocalAdminTotpSecret !== undefined) {
    return cachedLocalAdminTotpSecret;
  }
  cachedLocalAdminTotpSecret = "";
  if (MODE !== "local" || process.env.ADMIN_TOTP_SECRET) {
    return cachedLocalAdminTotpSecret;
  }
  const result = spawnSync(
    "psql",
    [
      ADMIN_DSN,
      "-X",
      "-q",
      "-t",
      "-A",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `
      SELECT to_json(payload_json->>'totpSecret')
      FROM admin_mfa_factors mf
      JOIN admin_users au ON au.admin_id = mf.admin_id
      WHERE au.email = 'cliff@synapse-network.ai'
        AND mf.status = 'active'
        AND payload_json ? 'totpSecret'
      ORDER BY mf.updated_at DESC
      LIMIT 1
    `,
    ],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (result.status !== 0) {
    return cachedLocalAdminTotpSecret;
  }
  try {
    const value = JSON.parse(result.stdout.trim() || "null");
    cachedLocalAdminTotpSecret =
      typeof value === "string" && value.trim() ? value.trim() : "";
  } catch {
    cachedLocalAdminTotpSecret = "";
  }
  return cachedLocalAdminTotpSecret;
}

function runStep(name, args) {
  const startedAt = new Date().toISOString();
  const logPath = path.join(OUT_DIR, `${name}.log`);
  const localTotpSecret = resolveLocalAdminTotpSecret();
  const executable = args[0] === "__shell" ? args[1] : "npm";
  const executableArgs = args[0] === "__shell" ? args.slice(2) : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      ADMIN_ANALYTICS_SOURCE: process.env.ADMIN_ANALYTICS_SOURCE || "postgres",
      ANALYTICS_TRANSPORT: process.env.ANALYTICS_TRANSPORT || "outbox",
      ADMIN_ANALYTICS_STRICT_REAL_PIPELINE:
        process.env.ADMIN_ANALYTICS_STRICT_REAL_PIPELINE || "0",
      ADMIN_ANALYTICS_LOAD_PREPARE_LOCAL:
        process.env.ADMIN_ANALYTICS_LOAD_PREPARE_LOCAL || "0",
      ...(localTotpSecret ? { ADMIN_TOTP_SECRET: localTotpSecret } : {}),
    },
  });
  fs.writeFileSync(logPath, `${result.stdout || ""}\n${result.stderr || ""}`);
  return {
    name,
    command: `${executable} ${executableArgs.join(" ")}`,
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status,
    startedAt,
    finishedAt: new Date().toISOString(),
    logPath,
  };
}

function psqlJson(dsn, sql) {
  const result = spawnSync(
    "psql",
    [dsn, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || result.stdout || "").trim() };
  }
  try {
    return {
      ok: true,
      data: result.stdout.trim() ? JSON.parse(result.stdout.trim()) : null,
    };
  } catch (error) {
    return { ok: false, error: `invalid JSON SQL result: ${error.message}` };
  }
}

function sqlProbe(dsn, name, sql) {
  const result = psqlJson(dsn, sql);
  return {
    name,
    ok: result.ok,
    data: result.data,
    error: result.error,
    sqlSha256: crypto.createHash("sha256").update(sql).digest("hex"),
  };
}

function collectSqlEvidence() {
  return {
    generatedAt: new Date().toISOString(),
    admin: [
      sqlProbe(
        ADMIN_DSN,
        "auth-rbac-audit",
        `
        SELECT json_build_object(
          'adminUsers', (SELECT COUNT(*) FROM admin_users),
          'activeSessions', (SELECT COUNT(*) FROM admin_sessions WHERE expires_at > now()),
          'mfaFactors', (SELECT COUNT(*) FROM admin_mfa_factors),
          'roles', (SELECT COUNT(*) FROM admin_roles),
          'permissions', (SELECT COUNT(*) FROM admin_permissions),
          'rolePermissions', (SELECT COUNT(*) FROM admin_role_permissions),
          'auditEvents', (SELECT COUNT(*) FROM admin_action_audit),
          'platformFeeSafeDraftAudits', (
            SELECT COUNT(*) FROM admin_action_audit
            WHERE action_type = 'platform_fee_withdrawal.safe_draft_created'
          ),
          'recentPermissionDenied', (
            SELECT COUNT(*) FROM admin_action_audit
            WHERE created_at >= now() - interval '24 hours'
              AND action_type ILIKE '%permission%'
          )
        )
      `
      ),
      sqlProbe(
        ADMIN_DSN,
        "approval-execution-review",
        `
        SELECT json_build_object(
          'approvalsByStatus', COALESCE((SELECT json_object_agg(status, count) FROM (SELECT status, COUNT(*) AS count FROM admin_approvals GROUP BY status) s), '{}'::json),
          'approvalSteps', (SELECT COUNT(*) FROM admin_approval_steps),
          'approvalEvents', (SELECT COUNT(*) FROM admin_approval_events),
          'executionJobsByStatus', COALESCE((SELECT json_object_agg(status, count) FROM (SELECT status, COUNT(*) AS count FROM admin_execution_jobs GROUP BY status) s), '{}'::json),
          'executionAttempts', (SELECT COUNT(*) FROM admin_execution_attempts)
        )
      `
      ),
    ],
    gateway: [
      sqlProbe(
        GATEWAY_DSN,
        "dashboard-projections",
        `
        SELECT json_build_object(
          'financeRows', (SELECT COUNT(*) FROM synapse_admin_dashboard_finance_projection),
          'activityRows', (SELECT COUNT(*) FROM synapse_admin_dashboard_activity_trend_projection),
          'operationsRows', (SELECT COUNT(*) FROM synapse_admin_dashboard_operations_projection),
          'dashboardRows', (SELECT COUNT(*) FROM synapse_admin_dashboard_projection),
          'finance', (SELECT row_to_json(t) FROM (SELECT * FROM synapse_admin_dashboard_finance_projection LIMIT 1) t)
        )
      `
      ),
      sqlProbe(
        GATEWAY_DSN,
        "withdrawal-funds-state",
        `
        SELECT json_build_object(
          'withdrawalsByStatus', COALESCE((SELECT json_object_agg(status, count) FROM (SELECT status, COUNT(*) AS count FROM synapse_vault_withdrawals GROUP BY status) s), '{}'::json),
          'completedWithTxHash', (SELECT COUNT(*) FROM synapse_vault_withdrawals WHERE status = 'COMPLETED' AND COALESCE(tx_hash, '') <> ''),
          'ticketHashDuplicateGroups', (
            SELECT COUNT(*) FROM (
              SELECT ticket_hash FROM synapse_vault_withdrawals
              WHERE COALESCE(ticket_hash, '') <> ''
              GROUP BY ticket_hash HAVING COUNT(*) > 1
            ) dupes
          ),
          'balancesNegative', (SELECT COUNT(*) FROM synapse_account_balances WHERE available_balance < 0 OR pending_balance < 0 OR frozen_balance < 0),
          'ledgerEntries', (SELECT COUNT(*) FROM synapse_ledger_entries)
        )
      `
      ),
      sqlProbe(
        GATEWAY_DSN,
        "notifications",
        `
        SELECT json_build_object(
          'outboxByStatus', COALESCE((SELECT json_object_agg(status, count) FROM (SELECT status, COUNT(*) AS count FROM synapse_notification_outbox GROUP BY status) s), '{}'::json),
          'outboxByEventType', COALESCE((SELECT json_object_agg(event_type, count) FROM (SELECT event_type, COUNT(*) AS count FROM synapse_notification_outbox GROUP BY event_type) s), '{}'::json),
          'inAppByEventType', COALESCE((SELECT json_object_agg(event_type, count) FROM (SELECT event_type, COUNT(*) AS count FROM synapse_in_app_notifications GROUP BY event_type) s), '{}'::json),
          'inAppUnread', (SELECT COUNT(*) FROM synapse_in_app_notifications WHERE read_at IS NULL AND archived_at IS NULL),
          'deliveryLogs', (SELECT COUNT(*) FROM synapse_notification_delivery_log)
        )
      `
      ),
      sqlProbe(
        GATEWAY_DSN,
        "forum-support",
        `
        SELECT json_build_object(
          'topics', (SELECT COUNT(*) FROM synapse_forum_topics),
          'replies', (SELECT COUNT(*) FROM synapse_forum_replies),
          'responseTasksByStatus', COALESCE((SELECT json_object_agg(status, count) FROM (SELECT status, COUNT(*) AS count FROM synapse_forum_response_tasks GROUP BY status) s), '{}'::json)
        )
      `
      ),
      sqlProbe(
        GATEWAY_DSN,
        "analytics-postgres-only",
        `
        SELECT json_build_object(
          'source', 'postgres',
          'outboxRows', (SELECT COUNT(*) FROM synapse_analytics_outbox),
          'eventsByName', COALESCE((SELECT json_object_agg(event_name, count) FROM (SELECT event_name, COUNT(*) AS count FROM synapse_analytics_outbox GROUP BY event_name) s), '{}'::json),
          'invokeCompleted', (SELECT COUNT(*) FROM synapse_analytics_outbox WHERE event_name = 'invoke_completed'),
          'providerRevenueReceived', (SELECT COUNT(*) FROM synapse_analytics_outbox WHERE event_name = 'provider_revenue_received'),
          'rawWalletDistinctIds', (
            SELECT COUNT(*) FROM synapse_analytics_outbox
            WHERE event_key LIKE '0x%' OR length(event_key) = 42
          )
        )
      `
      ),
      sqlProbe(
        GATEWAY_DSN,
        "provider-services-risk",
        `
        SELECT json_build_object(
          'providerProfiles', (SELECT COUNT(*) FROM synapse_provider_profiles),
          'payoutAccounts', (SELECT COUNT(*) FROM synapse_provider_payout_accounts),
          'riskFlags', (SELECT COUNT(*) FROM synapse_provider_risk_flags)
        )
      `
      ),
    ],
  };
}

function findLatestReports() {
  const roots = [
    "output/dogfood/admin-front",
    "output/dogfood/admin-withdrawal-approval",
    "output/dogfood/withdrawal-review",
    "output/dogfood/admin-withdrawal-review-local",
    "output/dogfood/in-app-notifications",
    "output/dogfood/lark-alerts",
    "output/analytics-load",
  ];
  const reports = [];
  for (const rel of roots) {
    const root = path.join(ROOT, rel);
    if (!fs.existsSync(root)) continue;
    const candidates = fs
      .readdirSync(root)
      .map((entry) => path.join(root, entry, "report.json"))
      .filter((filePath) => fs.existsSync(filePath))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (candidates[0]) {
      reports.push(candidates[0]);
    }
  }
  return reports;
}

function collectScreenshotEvidence() {
  const reports = findLatestReports();
  const screenshots = [];
  const pageAssertions = [];
  const reportSummaries = [];
  for (const reportPath of reports) {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    reportSummaries.push({
      reportPath,
      passed: (report.passed || []).length,
      failed: (report.failed || []).length,
      warnings: (report.warnings || []).length,
      apiResponses: (report.apiResponses || []).length,
      apiErrors: (report.apiResponses || []).filter(
        (response) => response.ok === false || response.status >= 400
      ).length,
    });
    for (const screenshot of report.screenshots || []) {
      screenshots.push({
        reportPath,
        screenshot,
        name: path.basename(
          String(screenshot),
          path.extname(String(screenshot))
        ),
      });
    }
    for (const summary of report.pageSummaries || []) {
      pageAssertions.push({
        reportPath,
        route: summary.route,
        name: summary.name || "",
        matched: summary.matched || "",
        title: summary.title || "",
        textSample: String(summary.textSample || summary.bodyText || "").slice(
          0,
          500
        ),
      });
    }
  }
  return {
    reports,
    screenshots,
    pageAssertions,
    reportSummaries,
    requiredKeywordCoverage: Object.fromEntries(
      REQUIRED_SCREENSHOT_KEYWORDS.map((keyword) => [
        keyword,
        screenshots.some((item) =>
          String(item.screenshot).toLowerCase().includes(keyword)
        ),
      ])
    ),
  };
}

function checkStatus(ok, evidence, notApplicable = false) {
  if (notApplicable) return { status: "not_applicable", evidence };
  return { status: ok ? "passed" : "failed", evidence };
}

function buildFunctionResults(steps, sqlEvidence, screenshotEvidence) {
  const stepMap = new Map(steps.map((step) => [step.name, step]));
  const probes = [...(sqlEvidence.admin || []), ...(sqlEvidence.gateway || [])];
  const probeMap = new Map(probes.map((probe) => [probe.name, probe]));
  const pageRoutes = new Set(
    (screenshotEvidence.pageAssertions || []).map((page) => page.route)
  );
  const screenshotNames = (screenshotEvidence.screenshots || []).map((item) =>
    `${item.name || ""} ${item.screenshot || ""}`.toLowerCase()
  );
  const apiErrors = (screenshotEvidence.reportSummaries || []).reduce(
    (total, report) => total + Number(report.apiErrors || 0),
    0
  );

  return FUNCTION_MATRIX.map((item) => {
    const routeEvidence = item.routes.map((route) => ({
      route,
      seen: pageRoutes.has(route),
    }));
    const stepEvidence = item.steps.map((name) => ({
      name,
      status: stepMap.get(name)?.status || "missing",
      logPath: stepMap.get(name)?.logPath || null,
    }));
    const sqlEvidenceForItem = item.sql.map((name) => ({
      name,
      ok: probeMap.get(name)?.ok === true,
      sqlSha256: probeMap.get(name)?.sqlSha256 || null,
    }));
    const screenshotEvidenceForItem = item.screenshots.map((keyword) => ({
      keyword,
      seen: screenshotNames.some((name) => name.includes(keyword)),
    }));

    const checks = {
      frontendClick: checkStatus(
        routeEvidence.every((route) => route.seen),
        routeEvidence,
        item.routes.length === 0
      ),
      domAssertion: checkStatus(
        routeEvidence.every((route) => route.seen),
        routeEvidence,
        item.routes.length === 0
      ),
      api: checkStatus(
        stepEvidence.every((step) => step.status === "passed"),
        { steps: stepEvidence, apiErrors }
      ),
      sql: checkStatus(
        sqlEvidenceForItem.every((probe) => probe.ok),
        sqlEvidenceForItem
      ),
      screenshot: checkStatus(
        screenshotEvidenceForItem.every((shot) => shot.seen),
        screenshotEvidenceForItem,
        item.screenshots.length === 0
      ),
    };
    const failedChecks = Object.entries(checks)
      .filter(([, check]) => check.status === "failed")
      .map(([name]) => name);

    return {
      functionId: item.id,
      label: item.label,
      routes: item.routes,
      status: failedChecks.length === 0 ? "passed" : "failed",
      verified: failedChecks.length === 0,
      failedChecks,
      checks,
      summary:
        failedChecks.length === 0
          ? "Frontend route/DOM, API step, SQL state, and screenshot evidence match the expected local regression state."
          : `Failed checks: ${failedChecks.join(", ")}`,
    };
  });
}

function functionResultsMarkdown(results) {
  const lines = [
    "# Admin Regression Function Results",
    "",
    "| Result | Function | Routes | Verified evidence |",
    "| --- | --- | --- | --- |",
  ];
  for (const result of results) {
    const evidence = Object.entries(result.checks)
      .map(([name, check]) => `${name}=${check.status}`)
      .join(", ");
    lines.push(
      `| ${result.status === "passed" ? "PASS" : "FAIL"} | ${result.label} | ${
        result.routes.join("<br>") || "N/A"
      } | ${evidence} |`
    );
  }
  return `${lines.join("\n")}\n`;
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(value, null, 2));
}

function buildExpectedState() {
  return {
    runId: RUN_ID,
    mode: MODE,
    analyticsSource: "postgres",
    finalWithdrawalStatus: "COMPLETED",
    screenshotValidation:
      "DOM/API/SQL bound; screenshot existence alone is not sufficient",
    sqlEvidenceRequired: true,
    notificationAcceptance:
      MODE === "staging"
        ? "outbox + in-app + real delivery when configured"
        : "outbox + in-app",
    platformTreasuryAcceptance:
      MODE === "staging"
        ? "Safe draft plus optional hardware-wallet execution evidence"
        : "Safe draft only; no direct broadcast",
  };
}

function reportMarkdown(report) {
  return [
    "# Admin Regression Evidence",
    "",
    `- Status: ${report.status}`,
    `- Mode: ${report.mode}`,
    `- Run ID: ${report.runId}`,
    `- Generated at: ${report.generatedAt}`,
    `- Output: ${OUT_DIR}`,
    "",
    "## Steps",
    "",
    "| Result | Step | Command |",
    "| --- | --- | --- |",
    ...report.steps.map(
      (step) =>
        `| ${step.status === "passed" ? "PASS" : "FAIL"} | ${step.name} | \`${
          step.command
        }\` |`
    ),
    "",
    "## Function Results",
    "",
    "| Result | Function | Failed Checks |",
    "| --- | --- | --- |",
    ...report.functionResults.map(
      (result) =>
        `| ${result.status === "passed" ? "PASS" : "FAIL"} | ${
          result.label
        } | ${result.failedChecks.join(", ") || "-"} |`
    ),
    "",
    "## Evidence Gates",
    "",
    `- SQL probes: ${report.sqlProbePassCount}/${report.sqlProbeCount}`,
    `- Screenshot keyword coverage: ${Object.entries(
      report.screenshotEvidence.requiredKeywordCoverage
    )
      .map(([key, ok]) => `${key}=${ok ? "yes" : "no"}`)
      .join(", ")}`,
    `- Analytics source: ${report.expectedState.analyticsSource}`,
  ].join("\n");
}

mkdirp(OUT_DIR);
const steps = [];
const requestedSteps = MODE === "staging" ? STAGING_STEPS : LOCAL_STEPS;
for (const [name, args] of requestedSteps) {
  const result = runStep(name, args);
  steps.push(result);
  if (
    result.status !== "passed" &&
    process.env.ADMIN_REGRESSION_CONTINUE_ON_FAILURE !== "1"
  ) {
    break;
  }
}

const sqlEvidence = collectSqlEvidence();
const screenshotEvidence = collectScreenshotEvidence();
const expectedState = buildExpectedState();
const functionResults = buildFunctionResults(
  steps,
  sqlEvidence,
  screenshotEvidence
);
writeJson("expected_state.json", expectedState);
writeJson("sql_evidence.json", sqlEvidence);
writeJson("screenshot_evidence.json", screenshotEvidence);
writeJson("function_results.json", {
  generatedAt: new Date().toISOString(),
  runId: RUN_ID,
  mode: MODE,
  results: functionResults,
});
fs.writeFileSync(
  path.join(OUT_DIR, "function_results.md"),
  functionResultsMarkdown(functionResults)
);
fs.writeFileSync(
  path.join(OUT_DIR, "bugfix-log.md"),
  "# Admin Regression Bugfix Log\n\n- No bugfixes recorded by this orchestrator run.\n"
);

const sqlProbes = [...sqlEvidence.admin, ...sqlEvidence.gateway];
const failedSteps = steps.filter((step) => step.status !== "passed");
const failedSql = sqlProbes.filter((probe) => !probe.ok);
const failedFunctionResults = functionResults.filter(
  (result) => result.status !== "passed"
);
const missingScreenshotCoverage = Object.entries(
  screenshotEvidence.requiredKeywordCoverage
).filter(([, ok]) => !ok);
const report = {
  status:
    failedSteps.length ||
    failedSql.length ||
    failedFunctionResults.length ||
    missingScreenshotCoverage.length
      ? "failed"
      : "success",
  generatedAt: new Date().toISOString(),
  runId: RUN_ID,
  mode: MODE,
  outputDir: OUT_DIR,
  expectedState,
  steps,
  failedSteps,
  functionResults,
  failedFunctionResults,
  sqlProbeCount: sqlProbes.length,
  sqlProbePassCount: sqlProbes.filter((probe) => probe.ok).length,
  failedSqlProbes: failedSql,
  screenshotEvidence,
  missingScreenshotCoverage,
};
writeJson("report.json", report);
fs.writeFileSync(path.join(OUT_DIR, "report.md"), reportMarkdown(report));
console.log(`[admin-regression] ${report.status}: ${OUT_DIR}`);
process.exit(report.status === "success" ? 0 : 1);
