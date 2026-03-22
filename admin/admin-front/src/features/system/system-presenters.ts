import type { OperationsOverview, SystemStatus } from "@/services/admin-api";

export function getRuntimeTone(status: string): "green" | "orange" | "red" | "gray" {
  const normalized = status.toLowerCase();
  if (normalized.includes("healthy") || normalized.includes("active") || normalized.includes("nominal")) {
    return "green";
  }
  if (normalized.includes("degraded") || normalized.includes("warning") || normalized.includes("lag")) {
    return "orange";
  }
  if (normalized.includes("failed") || normalized.includes("error") || normalized.includes("down")) {
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
  return [
    {
      key: "indexer",
      label: "Indexer last processed",
      value: operations.indexerLastProcessedAt ?? "n/a",
      description: "最近一次持久化索引位点",
      format: "datetime" as const,
    },
    {
      key: "backfill-scan",
      label: "Backfill last scan",
      value: operations.backfillLastScanAt ?? "n/a",
      description: "回填扫描的最后时间戳",
      format: "datetime" as const,
    },
    {
      key: "backfill-block",
      label: "Backfill block",
      value: String(operations.backfillLastScannedBlock ?? "n/a"),
      description: "最近一次扫过的链上区块",
      format: "text" as const,
    },
    {
      key: "reconciliation",
      label: "Last reconciliation",
      value: operations.lastReconciliationAt ?? "n/a",
      description: "账本对账投影最后更新时间",
      format: "datetime" as const,
    },
  ];
}
