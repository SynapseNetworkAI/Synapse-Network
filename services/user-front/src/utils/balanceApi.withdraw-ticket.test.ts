import { describe, expect, it, vi } from "vitest";

vi.mock("@/utils/authSession", () => ({
  buildAuthedHeaders: () => ({}),
  normalizeAuthApiError: (message: string) => message,
}));

vi.mock("@/utils/gatewayApi", () => ({
  getGatewayBaseUrl: () => "http://gateway.test",
}));

import {
  listConsumerWithdrawals,
  requestConsumerWithdraw,
} from "@/utils/balanceApi";

describe("consumer withdrawal ticket normalization", () => {
  it("normalizes ticket ids when creating a withdrawal", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          withdrawId: "cw-1",
          amountUsdc: "2",
          feeUsdc: "0.5",
          netUsdc: "1.5",
          status: "REQUESTED",
          ticket: {
            ticketId: "abc",
            ticketHash: "def",
            amount: "200",
            fee: "50",
            deadline: 123,
            signature: "0xsig",
            chainId: 31337,
            contractAddress: "0xcontract",
          },
        }),
        { status: 200 },
      );

    try {
      const result = await requestConsumerWithdraw("0xabc", {
        amountUsdc: "2.000000",
      });

      expect(result.ticket?.ticketId).toBe("0xabc");
      expect(result.ticket?.ticketHash).toBe("0xdef");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("normalizes ticket ids in withdrawal history rows", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          withdrawals: [
            {
              id: "cw-1",
              amountUsdc: "2",
              status: "REQUESTED",
              ticket: {
                ticketId: "abc",
                ticketHash: "def",
                amount: "200",
                fee: "50",
                deadline: 123,
                signature: "0xsig",
                chainId: 31337,
                contractAddress: "0xcontract",
              },
            },
          ],
        }),
        { status: 200 },
      );

    try {
      const rows = await listConsumerWithdrawals("0xabc");

      expect(rows[0].ticket?.ticketId).toBe("0xabc");
      expect(rows[0].ticket?.ticketHash).toBe("0xdef");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
