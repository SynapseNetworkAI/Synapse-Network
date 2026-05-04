import { describe, expect, it, vi } from "vitest";

const { toastDefaultMock, toastErrorMock } = vi.hoisted(() => ({
  toastDefaultMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  default: Object.assign(toastDefaultMock, {
    error: toastErrorMock,
  }),
}));

import {
  isWithdrawWalletRejected,
  normalizeWithdrawWalletError,
  showWithdrawWalletErrorToast,
} from "@/utils/providerWithdrawWallet";

describe("normalizeWithdrawWalletError", () => {
  it("maps wallet rejection to a readable cancellation message", () => {
    expect(
      normalizeWithdrawWalletError(new Error("User rejected the request."))
    ).toBe(
      "Withdrawal was cancelled in wallet. No gas fee was spent and no funds were moved."
    );
    expect(isWithdrawWalletRejected({ code: 4001 })).toBe(true);
    expect(isWithdrawWalletRejected({ name: "ACTION_REJECTED" })).toBe(true);
  });

  it("maps insufficient native gas to a readable message", () => {
    expect(
      normalizeWithdrawWalletError(
        new Error("insufficient funds for intrinsic transaction cost")
      )
    ).toBe(
      "Withdrawal could not be submitted because the wallet does not have enough native token to pay gas."
    );
  });

  it("maps ERC20 custom balance errors to a vault liquidity message", () => {
    const rawError = new Error(
      "execution reverted: custom error 0xe450d38c: 000000000000000000000000e7f1725e7734ce288f8367e1bb143e90bb3f0512000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000075f610f70ed20000"
    );

    expect(normalizeWithdrawWalletError(rawError)).toBe(
      "Vault liquidity is insufficient for this withdrawal right now. The platform treasury must refill on-chain USDC before you retry."
    );
  });

  it("shows neutral toast for user rejection and error toast for other failures", () => {
    showWithdrawWalletErrorToast({ code: 4001 }, undefined, { id: "withdraw" });
    expect(toastDefaultMock).toHaveBeenCalledWith(
      "Withdrawal was cancelled in wallet. No gas fee was spent and no funds were moved.",
      { icon: "ℹ️", id: "withdraw" }
    );

    showWithdrawWalletErrorToast(new Error("ticket expired"));
    expect(toastErrorMock).toHaveBeenCalledWith(
      "This withdrawal ticket has expired. Generate a new ticket before retrying.",
      undefined
    );
  });
});
