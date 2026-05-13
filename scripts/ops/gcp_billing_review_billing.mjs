import { existsSync, readFileSync } from "node:fs";

import {
  BlockedError,
  addUtcDays,
  ensureCommand,
  readTrimmedStdout,
  roundCurrency,
  roundPercent,
  runCommand,
  runJsonCommand,
  scoreExportTable,
  sqlStringLiteral,
  startOfUtcDay,
  sumBy,
  toDateOnly,
} from "./gcp_billing_review_common.mjs";

export function runPreflight({ fixturePath, env, defaultTimeoutMs }) {
  ensureRequiredCommands();

  if (!fixturePath) {
    verifyGithubAuth();
    verifyActiveGcloudAccount(defaultTimeoutMs);
  }

  const projectId = resolveProjectId(env, defaultTimeoutMs);
  if (!projectId || projectId === "(unset)") {
    throw new BlockedError("missing_gcloud_project");
  }

  return { projectId };
}

export function loadFixture(fixturePath, projectId) {
  if (!existsSync(fixturePath)) {
    throw new Error(`fixture file not found: ${fixturePath}`);
  }
  const payload = JSON.parse(readFileSync(fixturePath, "utf8"));
  if (!Array.isArray(payload.rows)) {
    throw new Error("fixture must contain a rows array");
  }
  return {
    exportTable: payload.exportTable ?? {
      projectId,
      datasetId: "fixture",
      tableId: fixturePath.split("/").at(-1),
    },
    rows: payload.rows.map(normalizeBillingRow),
  };
}

export function loadBillingDataset({
  projectId,
  env,
  windowDays,
  comparisonDays,
}) {
  const exportTable = discoverBillingExportTable({ projectId, env });
  if (!exportTable) {
    throw new BlockedError("missing_billing_export");
  }

  const tableFqn = `\`${exportTable.projectId}.${exportTable.datasetId}.${exportTable.tableId}\``;
  const sql = buildBillingQuery({
    tableFqn,
    projectId,
    lookbackDays: windowDays + comparisonDays,
  });

  const rows = runJsonCommand(
    "bq",
    ["query", "--use_legacy_sql=false", "--format=json", "--quiet", sql],
    {
      label: "bq billing export query",
      timeoutMs: 120000,
    }
  ).map(normalizeBillingRow);

  return { exportTable, rows };
}

export function summarizeBillingRows(
  rows,
  { now, windowDays, comparisonDays }
) {
  const todayUtc = startOfUtcDay(now);
  const recentStart = addUtcDays(todayUtc, -(windowDays - 1));
  const previousStart = addUtcDays(recentStart, -comparisonDays);
  const previousEnd = addUtcDays(recentStart, -1);

  const normalizedRows = rows
    .map(normalizeBillingRow)
    .filter((row) => row.usage_date);
  const recentRows = rowsInWindow(normalizedRows, recentStart, todayUtc);
  const previousRows = rowsInWindow(normalizedRows, previousStart, previousEnd);

  if (recentRows.length === 0) {
    return buildEmptySummary(recentStart, todayUtc);
  }

  const recentTotal = roundCurrency(sumBy(recentRows, (row) => row.net_cost));
  const previousTotal = roundCurrency(
    sumBy(previousRows, (row) => row.net_cost)
  );

  return {
    windowStart: toDateOnly(recentStart),
    windowEnd: toDateOnly(todayUtc),
    previousWindowStart: toDateOnly(previousStart),
    previousWindowEnd: toDateOnly(previousEnd),
    totalCost: recentTotal,
    previousTotalCost: previousTotal,
    serviceBreakdown: buildBreakdown({
      recentRows,
      previousRows,
      keyForRow: (row) => row.service_description,
      labelKey: "service",
      totalRecent: recentTotal,
    }),
    topSkuBreakdown: buildBreakdown({
      recentRows,
      previousRows,
      keyForRow: (row) =>
        `${row.service_description} :: ${row.sku_description}`,
      labelKey: "sku",
      totalRecent: recentTotal,
    }).slice(0, 10),
  };
}

