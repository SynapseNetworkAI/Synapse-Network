import { describe, expect, it } from "vitest";

import {
  buildApprovalDrilldownTokens,
  buildReconciliationBreakdownCards,
  buildReconciliationQueueCards,
  buildWithdrawReviewDrilldownTokens,
  describeImbalance,
  formatSignedUsdc,
  resolveDrilldownCount,
  resolveDrilldownTitle,
  resolveReconciliationStamp,
} from "./reconciliation-presenters";

const detail = {
  gatewayStatus: "degraded",
  reconciliationAlert: true,
  reconciliationDeltaUsdc: "111.50",
  signedDifferenceUsdc: "-111.50",
  imbalanceDirection: "vault_deficit",
  chainVaultUsdc: "1000.00",
  ledgerObligationUsdc: "1111.50",
  lastReconciliationAt: "2026-03-21T10:00:00Z",
  runtimeStateUpdatedAt: "2026-03-21T10:00:02Z",
  reconciliationLastError: "vault_delta_detected",
  pendingApprovals: 3,
  depositExceptions: 7,
  auditAlerts: 10,
  pendingDepositCount: 4,
  pendingWithdrawalCount: 2,
  ownerLiabilityUsdc: "1111.50",
  providerPayableUsdc: "300.00",
  platformFeeBalanceUsdc: "25.00",
  projectedAt: "2026-03-21T10:05:00Z",
  priorityApprovals: [],
  depositRepairApprovals: [],
  pendingWithdrawalReviews: [],
};

const approvalItem = {
  approvalId: "APR-20260316-003",
  approvalType: "deposit_repair",
  status: "FAILED",
  approvalLevel: "L2",
  requesterRole: "platform_ops_admin",
  amountUsdc: "42.50",
  createdAt: "2026-03-21T10:00:00Z",
  ownerAddress: "0xabc",
  requestId: "req-1",
  txHash: "0xhash",
};

const drilldown = {
  ownerAddress: "0xabc",
  requestId: null,
  txHash: null,
  priorityApprovals: [approvalItem],
  depositRepairApprovals: [approvalItem],
  pendingWithdrawalReviews: [
    {
      withdrawalId: "wd-1",
      ownerAddress: "0xabc",
      amountUsdc: "88.00",
      status: "PENDING_MANUAL_REVIEW",
      requestId: "req-1",
      txHash: null,
      riskLevel: "red",
      riskReasonCode: "velocity_limit",
      evidenceSummary: "demo",
      message: null,
      createdAt: "2026-03-21T10:00:00Z",
      updatedAt: "2026-03-21T10:00:00Z",
    },
  ],
};

describe("reconciliation presenters", () => {
  it("describes vault deficit direction clearly", () => {
    expect(describeImbalance(detail)).toContain("低于账本义务 111.50 USDC");
  });

  it("builds breakdown cards from backend detail payload", () => {
    const cards = buildReconciliationBreakdownCards(detail);

    expect(cards).toContainEqual({
      label: "Platform income",
      value: "25.00 USDC",
      description: "平台手续费收入池余额，用来反映当前已沉淀的平台收入。",
    });
    expect(cards).toContainEqual({
      label: "Chain vault",
      value: "1,000.00 USDC",
      description: "链上 router/vault 当前真实 USDC 余额。",
    });
    expect(cards).toContainEqual({
      label: "Signed difference",
      value: "-111.50 USDC",
      description: "按 chain vault - ledger obligation 计算，帮助判断是 vault surplus 还是 vault deficit。",
    });
  });

  it("formats signed amounts with explicit positive prefix", () => {
    expect(formatSignedUsdc("-111.50")).toBe("-111.50 USDC");
    expect(formatSignedUsdc("111.50")).toBe("+111.50 USDC");
    expect(formatSignedUsdc(null)).toBe("n/a");
  });

  it("builds queue cards for operator backlog context", () => {
    const cards = buildReconciliationQueueCards(detail);

    expect(cards[0]?.value).toBe("3");
    expect(cards[1]?.label).toBe("Deposit exceptions");
    expect(cards[3]?.value).toBe("10");
  });

  it("formats projection stamp via shared datetime helper", () => {
    expect(resolveReconciliationStamp(detail)).toBe("03/21 18:05");
  });

  it("builds locator tokens for approvals and reviews", () => {
    const review = drilldown.pendingWithdrawalReviews[0];

    expect(review).toBeDefined();
    expect(buildApprovalDrilldownTokens(approvalItem)).toEqual([
      { kind: "ownerAddress", label: "Owner", value: "0xabc" },
      { kind: "requestId", label: "Request ID", value: "req-1" },
      { kind: "txHash", label: "Tx Hash", value: "0xhash" },
    ]);
    if (review) {
      expect(buildWithdrawReviewDrilldownTokens(review)).toEqual([
        { kind: "ownerAddress", label: "Owner", value: "0xabc" },
        { kind: "requestId", label: "Request ID", value: "req-1" },
      ]);
    }
  });

  it("resolves drilldown header and total result count", () => {
    expect(resolveDrilldownTitle(drilldown)).toBe("Owner 0xabc");
    expect(resolveDrilldownCount(drilldown)).toBe(3);
  });
});