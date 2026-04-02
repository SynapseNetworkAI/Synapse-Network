import type { OperationsOverview, SystemStatus } from "@/services/admin-api";

export function getRuntimeTone(status: string): "green" | "orange" | "red" | "gray" {
  const normalized = status.toLowerCase();
  if (normalized.includes("alert") || normalized.includes("lagging")) {
    return "orange";
  }
  if (normalized.includes("healthy") || normalized.includes("active") || normalized.includes("nominal")) {
    return "green";
  }
  if (normalized.includes("degraded") || normalized.includes("warning") || normalized.includes("lag")) {
    return "orange";
  }
  if (normalized.includes("failed") || normalized.includes("error") || normalized.includes("down") || normalized.includes("stopped")) {
    return "red";
  }
  return "gray";
}

export function buildSystemMetrics(status: SystemStatus, operations: OperationsOverview) {
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
  const indexerErrorDetail = operations.indexerLastError ? `; error ${operations.indexerLastError}` : "";
  const backfillErrorDetail = operations.backfillLastError ? `; error ${operations.backfillLastError}` : "";
  let reconciliationTailDetail = "";
  if (operations.reconciliationLastError) {
    reconciliationTailDetail = `; error ${operations.reconciliationLastError}`;
  } else if (operations.reconciliationAlert) {
    reconciliationTailDetail = "; alert open";
  }

  return [
    {
      key: "indexer",
      label: "Indexer task",
      value: operations.indexerStatus,
      description: `running ${operations.indexerRunning ? "yes" : "no"}; heartbeat ${operations.indexerLastHeartbeatAt ?? "n/a"}; last processed ${operations.indexerLastProcessedAt ?? "n/a"}${indexerErrorDetail}`,
      format: "text" as const,
    },
    {
      key: "backfill-scan",
      label: "Backfill task",
      value: operations.backfillStatus,
      description: `enabled ${operations.backfillEnabled ? "yes" : "no"}; last scan ${operations.backfillLastScanAt ?? "n/a"}; block ${operations.backfillLastScannedBlock ?? "n/a"}; recovered ${operations.backfillLastRecovered}${backfillErrorDetail}`,
      format: "text" as const,
    },
    {
      key: "reconciliation",
      label: "Reconciliation task",
      value: operations.reconciliationStatus,
      description: `enabled ${operations.reconciliationEnabled ? "yes" : "no"}; last check ${operations.lastReconciliationAt ?? "n/a"}; delta ${operations.reconciliationDeltaUsdc} USDC${reconciliationTailDetail}`,
      format: "text" as const,
    },
    {
      key: "projection",
      label: "Projection updated",
      value: operations.projectedAt ?? "n/a",
      description: "运维读模型最近一次刷新时间，用于交叉验证持久化任务状态和聚合计数。",
      format: "datetime" as const,
    },
  ];
}