function ensureRequiredCommands() {
  for (const command of ["gh", "gcloud", "bq", "jq", "node"]) {
    ensureCommand(command);
  }
}

function verifyGithubAuth() {
  runCommand("gh", ["auth", "status"], {
    label: "gh auth status",
    failMessage: "gh auth status failed",
    timeoutMs: 15000,
  });
}

function verifyActiveGcloudAccount(defaultTimeoutMs) {
  const authList = runJsonCommand("gcloud", ["auth", "list", "--format=json"], {
    label: "gcloud auth list",
    timeoutMs: Math.min(defaultTimeoutMs, 15000),
  });
  if (
    !Array.isArray(authList) ||
    !authList.some((entry) => entry.status === "ACTIVE")
  ) {
    throw new BlockedError("missing_active_gcloud_account");
  }
}

function resolveProjectId(env, defaultTimeoutMs) {
  return (
    env.GCP_PROJECT_ID ??
    readTrimmedStdout("gcloud", ["config", "get-value", "project"], {
      label: "gcloud config get-value project",
      failMessage: "unable to resolve current gcloud project",
      timeoutMs: Math.min(defaultTimeoutMs, 15000),
    })
  );
}

function discoverBillingExportTable({ projectId, env }) {
  const explicit = buildExplicitExportTable(projectId, env);
  if (explicit) {
    return explicit;
  }

  const datasets = listDatasets(projectId);
  const candidates = collectExportTableCandidates(projectId, datasets);
  return selectWinningExportTable(candidates);
}

function buildExplicitExportTable(projectId, env) {
  const exportProjectId = env.GCP_BILLING_EXPORT_PROJECT_ID ?? projectId;
  const datasetId = env.GCP_BILLING_EXPORT_DATASET;
  const tableId = env.GCP_BILLING_EXPORT_TABLE;
  if (!datasetId || !tableId) {
    return null;
  }
  return { projectId: exportProjectId, datasetId, tableId };
}

function listDatasets(projectId) {
  try {
    return runJsonCommand(
      "bq",
      ["ls", "--project_id", projectId, "--format=json", "--max_results=1000"],
      {
        label: "bq ls datasets",
        timeoutMs: 20000,
      }
    );
  } catch {
    return [];
  }
}

