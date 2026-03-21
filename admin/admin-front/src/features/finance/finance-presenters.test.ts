import { describe, expect, it } from "vitest";

import { buildTrendChartData, filterFinanceApprovals, getVaultDeltaTone } from "./finance-presenters";

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
});
