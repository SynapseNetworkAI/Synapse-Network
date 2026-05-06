// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import DepositUsdcModal from "@/components/dashboard/shared/DepositUsdcModal";

function renderModal(
  overrides: Partial<Parameters<typeof DepositUsdcModal>[0]> = {}
) {
  const onAmountChange = vi.fn();
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  const onUseApproveFallback = vi.fn();
  render(
    <LanguageProvider>
      <DepositUsdcModal
        isOpen
        amount="250"
        onAmountChange={onAmountChange}
        error=""
        step="input"
        flowMode="permit"
        primaryAction="review"
        isReviewing={false}
        isPending={false}
        isConfirming={false}
        walletAddress="0x82f1c188327bfc265357a85e8a6b4a34d562d6f8"
        vaultAddress="0xef7102f484b3b06854e2545457d39e7170510512"
        tokenName="Synapse Test USDC"
        tokenSymbol="USDC"
        walletUsdcBalance={800}
        nativeGasBalance={0.25}
        nativeGasSymbol="GO"
        networkLabel="GoChain Testnet"
        canSubmit
        shortAddress={(value?: string) =>
          value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "-"
        }
        onClose={onClose}
        onConfirm={onConfirm}
        onUseApproveFallback={onUseApproveFallback}
        {...overrides}
      />
    </LanguageProvider>
  );
  return { onAmountChange, onClose, onConfirm, onUseApproveFallback };
}

describe("DepositUsdcModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the input stage with live wallet checks and review action", async () => {
    const user = userEvent.setup();
    const { onAmountChange, onConfirm } = renderModal();

    expect(screen.getByText("Wallet USDC")).toBeTruthy();
    expect(screen.getByText("800.00 USDC")).toBeTruthy();
    expect(screen.getByText("Gas balance")).toBeTruthy();
    expect(screen.getByText("0.2500 GO")).toBeTruthy();
    expect(screen.getByText("GoChain Testnet")).toBeTruthy();
    expect(screen.queryByText(/Credits withdrawals require/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "$100.00" }));
    expect(onAmountChange).toHaveBeenCalledWith("100");

    await user.click(screen.getByRole("button", { name: "Review Deposit" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows a simple review panel with amount, wallet, vault, and result", () => {
    renderModal({
      isReviewing: true,
      step: "review",
      flowMode: "permit",
      primaryAction: "walletAction",
    });

    expect(screen.getByText("250.00 USDC")).toBeTruthy();
    expect(screen.getByText("From your wallet")).toBeTruthy();
    expect(screen.getByText("Synapse Vault")).toBeTruthy();
    expect(
      screen.getByText(
        "250.00 USDC will be deposited into Synapse Vault and become spendable credits after Gateway confirmation."
      )
    ).toBeTruthy();
    expect(screen.queryByText("Token address")).toBeNull();
    expect(screen.getByText("Permit authorization")).toBeTruthy();
    expect(
      screen.getByText(
        "Using a hardware wallet? Use Approve transaction instead."
      )
    ).toBeTruthy();
  });

  it("skips authorization copy when allowance is already sufficient", () => {
    renderModal({
      isReviewing: true,
      step: "review",
      flowMode: "preapproved",
      primaryAction: "walletAction",
    });

    expect(
      screen.getByText("Existing allowance found. Authorization step skipped.")
    ).toBeTruthy();
    expect(screen.queryByText("Permit authorization")).toBeNull();
    expect(screen.queryByText("Approve USDC")).toBeNull();
    expect(screen.getByText("Deposit to Vault")).toBeTruthy();
  });

  it("shows approve fallback after hardware-wallet fallback is selected", async () => {
    const user = userEvent.setup();
    const { onUseApproveFallback } = renderModal({
      isReviewing: true,
      step: "permit_timed_out",
      flowMode: "permit",
      primaryAction: "walletAction",
    });

    expect(
      screen.getByText(
        "Wallet did not respond. If you use a hardware wallet, try Approve transaction instead."
      )
    ).toBeTruthy();

    await user.click(
      screen.getByRole("button", {
        name: "Using a hardware wallet? Use Approve transaction instead.",
      })
    );
    expect(onUseApproveFallback).toHaveBeenCalledTimes(1);
  });

  it("renders caller-provided localized copy", () => {
    renderModal({
      title: "购买 credits",
      description: "把 USDC 充值到 Synapse Vault。",
      isReviewing: true,
      step: "review",
      primaryAction: "walletAction",
      copy: {
        amountLabel: "金额 (USDC)",
        walletUsdcLabel: "钱包 USDC",
        nativeGasLabel: "Gas 余额",
        networkLabel: "网络",
        reviewDepositLabel: "确认充值信息",
        checkingWalletLabel: "正在检查钱包...",
        switchNetworkLabel: "切换到 GoChain Testnet",
        insufficientUsdcLabel: "USDC 余额不足",
        insufficientGasLabel: "GO gas 不足",
        continueToWalletLabel: "继续到钱包",
        fromYourWalletLabel: "从你的钱包",
        toSynapseVaultLabel: "到",
        synapseVaultLabel: "Synapse Vault",
        expectedResult:
          "{{amount}} {{symbol}} 将存入 Synapse Vault，Gateway 确认后转为可消费 credits。",
        detailsLabel: "详情",
        vaultAddressLabel: "Vault 地址",
        tokenLabel: "Token",
        allowancePreapprovedLabel: "已检测到足够授权，跳过授权步骤。",
        stepPermitTitle: "Permit 授权",
        stepPermitActive: "钱包弹窗：签署免 gas 授权。",
        stepPermitDone: "Permit 签名已完成。",
        stepApproveTitle: "Approve USDC",
        stepApproveActive: "钱包弹窗：为 Vault 授权。",
        stepApproveDone: "Approve 交易已完成。",
        stepDepositTitle: "充值到 Vault",
        stepDepositActive: "钱包弹窗：提交充值交易。",
        stepDepositWaiting: "请先完成授权。",
        hardwareWalletFallback: "使用硬件钱包？改用 Approve 交易。",
        permitTimedOut: "钱包似乎没有响应。",
        progressAriaLabel: "充值进度",
        cancelLabel: "取消",
        processingLabel: "处理中...",
        closeDialogLabel: "关闭充值弹窗",
      },
    });

    expect(screen.getByRole("heading", { name: "购买 credits" })).toBeTruthy();
    expect(screen.getByText("从你的钱包")).toBeTruthy();
    expect(
      screen.getByText(
        "250.00 USDC 将存入 Synapse Vault，Gateway 确认后转为可消费 credits。"
      )
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "关闭充值弹窗" })).toBeTruthy();
    expect(screen.getByLabelText("充值进度")).toBeTruthy();
  });
});
