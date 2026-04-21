import { describe, expect, it, vi } from "vitest";

vi.mock("@/utils/authSession", () => ({
  buildAuthedHeaders: () => ({}),
  normalizeAuthApiError: (message: string) => message,
}));

import {
  listProviderWithdrawals,
  resolveProviderWithdrawApiErrorMessage,
} from "@/utils/providerWithdrawApi";

describe("resolveProviderWithdrawApiErrorMessage", () => {
  it("maps vault liquidity check unavailable to a readable retry message", () => {
    expect(
      resolveProviderWithdrawApiErrorMessage({
        code: "WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE",
        message: "Unable to verify vault liquidity right now. Retry after the gateway reconnects to chain RPC.",
        status: 503,
        fallback: "Failed to create provider withdrawal",
      }),
    ).toBe("Gateway cannot verify on-chain vault liquidity right now. Retry after the chain RPC reconnects.");
  });

  it("falls back to the backend message for unrelated errors", () => {
    expect(
      resolveProviderWithdrawApiErrorMessage({
        code: "PENDING_WITHDRAWAL_EXISTS",
        message: "A pending provider withdrawal already exists.",
        status: 409,
        fallback: "Failed to create provider withdrawal",
      }),
    ).toBe("A pending provider withdrawal already exists.");
  });

  it("normalizes withdrawal ticket ids from list responses", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          withdrawals: [
            {
              id: "wd-1",
              amountUsdc: "1",
              status: "APPROVED_AUTO",
              ticket: {
                ticketId: "abc",
                ticketHash: "def",
                amount: "100",
                fee: "1",
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
      const rows = await listProviderWithdrawals("0xabc");

      expect(rows[0].ticket?.ticketId).toBe("0xabc");
      expect(rows[0].ticket?.ticketHash).toBe("0xdef");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
