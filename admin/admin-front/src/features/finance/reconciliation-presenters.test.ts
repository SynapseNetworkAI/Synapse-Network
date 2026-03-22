import { describe, expect, it } from "vitest";

import {
  buildApprovalDrilldownTokens,
  buildReconciliationDepositEvidenceCards,
  buildReconciliationHeroCards,
  buildReconciliationOutflowEvidenceCards,
  buildReconciliationSupportingCards,
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
  todayRefundUsdc: "12.30",
  todayWithdrawalUsdc: "44.10",
  ownerLiabilityUsdc: "1111.50",
  providerPayableUsdc: "300.00",
  platformFeeBalanceUsdc: "25.00",
  chainConfirmedNotLedgerConfirmedCount: 3,
  depositP95SyncDelaySeconds: 184,
  recentlyCompletedOutflowsUsdc: "58.40",
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

  it("builds hero and supporting cards from backend detail payload", () => {
    const heroCards = buildReconciliationHeroCards(detail);
    const supportingCards = buildReconciliationSupportingCards(detail);

    expect(heroCards[0]).toMatchObject({
      key: "chain-vault",
      label: "Chain vault",
      value: "1,000.00 USDC",
      description: "链上 router 或 vault 当前可观测到的 USDC 实际余额。",
    });
    expect(heroCards[2]).toMatchObject({
      key: "signed-difference",
      label: "Signed difference",
      value: "-111.50 USDC",
      description: "带方向偏差，按 chain vault - ledger obligation 计算；负值代表 vault deficit，正值代表 vault surplus。",
    });
    expect(supportingCards[2]).toMatchObject({
      key: "platform-income",
      label: "Platform income",
      value: "25.00 USDC",
      description: "平台手续费收入池余额，表示当前已经沉淀在平台账本内的收入。",
    });
  });

  it("formats signed amounts with explicit positive prefix", () => {
    expect(formatSignedUsdc("-111.50")).toBe("-111.50 USDC");
    expect(formatSignedUsdc("111.50")).toBe("+111.50 USDC");
    expect(formatSignedUsdc(null)).toBe("n/a");
  });

  it("builds deposit and outflow evidence cards", () => {
    const depositEvidence = buildReconciliationDepositEvidenceCards(detail);
    const outflowEvidence = buildReconciliationOutflowEvidenceCards(detail);

    expect(depositEvidence[0]).toMatchObject({ key: "pending-deposits", value: "4" });
    expect(depositEvidence[1]).toMatchObject({ key: "deposit-exceptions", value: "7" });
    expect(depositEvidence[2]).toMatchObject({ key: "chain-confirmed-not-ledger-confirmed", value: "3" });
    expect(depositEvidence[3]).toMatchObject({ key: "deposit-p95-sync-delay", value: "3m 04s" });
    expect(outflowEvidence[0]).toMatchObject({ key: "today-refund", value: "12.30 USDC" });
    expect(outflowEvidence[1]).toMatchObject({ key: "today-withdrawal", value: "44.10 USDC" });
    expect(outflowEvidence[2]).toMatchObject({ key: "pending-withdrawals", value: "2" });
    expect(outflowEvidence[3]).toMatchObject({ key: "recently-completed-outflows", value: "58.40 USDC" });
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