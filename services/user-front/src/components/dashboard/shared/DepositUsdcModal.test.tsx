// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
    cleanup();
  });

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

  it("renders caller-provided localized copy for labels, progress, and aria", () => {
    renderModal({
      title: "购买 credits",
      description: "把 USDC 充值到 Synapse vault 中。",
      confirmationNotice: "区块链确认中。",
      step: "signing_permit",
      isPending: true,
      copy: {
        amountLabel: "金额 (USDC)",
        walletUsdcLabel: "钱包 USDC",
        nativeGasLabel: "Gas 余额",
        networkLabel: "网络",
        transactionSummaryLabel: "交易摘要",
        fromWalletLabel: "来源钱包",
        toVaultLabel: "目标 Vault 合约",
        depositAmountLabel: "充值金额",
        permitAllowanceLabel: "本次授权额度",
        expectationTitle: "确认前请核对",
        expectationPermit: "Permit 签名本身免 gas，并且只授权本次 USDC 金额。",
        expectationGas: "Vault 充值是链上交易，需要使用原生代币支付 gas。",
        expectationSync:
          "Gateway 索引并确认充值后，资金才会转为可消费 credits。",
        stepPermitTitle: "Step 1: Permit 授权",
        stepPermitActive: "钱包弹窗：为精确金额签署免 gas 授权。",
        stepPermitDone: "Permit 签名已完成。",
        stepDepositTitle: "Step 2: Vault 充值交易",
        stepDepositActive: "钱包弹窗：提交链上 Vault 充值交易并支付 gas。",
        stepDepositWaiting: "等待 Permit 授权完成。",
        progressAriaLabel: "充值进度",
        cancelLabel: "取消",
        processingLabel: "处理中...",
        confirmLabel: "确认充值",
        closeDialogLabel: "关闭充值弹窗",
      },
    });

    expect(screen.getByRole("heading", { name: "购买 credits" })).toBeTruthy();
    expect(screen.getByText("交易摘要")).toBeTruthy();
    expect(screen.getByText("确认前请核对")).toBeTruthy();
    expect(screen.getByText("Step 1: Permit 授权")).toBeTruthy();
    expect(screen.getByRole("button", { name: "关闭充值弹窗" })).toBeTruthy();
    expect(
      screen.getByLabelText("充值进度", { selector: "section" })
    ).toBeTruthy();
    expect(screen.getByText("处理中...")).toBeTruthy();
  });
});
