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
        fallback: "Failed to create provider withdrawal",
      })
    ).toBe(
      "We cannot verify withdrawal availability right now. Please retry in a moment."
    );
  });

  it("maps unrelated known errors without surfacing backend text", () => {
    expect(
      resolveProviderWithdrawApiErrorMessage({
        code: "PENDING_WITHDRAWAL_EXISTS",
        fallback: "Failed to create provider withdrawal",
      })
    ).toBe(
      "A provider withdrawal is already pending. Complete or wait for it before creating a new one."
    );
  });

  it("maps provider maturity errors without surfacing backend English templates", () => {
    expect(
      resolveProviderWithdrawApiErrorMessage({
        code: "PROVIDER_RECEIVABLE_NOT_MATURED",
        fallback: "Failed to create provider withdrawal",
      })
    ).toBe("Provider earnings are still in the T+7 maturity window.");
  });

  it("maps minimum amount and insufficient receivable policy errors", () => {
    expect(
      resolveProviderWithdrawApiErrorMessage({
        code: "MIN_WITHDRAWAL_AMOUNT_NOT_MET",
        fallback: "Failed to create provider withdrawal",
      })
    ).toBe("Minimum provider withdrawal amount is 10.00 USDC.");

    expect(
      resolveProviderWithdrawApiErrorMessage({
        code: "INSUFFICIENT_PROVIDER_RECEIVABLE",
        fallback: "Failed to create provider withdrawal",
      })
    ).toBe(
      "Withdrawable provider receivable is insufficient for this withdrawal."
    );
  });

  it("uses the safe fallback for unknown backend codes", () => {
    expect(
      resolveProviderWithdrawApiErrorMessage({
        code: "HTTPException: PROVIDER_RECEIVABLE_NOT_MATURED 503 backend",
        fallback:
          "Unable to prepare this withdrawal. Please retry in a moment.",
      })
    ).toBe("Unable to prepare this withdrawal. Please retry in a moment.");
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
        { status: 200 }
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