function collectExportTableCandidates(projectId, datasets) {
  const candidates = [];
  for (const dataset of datasets) {
    const datasetId = extractDatasetId(dataset);
    if (!datasetId) {
      continue;
    }
    for (const table of listTables(projectId, datasetId)) {
      const candidate = toExportTableCandidate(projectId, datasetId, table);
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

function extractDatasetId(dataset) {
  return (
    dataset?.datasetReference?.datasetId ?? dataset?.id?.split(":")?.[1] ?? null
  );
}

function listTables(projectId, datasetId) {
  try {
    return runJsonCommand(
      "bq",
      [
        "ls",
        "--project_id",
        projectId,
        "--format=json",
        "--max_results=1000",
        `${projectId}:${datasetId}`,
      ],
      {
        label: `bq ls ${datasetId}`,
        timeoutMs: 20000,
      }
    );
  } catch {
    return [];
  }
}

function toExportTableCandidate(projectId, datasetId, table) {
  const tableId = table?.tableReference?.tableId;
  const type = String(table?.type ?? "TABLE").toUpperCase();
  if (!tableId || type !== "TABLE" || !isBillingExportTable(tableId)) {
    return null;
  }
  return {
    projectId,
    datasetId,
    tableId,
    score: scoreExportTable(tableId),
  };
}

function isBillingExportTable(tableId) {
  return /(cloud_)?gcp?_?billing.*export|billing.*export/i.test(tableId);
}

function selectWinningExportTable(candidates) {
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort(
    (left, right) =>
      right.score - left.score || left.tableId.localeCompare(right.tableId)
  );
  const [winner] = candidates;
  return {
    projectId: winner.projectId,
    datasetId: winner.datasetId,
    tableId: winner.tableId,
  };
}

function buildBillingQuery({ tableFqn, projectId, lookbackDays }) {
  return `
WITH line_items AS (
  SELECT
    DATE(usage_start_time) AS usage_date,
    service.description AS service_description,
    sku.description AS sku_description,
    SUM(
      CAST(cost AS NUMERIC) +
      IFNULL(
        (SELECT SUM(CAST(c.amount AS NUMERIC)) FROM UNNEST(credits) AS c),
        0
      )
    ) AS net_cost
  FROM ${tableFqn}
  WHERE project.id = '${sqlStringLiteral(projectId)}'
    AND DATE(usage_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL ${lookbackDays} DAY)
  GROUP BY 1, 2, 3
)
SELECT
  CAST(usage_date AS STRING) AS usage_date,
  service_description,
  sku_description,
  CAST(net_cost AS FLOAT64) AS net_cost
FROM line_items
ORDER BY usage_date DESC, net_cost DESC
`;
}

function rowsInWindow(rows, start, end) {
  return rows.filter((row) => row.date >= start && row.date <= end);
}

function buildEmptySummary(windowStart, windowEnd) {
  return {
    windowStart: toDateOnly(windowStart),
    windowEnd: toDateOnly(windowEnd),
    totalCost: null,
    previousTotalCost: null,
    serviceBreakdown: [],
    topSkuBreakdown: [],
  };
}

function buildBreakdown({
  recentRows,
  previousRows,
  keyForRow,
  labelKey,
  totalRecent,
}) {
  const recentMap = accumulateByKey(recentRows, keyForRow);
  const previousMap = accumulateByKey(previousRows, keyForRow);
  const keys = new Set([...recentMap.keys(), ...previousMap.keys()]);

  return [...keys]
    .map((key) =>
      buildBreakdownRow({
        key,
        labelKey,
        totalRecent,
        recentMap,
        previousMap,
      })
    )
    .sort((left, right) => right.recentCost - left.recentCost);
}

function buildBreakdownRow({
  key,
  labelKey,
  totalRecent,
  recentMap,
  previousMap,
}) {
  const recentCost = roundCurrency(recentMap.get(key) ?? 0);
  const previousCost = roundCurrency(previousMap.get(key) ?? 0);
  return {
    [labelKey]: key,
    recentCost,
    previousCost,
    deltaCost: roundCurrency(recentCost - previousCost),
    sharePct:
      totalRecent > 0 ? roundPercent((recentCost / totalRecent) * 100) : 0,
  };
}

function accumulateByKey(rows, keyForRow) {
  const totals = new Map();
  for (const row of rows) {
    const key = keyForRow(row);
    totals.set(key, (totals.get(key) ?? 0) + row.net_cost);
  }
  return totals;
}

function normalizeBillingRow(row) {
  const usageDate = pickUsageDate(row);
  const serviceDescription = pickServiceDescription(row);
  const skuDescription = pickSkuDescription(row);
  const netCost = parseNetCost(row);

  return {
    usage_date: usageDate,
    service_description: serviceDescription,
    sku_description: skuDescription,
    net_cost: Number.isFinite(netCost) ? netCost : 0,
    date: usageDate ? new Date(`${usageDate}T00:00:00.000Z`) : null,
  };
}

function pickUsageDate(row) {
  return row.usage_date ?? row.usageDate;
}

function pickServiceDescription(row) {
  return row.service_description ?? row.serviceDescription ?? "Unknown service";
}

function pickSkuDescription(row) {
  return row.sku_description ?? row.skuDescription ?? "Unknown SKU";
}

function parseNetCost(row) {
  const rawCost = row.net_cost ?? row.netCost ?? "0";
  const parsed = Number.parseFloat(String(rawCost));
  return Number.isFinite(parsed) ? parsed : 0;
}
