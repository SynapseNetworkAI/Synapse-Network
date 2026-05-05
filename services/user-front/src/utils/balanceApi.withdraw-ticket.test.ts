import { describe, expect, it, vi } from "vitest";

vi.mock("@/utils/authSession", () => ({
  buildAuthedHeaders: () => ({}),
  normalizeAuthApiError: (message: string) => message,
}));

vi.mock("@/utils/gatewayApi", () => ({
  getGatewayBaseUrl: () => "http://gateway.test",
}));

import {
  ConsumerWithdrawApiError,
  getV2Balance,
  listConsumerWithdrawals,
  requestConsumerWithdraw,
} from "@/utils/balanceApi";

describe("consumer withdrawal ticket normalization", () => {
  it("normalizes balance buckets from the Gateway balance response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          balance: {
            consumerAvailableBalance: "7.500000",
            consumerPendingBalance: "200.000000",
            consumerFrozenBalance: "3.000000",
            providerReceivableBalance: "9.000000",
            platform: { feeAccrued: "1.250000" },
          },
        }),
        { status: 200 }
      );

    try {
      await expect(getV2Balance("0xabc")).resolves.toEqual({
        ownerBalance: "7.5",
        consumerPendingBalance: "200",
        consumerFrozenBalance: "3",
        providerReceivable: "9",
        platformFeeAccrued: "1.25",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

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
        { status: 200 }
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

  it("surfaces withdrawal request errors", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "no spendable credits" }), {
        status: 400,
      });

    try {
      await expect(
        requestConsumerWithdraw("0xabc", { amountUsdc: "99" })
      ).rejects.toThrow("no spendable credits");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves structured consumer withdrawal error codes", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          detail: {
            code: "CHAIN_RPC_UNAVAILABLE",
            message: "Unable to reach chain RPC for withdrawal ticket signing.",
          },
        }),
        { status: 503 }
      );

    try {
      await expect(
        requestConsumerWithdraw("0xabc", { amountUsdc: "99" })
      ).rejects.toMatchObject({
        name: "ConsumerWithdrawApiError",
        code: "CHAIN_RPC_UNAVAILABLE",
        status: 503,
      } satisfies Partial<ConsumerWithdrawApiError>);
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
        { status: 200 }
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
