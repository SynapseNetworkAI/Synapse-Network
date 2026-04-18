import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { buildAuthedHeadersMock, getGatewayBaseUrlMock } = vi.hoisted(() => ({
  buildAuthedHeadersMock: vi.fn(() => ({ Authorization: "Bearer test" })),
  getGatewayBaseUrlMock: vi.fn(() => "http://127.0.0.1:8000"),
}));

vi.mock("@/utils/authSession", () => ({
  buildAuthedHeaders: buildAuthedHeadersMock,
}));

vi.mock("@/utils/gatewayApi", () => ({
  getGatewayBaseUrl: getGatewayBaseUrlMock,
}));

import { fetchRefunds } from "@/utils/refundApi";

describe("fetchRefunds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("filters consumer withdraw rows so Payments does not duplicate withdrawals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: "success",
          refunds: [
            {
              id: "refund-1",
              amountUsdc: 12.5,
              status: "COMPLETED",
              txHash: "0xrefund",
              createdAt: "2026-04-14T12:00:00Z",
              refundType: "SYSTEM_FAILURE",
            },
            {
              id: "withdraw-1",
              amountUsdc: 20,
              status: "FAILED",
              txHash: "0xwithdraw",
              createdAt: "2026-04-14T12:05:00Z",
              refundType: "CONSUMER_BALANCE_WITHDRAW",
            },
          ],
        }),
      })),
    );

    const rows = await fetchRefunds("0xabc");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "refund-1",
      amountUsdc: "12.5",
      status: "COMPLETED",
      txHash: "0xrefund",
      type: "refund",
    });
  });
});
