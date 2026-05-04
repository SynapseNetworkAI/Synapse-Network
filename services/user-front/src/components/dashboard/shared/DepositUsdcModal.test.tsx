// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import DepositUsdcModal from "@/components/dashboard/shared/DepositUsdcModal";

function renderModal(
  overrides: Partial<Parameters<typeof DepositUsdcModal>[0]> = {}
) {
  const onAmountChange = vi.fn();
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  render(
    <DepositUsdcModal
      isOpen
      amount="20"
      onAmountChange={onAmountChange}
      error=""
      step="input"
      isPending={false}
      isConfirming={false}
      walletAddress="0x82f1c188327bfc265357a85e8a6b4a34d562d6f8"
      vaultAddress="0xef7102f484b3b06854e2545457d39e7170510512"
      walletUsdcBalance={800}
      nativeGasBalance={0.25}
      nativeGasSymbol="ETH"
      networkLabel="Chain 421614"
      canSubmit
      shortAddress={(value?: string) => value?.slice(0, 6) ?? "-"}
      onClose={onClose}
      onConfirm={onConfirm}
      {...overrides}
    />
  );
  return { onAmountChange, onClose, onConfirm };
}

describe("DepositUsdcModal", () => {
  it("renders wallet preflight balances and submits when valid", async () => {
    const user = userEvent.setup();
    const { onAmountChange, onConfirm } = renderModal();

    expect(screen.getByText("Wallet USDC")).toBeTruthy();
    expect(screen.getByText("800.00 USDC")).toBeTruthy();
    expect(screen.getByText("Native gas balance")).toBeTruthy();
    expect(screen.getByText("0.2500 ETH")).toBeTruthy();
    expect(screen.getByText("Chain 421614")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "$100.00" }));
    expect(onAmountChange).toHaveBeenCalledWith("100");

    await user.type(screen.getByRole("spinbutton"), "5");
    expect(onAmountChange).toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: /Confirm Deposit 20.00 USDC/ })
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows preflight errors and disables confirmation", () => {
    renderModal({
      amount: "abc",
      preflightError: "Insufficient wallet USDC",
      canSubmit: false,
    });

    expect(screen.getByText("Insufficient wallet USDC")).toBeTruthy();
    expect(screen.getAllByText("0.00 USDC").length).toBeGreaterThan(0);
    expect(
      (
        screen.getByRole("button", {
          name: /Confirm Deposit 0.00 USDC/,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });
});
