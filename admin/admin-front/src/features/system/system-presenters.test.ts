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
  indexerLastProcessedAt: "2026-03-21T09:00:00Z",
  backfillLastScanAt: "2026-03-21T08:00:00Z",
  backfillLastScannedBlock: 123,
  recentGatewayFailures: 2,
  failedDepositCount: 1,
  recentAuditAlerts: 3,
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
        label: "Indexer last processed",
        value: "2026-03-21T09:00:00Z",
        description: "最近一次持久化索引位点",
        format: "datetime",
      },
      {
        key: "backfill-scan",
        label: "Backfill last scan",
        value: "2026-03-21T08:00:00Z",
        description: "回填扫描的最后时间戳",
        format: "datetime",
      },
      {
        key: "backfill-block",
        label: "Backfill block",
        value: "123",
        description: "最近一次扫过的链上区块",
        format: "text",
      },
      {
        key: "reconciliation",
        label: "Last reconciliation",
        value: "2026-03-21T10:00:00Z",
        description: "账本对账投影最后更新时间",
        format: "datetime",
      },
    ]);
  });
});
