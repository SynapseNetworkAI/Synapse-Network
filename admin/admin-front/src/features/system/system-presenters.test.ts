import { describe, expect, it } from "vitest";

import { buildRuntimeCards, buildSystemMetrics, getRuntimeTone } from "./system-presenters";

const status = {
  gatewayAdmin: "healthy",
  gateway: "degraded",
  approvalQueueDepth: 7,
  lastReconciliationAt: "2026-03-21T10:00:00Z",
};

const operations = {
  gatewayStatus: "healthy",
  indexerRunning: true,
  indexerStatus: "healthy",
  indexerLastProcessedAt: "2026-03-21T09:00:00Z",
  indexerLastHeartbeatAt: "2026-03-21T09:00:30Z",
  indexerLastError: null,
  indexerPollIntervalSec: 30,
  backfillEnabled: true,
  backfillStatus: "healthy",
  backfillLastScanAt: "2026-03-21T08:00:00Z",
  backfillLastScannedBlock: 123,
  backfillLastRecovered: 4,
  backfillLastError: null,
  recentGatewayFailures: 2,
  failedDepositCount: 1,
  recentAuditAlerts: 3,
  reconciliationEnabled: true,
  reconciliationStatus: "alert",
  lastReconciliationAt: "2026-03-21T10:00:00Z",
  reconciliationAlert: true,
  reconciliationDeltaUsdc: "12.00",
  reconciliationLastError: "delta mismatch",
  projectedAt: "2026-03-21T10:05:00Z",
};

describe("system-presenters", () => {
  it("maps runtime tones", () => {
    expect(getRuntimeTone("healthy")).toBe("green");
    expect(getRuntimeTone("degraded")).toBe("orange");
    expect(getRuntimeTone("failed")).toBe("red");
  });

  it("builds top-level system metrics", () => {
    expect(buildSystemMetrics(status, operations)).toEqual({
      gatewayAdmin: "healthy",
      gateway: "degraded",
      approvalQueueDepth: 7,
      recentGatewayFailures: 2,
      recentAuditAlerts: 3,
      failedDepositCount: 1,
    });
  });

  it("builds runtime cards with explicit format metadata", () => {
    expect(buildRuntimeCards(operations)).toEqual([
      {
        key: "indexer",
        label: "Indexer task",
        value: "healthy",
        description: "running yes; heartbeat 2026-03-21T09:00:30Z; last processed 2026-03-21T09:00:00Z",
        format: "text",
      },
      {
        key: "backfill-scan",
        label: "Backfill task",
        value: "healthy",
        description: "enabled yes; last scan 2026-03-21T08:00:00Z; block 123; recovered 4",
        format: "text",
      },
      {
        key: "reconciliation",
        label: "Reconciliation task",
        value: "alert",
        description: "enabled yes; last check 2026-03-21T10:00:00Z; delta 12.00 USDC; error delta mismatch",
        format: "text",
      },
      {
        key: "projection",
        label: "Projection updated",
        value: "2026-03-21T10:05:00Z",
        description: "运维读模型最近一次刷新时间，用于交叉验证持久化任务状态和聚合计数。",
        format: "datetime",
      },
    ]);
  });
});
