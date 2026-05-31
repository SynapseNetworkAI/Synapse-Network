import { describe, expect, it } from "vitest";

import { resolveDashboardSnapshotSettled } from "./use-dashboard-snapshot";

describe("resolveDashboardSnapshotSettled", () => {
  it("suppresses the global banner when at least one dashboard source succeeds", () => {
    const result = resolveDashboardSnapshotSettled([
      {
        status: "fulfilled",
        value: {
          metrics: {
            pendingApprovals: 0,
            depositExceptions: 0,
            auditAlerts: 0,
            vaultLedgerDelta: "0.00",
          },
          highlights: [],
        },
      },
      { status: "rejected", reason: new Error("system status unavailable") },
      { status: "rejected", reason: new Error("finance unavailable") },
      { status: "rejected", reason: new Error("operations unavailable") },
      { status: "rejected", reason: new Error("reconciliation unavailable") },
      { status: "fulfilled", value: { items: [] } },
    ]);

    expect(result.overview?.metrics.pendingApprovals).toBe(0);
    expect(result.approvals).toEqual([]);
    expect(result.error).toBeNull();
  });

  it("surfaces the first failure when every dashboard source fails", () => {
    const result = resolveDashboardSnapshotSettled([
      { status: "rejected", reason: new Error("overview unavailable") },
      { status: "rejected", reason: new Error("system status unavailable") },
      { status: "rejected", reason: new Error("finance unavailable") },
      { status: "rejected", reason: new Error("operations unavailable") },
      { status: "rejected", reason: new Error("reconciliation unavailable") },
      { status: "rejected", reason: new Error("approvals unavailable") },
    ]);

    expect(result.overview).toBeNull();
    expect(result.systemStatus).toBeNull();
    expect(result.financeOverview).toBeNull();
    expect(result.operationsOverview).toBeNull();
    expect(result.reconciliationDetail).toBeNull();
    expect(result.approvals).toEqual([]);
    expect(result.error).toBe("overview unavailable");
  });
});
