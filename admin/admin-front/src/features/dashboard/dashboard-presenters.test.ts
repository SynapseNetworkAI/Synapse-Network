import { describe, expect, it } from "vitest";

import {
  buildCapitalSnapshotCards,
  buildSentinelMetrics,
  resolveProjectionNarrative,
  resolveReadModelTimestamp,
} from "./dashboard-presenters";

describe("dashboard presenters", () => {
  it("prefers backend highlight payloads for sentinel metrics", () => {
    const metrics = buildSentinelMetrics(
      {
        metrics: {
          pendingApprovals: 12,
          depositExceptions: 3,
          auditAlerts: 2,
          vaultLedgerDelta: "0.50",
        },
        highlights: [
          { title: "待执行审批队列", value: "12", trend: "monitor" },
          { title: "充值修复异常", value: "3", trend: "requires_attention" },
          { title: "审计告警", value: "2", trend: "requires_attention" },
        ],
      },
      {
        gatewayStatus: "degraded",
        indexerLastProcessedAt: null,
        backfillLastScanAt: null,
        backfillLastScannedBlock: null,
        recentGatewayFailures: 1,
        failedDepositCount: 2,
        recentAuditAlerts: 2,
        lastReconciliationAt: null,
        reconciliationAlert: true,
        reconciliationDeltaUsdc: "0.50",
        reconciliationLastError: "vault_delta_detected",
        projectedAt: null,
      },
    );

    expect(metrics[0]).toEqual({
      label: "SENTINEL 01",
      value: "待执行审批队列 12",
      meta: "读模型当前稳定，可以继续保持值班观察。",
    });
    expect(metrics[3]?.value).toContain("0.50 USDC");
    expect(metrics[3]?.meta).toBe("接入真实后端数据，支持下钻查看对账明细。");
    expect(metrics[3]?.href).toBe("/finance/reconciliation");
  });

  it("builds capital cards directly from finance payload", () => {
    const cards = buildCapitalSnapshotCards({
      todayChargeUsdc: "1280.40",
      todayDepositUsdc: "1640.00",
      todayRefundUsdc: "42.25",
      todayWithdrawalUsdc: "310.50",
      ownerLiabilityUsdc: "8450.10",
      providerPayableUsdc: "3920.45",
      platformFeeBalanceUsdc: "128.75",
      vaultLedgerDeltaUsdc: "0.50",
      pendingDepositCount: 2,
      pendingWithdrawalCount: 1,
      projectedAt: "2026-03-16T08:05:00Z",
    });

    expect(cards).toContainEqual({ label: "Owner liability", value: "8,450.10 USDC" });
    expect(cards).toContainEqual({ label: "Pending deposits", value: "2" });
    expect(cards).toContainEqual({ label: "Pending withdrawals", value: "1" });
  });

  it("does not fall back to local current time when projections are missing", () => {
    expect(resolveReadModelTimestamp(null, null, null)).toBe("projection pending");
  });

  it("renders a backend-driven projection narrative", () => {
    expect(resolveProjectionNarrative(
      {
        metrics: {
          pendingApprovals: 5,
          depositExceptions: 1,
          auditAlerts: 0,
          vaultLedgerDelta: "0.00",
        },
        highlights: [],
      },
      { points: [{ bucketDate: "2026-03-16", depositUsdc: "1", chargeUsdc: "1", refundUsdc: "0", withdrawalUsdc: "0", netFlowUsdc: "0" }] },
      {
        gatewayStatus: "healthy",
        indexerLastProcessedAt: null,
        backfillLastScanAt: null,
        backfillLastScannedBlock: null,
        recentGatewayFailures: 0,
        failedDepositCount: 0,
        recentAuditAlerts: 0,
        lastReconciliationAt: null,
        reconciliationAlert: false,
        reconciliationDeltaUsdc: "0.00",
        reconciliationLastError: null,
        projectedAt: null,
      },
    )).toBe("overview 5 / trends 1d / gateway healthy");
  });
});