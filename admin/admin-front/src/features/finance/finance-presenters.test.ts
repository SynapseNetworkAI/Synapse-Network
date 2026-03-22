import { describe, expect, it } from "vitest";

import {
  buildFinanceCapitalPulseLanes,
  buildFinanceDeltaCards,
  buildFinanceFlowVolumeCards,
  buildFinancePressureCards,
  buildFinanceTreasuryCoreCards,
  buildTrendChartData,
  filterFinanceApprovals,
  getVaultDeltaTone,
} from "./finance-presenters";

describe("finance-presenters", () => {
  it("filters only finance-related approvals", () => {
    expect(filterFinanceApprovals([
      { approvalType: "refund_approve" },
      { approvalType: "menu_publish" },
      { approvalType: "provider_withdraw_review" },
    ] as never[]).map((item) => item.approvalType)).toEqual(["refund_approve", "provider_withdraw_review"]);
  });

  it("converts trend points into numeric chart rows", () => {
    expect(buildTrendChartData([
      {
        bucketDate: "2026-03-21T00:00:00Z",
        depositUsdc: "10.5",
        chargeUsdc: "4.2",
        invocationCount: 12,
        platformFeeEarnedUsdc: "0.6",
        providerEarnedUsdc: "3.6",
        refundUsdc: "1.0",
        withdrawalUsdc: "3.0",
        netFlowUsdc: "2.3",
      },
    ])).toEqual([
      {
        label: "03/21",
        deposit: 10.5,
        charge: 4.2,
        refund: 1,
        withdrawal: 3,
        netFlow: 2.3,
      },
    ]);
  });

  it("grades vault delta severity", () => {
    expect(getVaultDeltaTone("0.001")).toBe("green");
    expect(getVaultDeltaTone("12")).toBe("orange");
    expect(getVaultDeltaTone("120")).toBe("red");
  });

  it("builds finance treasury core cards with backend truth", () => {
    expect(buildFinanceTreasuryCoreCards({
      ownerLiabilityUsdc: "8450.10",
      providerPayableUsdc: "3920.45",
      platformFeeBalanceUsdc: "128.75",
    } as never, {
      chainVaultUsdc: "12500.00",
      signedDifferenceUsdc: "-5.00",
      ownerLiabilityUsdc: "8450.10",
      providerPayableUsdc: "3920.45",
      platformFeeBalanceUsdc: "128.75",
    })).toEqual([
      {
        key: "chain-vault",
        label: "Chain vault",
        value: "12500.00",
        description: "链上 router / vault 当前 USDC 余额。",
        hint: "链上 router 或 vault 当前可观测到的 USDC 实际余额。",
      },
      {
        key: "owner-liability",
        label: "Owner liability",
        value: "8450.10",
        description: "买家侧应付池。",
        hint: "平台账本对 owner 的应付总额，是 vault 资金应该优先覆盖的核心负债面。",
      },
      {
        key: "provider-payable",
        label: "Provider payable",
        value: "3920.45",
        description: "待结算给 provider。",
        hint: "平台当前已确认、但尚未对 provider 完成清算的应付池余额。",
      },
      {
        key: "platform-income",
        label: "Platform income",
        value: "128.75",
        description: "当前平台收入池余额。",
        hint: "平台手续费收入池余额，表示当前已经沉淀在平台账本内的收入。",
      },
    ]);
  });

  it("builds treasury delta, flow volume, and pressure cards", () => {
    const overview = {
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
      vaultLedgerDeltaUsdc: "0.50",
      pendingDepositCount: 2,
      pendingWithdrawalCount: 1,
      projectedAt: null,
    } as never;

    const reconciliation = {
      chainVaultUsdc: "1000.00",
      signedDifferenceUsdc: "-0.50",
      ownerLiabilityUsdc: "800.00",
      providerPayableUsdc: "150.00",
      platformFeeBalanceUsdc: "25.00",
    } as never;

    expect(buildFinanceDeltaCards(overview, reconciliation)[0]).toMatchObject({
      key: "treasury-signed-difference",
      value: "25.00",
    });
    expect(buildFinanceFlowVolumeCards(overview).map((card) => card.key)).toEqual([
      "today-deposit",
      "today-charge",
      "today-refund",
      "today-withdrawal",
    ]);
    expect(buildFinancePressureCards(overview)).toEqual([
      {
        key: "refundable-consumer-balance",
        label: "Refundable consumer balance",
        value: "630.12 USDC",
        description: "当前使用 consumer wallet available balance 作为 refund 可用余额的 operator proxy。",
        hint: "在 refund 风控、状态机和冻结规则约束下，可供用户实际发起退款的消费侧余额。当前若未接入后端投影，应明确标记为待接线。",
        pending: false,
      },
      {
        key: "provider-available-to-withdraw",
        label: "Provider available to withdraw",
        value: "145.50 USDC",
        description: "Provider wallet available balance 的聚合读模型，用于判断可直接发起提现的空间。",
        hint: "Provider 收益桶中当前可直接发起提现申请的 available balance。当前若未接入后端投影，应明确标记为待接线。",
        pending: false,
      },
      {
        key: "provider-locked-balance",
        label: "Provider locked balance",
        value: "4.50 USDC",
        description: "Provider wallet pending + frozen balance 的聚合读模型，用来判断出账队列压力。",
        hint: "Provider 提现流程里已经进入 pending 或 frozen 的锁仓金额，用来判断出账队列压力。当前若未接入后端投影，应明确标记为待接线。",
        pending: false,
      },
      {
        key: "pending-withdrawals",
        label: "Pending withdrawals",
        value: "1",
        description: "等待 reviewer 决策。",
        hint: "当前仍在审核或排队执行中的提现单数量，越高表示 operator 出账压力越大。",
        pending: false,
      },
      {
        key: "pending-deposits",
        label: "Pending deposits",
        value: "2",
        description: "待补账充值单。",
        hint: "当前仍在确认、补账或回放中的充值单数量，通常和对账偏差、回放延迟直接相关。",
        pending: false,
      },
    ]);
  });

  it("builds capital pulse lanes for consumer, platform, and provider", () => {
    const overview = {
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
      vaultLedgerDeltaUsdc: "0.50",
      pendingDepositCount: 2,
      pendingWithdrawalCount: 1,
      projectedAt: null,
    } as never;

    expect(buildFinanceCapitalPulseLanes(overview)).toEqual([
      {
        key: "consumer",
        title: "Consumer",
        description: "把今日入金、消费、退款和调用次数放在同一侧，快速判断需求侧是否正常展开。",
        items: [
          {
            key: "today-deposit",
            label: "Today deposit",
            value: "300.00 USDC",
            hint: "当前统计窗口内已确认进入系统的充值总额，用来观察入金节奏和补账压力。",
          },
          {
            key: "today-charge",
            label: "Today charge",
            value: "120.00 USDC",
            hint: "当前统计窗口内网关已计量确认的 usage 扣费金额，反映 agent 调用带来的实际消费。",
          },
          {
            key: "today-refund",
            label: "Today refund",
            value: "10.00 USDC",
            hint: "当前统计窗口内已经进入退款审批或完成退款结转的金额，用来观察逆向资金流。",
          },
          {
            key: "today-invocation-count",
            label: "Today invocation count",
            value: "48",
            hint: "当前统计窗口内成功进入计费链路的调用次数，用来判断活跃度和收入规模是否同步变化。",
          },
        ],
      },
      {
        key: "platform",
        title: "Platform",
        description: "平台侧只保留新增手续费和累计收入池，避免把总账判断和经营摘要混成一组。",
        items: [
          {
            key: "today-platform-fee-earned",
            label: "Today platform fee earned",
            value: "18.00 USDC",
            hint: "当前统计窗口内新增记入平台收入池的手续费金额，用来观察今天新增商业结果。",
          },
          {
            key: "platform-income",
            label: "Platform income",
            value: "25.00 USDC",
            hint: "平台手续费收入池余额，表示当前已经沉淀在平台账本内的收入。",
          },
        ],
      },
      {
        key: "provider",
        title: "Provider",
        description: "把新增收入、提现和可提现空间放到一起，帮助 operator 判断供给侧结算压力。",
        items: [
          {
            key: "today-provider-earned",
            label: "Today provider earned",
            value: "102.00 USDC",
            hint: "当前统计窗口内新增记入 Provider payable 的收入金额，用来判断供给侧结算和提现压力。",
          },
          {
            key: "today-withdrawal",
            label: "Today withdrawal",
            value: "5.00 USDC",
            hint: "当前统计窗口内已经完成或进入结转流程的提现金额，反映资金流出压力。",
          },
          {
            key: "pending-withdrawals",
            label: "Pending withdrawals",
            value: "1",
            hint: "当前仍在审核或排队执行中的提现单数量，越高表示 operator 出账压力越大。",
          },
          {
            key: "provider-available-to-withdraw",
            label: "Provider available to withdraw",
            value: "145.50 USDC",
            hint: "Provider 收益桶中当前可直接发起提现申请的 available balance。当前若未接入后端投影，应明确标记为待接线。",
          },
        ],
      },
    ]);
  });
});
