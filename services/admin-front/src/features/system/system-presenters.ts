import type { OperationsOverview, SystemStatus } from "@/services/admin-api";

export function getRuntimeTone(
  status: string
): "green" | "orange" | "red" | "gray" {
  const normalized = status.toLowerCase();
  if (normalized.includes("alert") || normalized.includes("lagging")) {
    return "orange";
  }
  if (
    normalized.includes("healthy") ||
    normalized.includes("active") ||
    normalized.includes("nominal")
  ) {
    return "green";
  }
  if (
    normalized.includes("degraded") ||
    normalized.includes("warning") ||
    normalized.includes("lag")
  ) {
    return "orange";
  }
  if (
    normalized.includes("failed") ||
    normalized.includes("error") ||
    normalized.includes("down") ||
    normalized.includes("stopped")
  ) {
    return "red";
  }
  return "gray";
}

export function buildSystemMetrics(
  status: SystemStatus,
  operations: OperationsOverview
) {
  return {
    gatewayAdmin: status.gatewayAdmin,
    gateway: status.gateway,
    approvalQueueDepth: status.approvalQueueDepth,
    recentGatewayFailures: operations.recentGatewayFailures,
    recentAuditAlerts: operations.recentAuditAlerts,
    failedDepositCount: operations.failedDepositCount,
  };
}

export function buildRuntimeCards(operations: OperationsOverview) {
  return [
    buildIndexerCard(operations),
    buildBackfillCard(operations),
    buildReconciliationCard(operations),
    buildProjectionCard(operations),
  ];
}

function buildIndexerCard(operations: OperationsOverview) {
  return {
    key: "indexer",
    label: "Indexer task",
    value: operations.indexerStatus,
    description: `running ${yesNo(
      operations.indexerRunning
    )}; heartbeat ${fallback(
      operations.indexerLastHeartbeatAt
    )}; last processed ${fallback(
      operations.indexerLastProcessedAt
    )}${errorDetail(operations.indexerLastError)}`,
    format: "text" as const,
  };
}

function buildBackfillCard(operations: OperationsOverview) {
  return {
    key: "backfill-scan",
    label: "Backfill task",
    value: operations.backfillStatus,
    description: `enabled ${yesNo(
      operations.backfillEnabled
    )}; last scan ${fallback(operations.backfillLastScanAt)}; block ${fallback(
      operations.backfillLastScannedBlock
    )}; recovered ${operations.backfillLastRecovered}${errorDetail(
      operations.backfillLastError
    )}`,
    format: "text" as const,
  };
}

function buildReconciliationCard(operations: OperationsOverview) {
  return {
    key: "reconciliation",
    label: "Reconciliation task",
    value: operations.reconciliationStatus,
    description: `enabled ${yesNo(
      operations.reconciliationEnabled
    )}; last check ${fallback(operations.lastReconciliationAt)}; delta ${
      operations.reconciliationDeltaUsdc
    } USDC${reconciliationTailDetail(operations)}`,
    format: "text" as const,
  };
}

function buildProjectionCard(operations: OperationsOverview) {
  return {
    key: "projection",
    label: "Projection updated",
    value: operations.projectedAt ?? "n/a",
    description:
      "运维读模型最近一次刷新时间，用于交叉验证持久化任务状态和聚合计数。",
    format: "datetime" as const,
  };
}

function reconciliationTailDetail(operations: OperationsOverview): string {
  if (operations.reconciliationLastError) {
    return `; error ${operations.reconciliationLastError}`;
  }
  return operations.reconciliationAlert ? "; alert open" : "";
}

function errorDetail(error: string | null): string {
  return error ? `; error ${error}` : "";
}

function fallback(value: string | number | null): string | number {
  return value ?? "n/a";
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}
