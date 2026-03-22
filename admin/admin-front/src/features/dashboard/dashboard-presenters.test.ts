import { describe, expect, it } from "vitest";

import {
  buildDashboardCapitalPulseLanes,
  buildBusinessRuntimeLaneCards,
  buildCapitalSnapshotCards,
  buildDashboardFunnelCards,
  buildDashboardPressureCards,
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
      {
        overallStatus: "degraded",
        summary: "gateway degraded and reconciliation alert present",
        failures: [],
        actions: [],
      } as never,
      {
        chainVaultUsdc: "1000.00",
        signedDifferenceUsdc: "-0.50",
        ownerLiabilityUsdc: "800.00",
        providerPayableUsdc: "150.00",
        platformFeeBalanceUsdc: "25.00",
      } as never,
    );

    expect(metrics[0]).toEqual({
      label: "当前值班结论",
      value: "需要处理",
      meta: "当前平台总账还有 25.00 USDC 未对齐，建议优先核对客户余额、待结算款和平台收入是否一致。",
    });
    expect(metrics[1]).toMatchObject({
      label: "平台总账差额",
      value: "25.00 USDC",
      actionLabel: "查看总账拆分",
    });
    expect(metrics[1]?.href).toBe("/finance");
    expect(metrics[2]?.value).toBe("12");
  });

  it("keeps the overview verdict focused on treasury alignment when the total ledger is balanced", () => {
    const metrics = buildSentinelMetrics(
      {
        metrics: {
          pendingApprovals: 0,
          depositExceptions: 0,
          auditAlerts: 0,
          vaultLedgerDelta: "6.00",
        },
        highlights: [],
      },
      {
        gatewayStatus: "degraded",
        indexerLastProcessedAt: null,
        backfillLastScanAt: null,
        backfillLastScannedBlock: null,
        recentGatewayFailures: 0,
        failedDepositCount: 0,
        recentAuditAlerts: 0,
        lastReconciliationAt: null,
        reconciliationAlert: true,
        reconciliationDeltaUsdc: "6.00",
        reconciliationLastError: null,
        projectedAt: null,
      },
      {
        overallStatus: "degraded",
        summary: "reconciliation alert present",
        failures: [],
        actions: [],
      } as never,
      {
        chainVaultUsdc: "100.00",
        signedDifferenceUsdc: "6.00",
        ownerLiabilityUsdc: "94.00",
        providerPayableUsdc: "0.00",
        platformFeeBalanceUsdc: "6.00",
      } as never,
    );

    expect(metrics[0]).toEqual({
      label: "当前值班结论",
      value: "需要处理",
      meta: "当前系统或业务链路存在异常，建议优先查看系统健康摘要与待处理事项。",
    });
    expect(metrics[1]).toMatchObject({ label: "平台总账差额", value: "0.00 USDC" });
    expect(metrics[2]).toMatchObject({ label: "待处理审批", value: "0" });
  });

  it("builds capital cards directly from finance payload", () => {
    const cards = buildCapitalSnapshotCards({
      todayChargeUsdc: "1280.40",
      todayDepositUsdc: "1640.00",
      todayRefundUsdc: "42.25",
      todayWithdrawalUsdc: "310.50",
      todayInvocationCount: 342,
      todayPlatformFeeEarnedUsdc: "196.40",
      todayProviderEarnedUsdc: "1084.00",
      ownerLiabilityUsdc: "8450.10",
      providerPayableUsdc: "3920.45",
      platformFeeBalanceUsdc: "128.75",
      vaultLedgerDeltaUsdc: "0.50",
      pendingDepositCount: 2,
      pendingWithdrawalCount: 1,
      projectedAt: "2026-03-16T08:05:00Z",
    });

    expect(cards).toContainEqual({
      key: "owner-liability",
      label: "Owner liability",
      value: "8,450.10 USDC",
      hint: "平台账本对 owner 的应付总额，是 vault 资金应该优先覆盖的核心负债面。",
    });
    expect(cards).toContainEqual({
      key: "pending-deposits",
      label: "Pending deposits",
      value: "2",
      hint: "当前仍在确认、补账或回放中的充值单数量，通常和对账偏差、回放延迟直接相关。",
    });
    expect(cards).toContainEqual({
      key: "pending-withdrawals",
      label: "Pending withdrawals",
      value: "1",
      hint: "当前仍在审核或排队执行中的提现单数量，越高表示 operator 出账压力越大。",
    });
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

  it("builds dashboard pressure and funnel cards from stable projections", () => {
    const pressureCards = buildDashboardPressureCards(
      {
        metrics: {
          pendingApprovals: 5,
          depositExceptions: 3,
          auditAlerts: 2,
          vaultLedgerDelta: "0.00",
        },
        highlights: [],
      },
      {
        todayChargeUsdc: "120.00",
        todayDepositUsdc: "300.00",
        todayRefundUsdc: "10.00",
        todayWithdrawalUsdc: "5.00",
        todayInvocationCount: 48,
        todayPlatformFeeEarnedUsdc: "18.00",
        todayProviderEarnedUsdc: "102.00",
        ownerLiabilityUsdc: "800.00",
        providerPayableUsdc: "150.00",
        platformFeeBalanceUsdc: "25.00",
        vaultLedgerDeltaUsdc: "0.00",
        pendingDepositCount: 2,
        pendingWithdrawalCount: 1,
        projectedAt: null,
      },
    );

    const funnelCards = buildDashboardFunnelCards(
      {
        todayChargeUsdc: "120.00",
        todayDepositUsdc: "300.00",
        todayRefundUsdc: "10.00",
        todayWithdrawalUsdc: "5.00",
        todayInvocationCount: 48,
        todayPlatformFeeEarnedUsdc: "18.00",
        todayProviderEarnedUsdc: "102.00",
        ownerLiabilityUsdc: "800.00",
        providerPayableUsdc: "150.00",
        platformFeeBalanceUsdc: "25.00",
        vaultLedgerDeltaUsdc: "0.00",
        pendingDepositCount: 2,
        pendingWithdrawalCount: 1,
        projectedAt: null,
      },
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
      null,
    );

    expect(pressureCards.map((card) => card.key)).toEqual([
      "pending-deposits",
      "pending-withdrawals",
      "deposit-exceptions",
      "audit-alerts",
    ]);
    expect(funnelCards[0]).toMatchObject({
      key: "deposit-funnel",
      title: "充值情况摘要",
      value: "2 笔待确认",
      tone: "orange",
      href: "/finance/reconciliation",
    });
    expect(funnelCards[0]?.detail).toBe("今日已入账 300.00 USDC，当前仍有 2 笔充值等待确认。");
    expect(funnelCards[1]).toMatchObject({
      title: "消费扣费摘要",
      value: "今日已扣费 120.00 USDC",
    });
    expect(pressureCards).toEqual([
      {
        key: "pending-deposits",
        label: "待确认充值",
        value: "2",
        hint: "仍在确认或等待补记的充值笔数。",
      },
      {
        key: "pending-withdrawals",
        label: "待处理提现",
        value: "1",
        hint: "仍在审核或排队处理的提现笔数。",
      },
      {
        key: "deposit-exceptions",
        label: "充值异常",
        value: "3",
        hint: "充值异常越多，越需要尽快核对入账情况。",
      },
      {
        key: "audit-alerts",
        label: "风险提醒",
        value: "2",
        hint: "若这里有提醒，说明近期存在需要重点关注的敏感操作。",
      },
    ]);
  });

  it("builds non-overlapping business runtime lane cards", () => {
    const cards = buildBusinessRuntimeLaneCards(
      {
        metrics: {
          pendingApprovals: 6,
          depositExceptions: 2,
          auditAlerts: 1,
          vaultLedgerDelta: "0.00",
        },
        highlights: [],
      },
      {
        todayChargeUsdc: "120.00",
        todayDepositUsdc: "300.00",
        todayRefundUsdc: "10.00",
        todayWithdrawalUsdc: "5.00",
        ownerLiabilityUsdc: "800.00",
        providerPayableUsdc: "150.00",
        platformFeeBalanceUsdc: "25.00",
        vaultLedgerDeltaUsdc: "0.00",
        pendingDepositCount: 2,
        pendingWithdrawalCount: 4,
        projectedAt: null,
        refundableConsumerBalanceUsdc: "0.00",
        providerAvailableToWithdrawUsdc: "0.00",
        providerLockedBalanceUsdc: "0.00",
      },
      {
        gatewayStatus: "degraded",
        reconciliationAlert: true,
        reconciliationDeltaUsdc: "6.50",
        signedDifferenceUsdc: "6.50",
        imbalanceDirection: "vault_surplus",
        chainVaultUsdc: "100.00",
        ledgerObligationUsdc: "94.00",
        lastReconciliationAt: null,
        runtimeStateUpdatedAt: null,
        reconciliationLastError: null,
        pendingApprovals: 6,
        depositExceptions: 2,
        auditAlerts: 1,
        pendingDepositCount: 2,
        pendingWithdrawalCount: 4,
        todayRefundUsdc: "10.00",
        todayWithdrawalUsdc: "5.00",
        ownerLiabilityUsdc: "80.00",
        providerPayableUsdc: "10.00",
        platformFeeBalanceUsdc: "4.00",
        chainConfirmedNotLedgerConfirmedCount: 2,
        depositP95SyncDelaySeconds: 8,
        recentlyCompletedOutflowsUsdc: "0.00",
      } as never,
    );

    expect(cards).toHaveLength(3);
    expect(cards[0]).toMatchObject({ key: "approval-lane", href: "/approvals", tone: "orange" });
    expect(cards[1]).toMatchObject({ key: "deposit-lane", href: "/finance/reconciliation", tone: "red" });
    expect(cards[2]).toMatchObject({ key: "outflow-lane", href: "/withdrawal-reviews", tone: "orange" });
  });

  it("builds a compact capital pulse summary for overview", () => {
    const lanes = buildDashboardCapitalPulseLanes({
      todayChargeUsdc: "120.00",
      todayDepositUsdc: "300.00",
      todayRefundUsdc: "10.00",
      todayWithdrawalUsdc: "5.00",
      todayInvocationCount: 48,
      todayPlatformFeeEarnedUsdc: "18.00",
      todayProviderEarnedUsdc: "102.00",
      ownerLiabilityUsdc: "800.00",
      refundableConsumerBalanceUsdc: "630.12",
      providerPayableUsdc: "150.00",
      providerAvailableToWithdrawUsdc: "145.50",
      providerLockedBalanceUsdc: "4.50",
      platformFeeBalanceUsdc: "25.00",
      vaultLedgerDeltaUsdc: "0.00",
      pendingDepositCount: 2,
      pendingWithdrawalCount: 1,
      projectedAt: null,
    });

    expect(lanes).toEqual([
      {
        key: "consumer",
        title: "Consumer",
        description: "把今日入金、消费、退款和调用次数放在同一侧，快速判断需求侧是否正常展开。",
        items: [
          { key: "today-deposit", label: "Today deposit", value: "300.00 USDC", hint: "当前统计窗口内已确认进入系统的充值总额，用来观察入金节奏和补账压力。" },
          { key: "today-charge", label: "Today charge", value: "120.00 USDC", hint: "当前统计窗口内网关已计量确认的 usage 扣费金额，反映 agent 调用带来的实际消费。" },
          { key: "today-invocation-count", label: "Today invocation count", value: "48", hint: "当前统计窗口内成功进入计费链路的调用次数，用来判断活跃度和收入规模是否同步变化。" },
        ],
      },
      {
        key: "platform",
        title: "Platform",
        description: "平台侧只保留新增手续费和累计收入池，避免把总账判断和经营摘要混成一组。",
        items: [
          { key: "today-platform-fee-earned", label: "Today platform fee earned", value: "18.00 USDC", hint: "当前统计窗口内新增记入平台收入池的手续费金额，用来观察今天新增商业结果。" },
          { key: "platform-income", label: "Platform income", value: "25.00 USDC", hint: "平台手续费收入池余额，表示当前已经沉淀在平台账本内的收入。" },
        ],
      },
      {
        key: "provider",
        title: "Provider",
        description: "把新增收入、提现和可提现空间放到一起，帮助 operator 判断供给侧结算压力。",
        items: [
          { key: "today-provider-earned", label: "Today provider earned", value: "102.00 USDC", hint: "当前统计窗口内新增记入 Provider payable 的收入金额，用来判断供给侧结算和提现压力。" },
          { key: "today-withdrawal", label: "Today withdrawal", value: "5.00 USDC", hint: "当前统计窗口内已经完成或进入结转流程的提现金额，反映资金流出压力。" },
          { key: "pending-withdrawals", label: "Pending withdrawals", value: "1", hint: "当前仍在审核或排队执行中的提现单数量，越高表示 operator 出账压力越大。" },
        ],
      },
    ]);
  });
});