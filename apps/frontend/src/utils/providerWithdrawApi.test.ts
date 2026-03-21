import { describe, expect, it } from "vitest";

import { resolveProviderWithdrawApiErrorMessage } from "@/utils/providerWithdrawApi";

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
});