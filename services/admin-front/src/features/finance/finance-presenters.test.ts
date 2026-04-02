import { describe, expect, it } from "vitest";

import {
  buildCapitalPulseTrendLanes,
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

  it("builds capital pulse trend lanes from activity trends", () => {
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

    const points = [
      {
        bucketDate: "2026-03-20T00:00:00Z",
        depositUsdc: "120.0",
        chargeUsdc: "60.0",
        invocationCount: 30,
        platformFeeEarnedUsdc: "9.0",
        providerEarnedUsdc: "51.0",
        refundUsdc: "2.0",
        withdrawalUsdc: "8.0",
        netFlowUsdc: "50.0",
      },
      {
        bucketDate: "2026-03-21T00:00:00Z",
        depositUsdc: "150.0",
        chargeUsdc: "70.0",
        invocationCount: 42,
        platformFeeEarnedUsdc: "11.0",
        providerEarnedUsdc: "59.0",
        refundUsdc: "3.0",
        withdrawalUsdc: "12.0",
        netFlowUsdc: "55.0",
      },
    ] as never;

    const lanes = buildCapitalPulseTrendLanes(overview, points);

    expect(lanes).toHaveLength(3);
    expect(lanes[0]).toMatchObject({
      key: "consumer",
      title: "用户侧变化",
      latestLabel: "最近一天调用次数",
      aggregateLabel: "七天累计调用次数",
      latestValue: "42",
      aggregateValue: "72",
    });
    expect(lanes[1]).toMatchObject({
      key: "platform",
      title: "平台收入变化",
      latestLabel: "最近一天新增收入",
      aggregateLabel: "七天累计新增收入",
      latestValue: "11.00 USDC",
    });
    expect(lanes[2]).toMatchObject({
      key: "provider",
      title: "服务商收支变化",
      latestLabel: "最近一天新增收入",
      aggregateLabel: "七天累计新增收入",
      latestValue: "59.00 USDC",
    });
    expect(lanes[0]?.supportMetrics[0]).toMatchObject({ label: "今日消费", value: "120.00 USDC" });
    expect(lanes[1]?.supportMetrics[0]).toMatchObject({ label: "平台累计收入", value: "25.00 USDC" });
    expect(lanes[2]?.supportMetrics[0]).toMatchObject({ label: "服务商可提现金额", value: "145.50 USDC" });
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
        label: "当前资金余额",
        value: "12500.00",
        description: "平台当前可看到的资金余额。",
        hint: "用来了解平台现在手上有多少资金可供覆盖业务需要。",
      },
      {
        key: "owner-liability",
        label: "用户应付金额",
        value: "8450.10",
        description: "平台当前对用户应承担的金额。",
        hint: "这部分资金需要优先保证，关系到用户可用余额和退款处理。",
      },
      {
        key: "provider-payable",
        label: "服务商待结算金额",
        value: "3920.45",
        description: "平台当前还需要结算给服务商的金额。",
        hint: "帮助判断后续结算和提现压力。",
      },
      {
        key: "platform-income",
        label: "平台累计收入",
        value: "128.75",
        description: "当前平台已经确认的收入。",
        hint: "表示平台目前已经实际沉淀下来的收入金额。",
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
        label: "可退款金额",
        value: "630.12 USDC",
        description: "当前可用于退款处理的用户余额。",
        hint: "帮助判断如果要处理退款，目前还有多少余额可用。",
        pending: false,
      },
      {
        key: "provider-available-to-withdraw",
        label: "服务商可提现金额",
        value: "145.50 USDC",
        description: "服务商当前可以发起提现的金额。",
        hint: "帮助判断服务商侧是否存在集中提现压力。",
        pending: false,
      },
      {
        key: "provider-locked-balance",
        label: "服务商处理中金额",
        value: "4.50 USDC",
        description: "服务商当前已在处理中或暂时锁定的金额。",
        hint: "帮助判断还有多少金额正在走提现或冻结流程。",
        pending: false,
      },
      {
        key: "pending-withdrawals",
        label: "待处理提现",
        value: "1",
        description: "当前还没处理完的提现单数量。",
        hint: "数量越高，说明当前出款处理压力越大。",
        pending: false,
      },
      {
        key: "pending-deposits",
        label: "待处理充值",
        value: "2",
        description: "当前还在确认或补录中的充值单数量。",
        hint: "如果这里较高，通常说明充值处理中积压较多。",
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
        title: "用户侧",
        description: "看今天用户充值、消费和退款的情况，先判断用户侧业务是否正常。",
        items: [
          {
            key: "today-deposit",
            label: "今日充值",
            value: "300.00 USDC",
            hint: "帮助了解今天有多少资金流入平台。",
          },
          {
            key: "today-charge",
            label: "今日消费",
            value: "120.00 USDC",
            hint: "帮助了解今天用户实际消耗了多少金额。",
          },
          {
            key: "today-refund",
            label: "今日退款",
            value: "10.00 USDC",
            hint: "帮助了解今天有多少资金退回给用户。",
          },
          {
            key: "today-invocation-count",
            label: "今日调用次数",
            value: "48",
            hint: "帮助判断今天的业务活跃度是否有变化。",
          },
        ],
      },
      {
        key: "platform",
        title: "平台侧",
        description: "看今天平台新增收入和当前累计收入，方便快速了解经营结果。",
        items: [
          {
            key: "today-platform-fee-earned",
            label: "今日平台收入",
            value: "18.00 USDC",
            hint: "帮助了解今天平台新赚了多少。",
          },
          {
            key: "platform-income",
            label: "平台累计收入",
            value: "25.00 USDC",
            hint: "表示平台目前已经实际沉淀下来的收入金额。",
          },
        ],
      },
      {
        key: "provider",
        title: "服务商侧",
        description: "看服务商今天收入、提现和可提现余额，方便判断当前付款压力。",
        items: [
          {
            key: "today-provider-earned",
            label: "今日服务商收入",
            value: "102.00 USDC",
            hint: "帮助了解今天服务商侧新增了多少应结算收入。",
          },
          {
            key: "today-withdrawal",
            label: "今日提现",
            value: "5.00 USDC",
            hint: "帮助了解今天有多少资金流出平台。",
          },
          {
            key: "pending-withdrawals",
            label: "待处理提现",
            value: "1",
            hint: "数量越高，说明当前出款处理压力越大。",
          },
          {
            key: "provider-available-to-withdraw",
            label: "服务商可提现金额",
            value: "145.50 USDC",
            hint: "帮助判断服务商侧是否存在集中提现压力。",
          },
        ],
      },
    ]);
  });
});
