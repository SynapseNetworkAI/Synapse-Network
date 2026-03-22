import { describe, expect, it } from "vitest";

import { buildFinanceExposureCards, buildTrendChartData, filterFinanceApprovals, getVaultDeltaTone } from "./finance-presenters";

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

  it("builds finance exposure cards with unified glossary wording", () => {
    expect(buildFinanceExposureCards({
      ownerLiabilityUsdc: "8450.10",
      providerPayableUsdc: "3920.45",
      platformFeeBalanceUsdc: "128.75",
    } as never)).toEqual([
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
        key: "platform-fee",
        label: "Platform income",
        value: "128.75",
        description: "当前平台收入池余额。",
        hint: "平台手续费收入池余额，表示当前已经沉淀在平台账本内的收入。",
      },
    ]);
  });
});
