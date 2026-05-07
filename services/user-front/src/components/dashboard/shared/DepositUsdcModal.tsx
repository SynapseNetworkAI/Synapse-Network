"use client";

import { CheckCircle2, ChevronRight, RefreshCw, X } from "lucide-react";
import CopyableValue from "@/components/xui/CopyableValue";
import type {
  DepositFlowMode,
  DepositPrimaryAction,
} from "@/hooks/useVaultDeposit";

type DepositStep =
  | "input"
  | "checking"
  | "review"
  | "switching_network"
  | "approving"
  | "signing_permit"
  | "permit_timed_out"
  | "executing_tx";

type DepositUsdcModalCopy = {
  amountLabel: string;
  walletUsdcLabel: string;
  nativeGasLabel: string;
  networkLabel: string;
  reviewDepositLabel: string;
  checkingWalletLabel: string;
  switchNetworkLabel: string;
  insufficientUsdcLabel: string;
  insufficientGasLabel: string;
  continueToWalletLabel: string;
  fromYourWalletLabel: string;
  toSynapseVaultLabel: string;
  synapseVaultLabel: string;
  expectedResult: string;
  walletPromptNotice: string;
  detailsLabel: string;
  vaultAddressLabel: string;
  tokenLabel: string;
  allowancePreapprovedLabel: string;
  stepPermitTitle: string;
  stepPermitActive: string;
  stepPermitDone: string;
  stepApproveTitle: string;
  stepApproveActive: string;
  stepApproveDone: string;
  stepDepositTitle: string;
  stepDepositActive: string;
  stepDepositWaiting: string;
  hardwareWalletFallback: string;
  permitTimedOut: string;
  progressAriaLabel: string;
  cancelLabel: string;
  processingLabel: string;
  closeDialogLabel: string;
};

type DepositUsdcModalProps = {
  isOpen: boolean;
  title?: string;
  description?: string;
  confirmationNotice?: string;
  amount: string;
  presetAmounts?: number[];
  onAmountChange: (value: string) => void;
  error: string;
  step: DepositStep;
  flowMode: DepositFlowMode;
  primaryAction: DepositPrimaryAction;
  isReviewing: boolean;
  isPending: boolean;
  isConfirming: boolean;
  walletAddress?: string;
  vaultAddress: string;
  tokenName: string;
  tokenSymbol: string;
  walletUsdcBalance: number;
  nativeGasBalance: number;
  nativeGasSymbol: string;
  networkLabel: string;
  preflightError?: string;
  canSubmit: boolean;
  shortAddress: (value?: string) => string;
  copy?: Partial<DepositUsdcModalCopy>;
  onClose: () => void;
  onConfirm: () => void;
  onUseApproveFallback: () => void;
};

const DEFAULT_COPY: DepositUsdcModalCopy = {
  amountLabel: "Amount (USDC)",
  walletUsdcLabel: "Wallet USDC",
  nativeGasLabel: "Gas balance",
  networkLabel: "Network",
  reviewDepositLabel: "Review Deposit",
  checkingWalletLabel: "Checking wallet...",
  switchNetworkLabel: "Switch to GoChain Testnet",
  insufficientUsdcLabel: "Insufficient USDC",
  insufficientGasLabel: "Insufficient GO for gas",
  continueToWalletLabel: "Continue to wallet",
  fromYourWalletLabel: "From your wallet",
  toSynapseVaultLabel: "To",
  synapseVaultLabel: "Synapse Vault",
  expectedResult:
    "{{amount}} {{symbol}} will be deposited into Synapse Vault and become spendable credits after Gateway confirmation.",
  walletPromptNotice:
    "MetaMask may only show the contract interaction. Please verify the {{amount}} {{symbol}} amount and Synapse Vault address on this panel.",
  detailsLabel: "Details",
  vaultAddressLabel: "Vault address",
  tokenLabel: "Token",
  allowancePreapprovedLabel:
    "Existing allowance found. Authorization step skipped.",
  stepPermitTitle: "Permit authorization",
  stepPermitActive:
    "Wallet prompt: sign a gasless permit for this exact amount.",
  stepPermitDone: "Permit signature completed.",
  stepApproveTitle: "Approve USDC",
  stepApproveActive:
    "Wallet prompt: approve this exact amount for Synapse Vault.",
  stepApproveDone: "Approve transaction completed.",
  stepDepositTitle: "Deposit to Vault",
  stepDepositActive: "Wallet prompt: submit the vault deposit and pay gas.",
  stepDepositWaiting: "Complete authorization first.",
  hardwareWalletFallback:
    "Using a hardware wallet? Use Approve transaction instead.",
  permitTimedOut:
    "Wallet did not respond. If you use a hardware wallet, try Approve transaction instead.",
  progressAriaLabel: "Deposit progress",
  cancelLabel: "Cancel",
  processingLabel: "Processing...",
  closeDialogLabel: "Close deposit dialog",
};

function interpolateCopy(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, token: string) =>
    vars[token] === undefined ? "" : String(vars[token])
  );
}

function StepCard({
  title,
  description,
  state,
}: Readonly<{
  title: string;
  description: string;
  state: "done" | "active" | "waiting";
}>) {
  const isActive = state === "active";
  const isDone = state === "done";
  return (
    <article
      className={[
        "flex items-center gap-3 rounded-xl border p-3",
        isDone
          ? "border-green-500/50 bg-green-500/10 text-green-300"
          : isActive
          ? "border-blue-500/50 bg-blue-500/10 text-blue-300"
          : "border-white/10 bg-white/[0.03] text-gray-500",
      ].join(" ")}
    >
      {isActive ? (
        <RefreshCw className="h-5 w-5 animate-spin" />
      ) : (
        <CheckCircle2 className="h-5 w-5" />
      )}
      <div className="text-sm">
        <p className="font-bold">{title}</p>
        <p className="text-xs leading-5 opacity-80">{description}</p>
      </div>
    </article>
  );
}

export default function DepositUsdcModal({
  isOpen,
  title = "Purchase credits",
  description = "Deposit USDC into Synapse Vault to top up prepaid credits for API usage.",
  confirmationNotice = "Blockchain confirmation is in progress. Credits usually appear within 1-2 minutes. You can keep this page open or refresh later.",
  amount,
  presetAmounts = [5, 25, 100, 250, 500],
  onAmountChange,
  error,
  step,
  flowMode,
  primaryAction,
  isReviewing,
  isPending,
  isConfirming,
  walletAddress,
  vaultAddress,
  tokenName,
  tokenSymbol,
  walletUsdcBalance,
  nativeGasBalance,
  nativeGasSymbol,
  networkLabel,
  preflightError = "",
  canSubmit,
  shortAddress,
  copy,
  onClose,
  onConfirm,
  onUseApproveFallback,
}: Readonly<DepositUsdcModalProps>) {
  if (!isOpen) {
    return null;
  }

  const labels = { ...DEFAULT_COPY, ...copy };
  const amountNumber = Number(amount);
  const normalizedAmount = Number.isFinite(amountNumber)
    ? amountNumber.toFixed(2)
    : "0.00";
  const visibleError = error || preflightError;
  const isBusy =
    step === "checking" ||
    step === "switching_network" ||
    step === "approving" ||
    step === "signing_permit" ||
    step === "executing_tx" ||
    isPending ||
    isConfirming;
  const primaryLabel =
    primaryAction === "checking"
      ? labels.checkingWalletLabel
      : primaryAction === "switchNetwork"
      ? labels.switchNetworkLabel
      : primaryAction === "insufficientUsdc"
      ? labels.insufficientUsdcLabel
      : primaryAction === "insufficientGas"
      ? labels.insufficientGasLabel
      : isReviewing
      ? labels.continueToWalletLabel
      : labels.reviewDepositLabel;

  const permitState =
    step === "signing_permit"
      ? "active"
      : step === "executing_tx" || isConfirming
      ? "done"
      : "waiting";
  const approveState =
    step === "approving"
      ? "active"
      : flowMode === "approveFallback" &&
        (step === "executing_tx" || isConfirming)
      ? "done"
      : "waiting";
  const depositState =
    step === "executing_tx" || isConfirming ? "active" : "waiting";
  const depositWaitingDescription =
    flowMode === "preapproved"
      ? labels.stepDepositActive
      : labels.stepDepositWaiting;
  const vaultDisplayValue = `${labels.synapseVaultLabel} · ${shortAddress(
    vaultAddress
  )}`;

  return (
    <dialog
      open
      className="x-dialog-shell x-modal-overlay"
      aria-labelledby="deposit-usdc-title"
    >
      <section className="x-modal-flat x-modal-surface max-w-lg shadow-2xl">
        <header className="x-modal-header">
          <div className="x-modal-header-copy">
            <h3
              id="deposit-usdc-title"
              className="text-xl font-bold text-white"
            >
              {title}
            </h3>
            <p className="mt-2 text-sm text-gray-400">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="x-modal-close"
            aria-label={labels.closeDialogLabel}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="x-modal-body">
          {!isReviewing ? (
            <label className="block">
              <div className="mb-4 flex flex-wrap gap-2">
                {presetAmounts.map((preset) => {
                  const presetLabel = `$${preset.toFixed(2)}`;
                  const isSelected = Number(amount) === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => onAmountChange(String(preset))}
                      disabled={isBusy}
                      className={[
                        "inline-flex h-9 items-center justify-center rounded-full px-4 text-[14px] font-medium transition",
                        isSelected
                          ? "bg-white text-black"
                          : "bg-white/[0.04] text-[#f5f5f7] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] hover:bg-white/[0.08]",
                        isBusy ? "cursor-not-allowed opacity-50" : "",
                      ].join(" ")}
                    >
                      {presetLabel}
                    </button>
                  );
                })}
              </div>

              <span className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                {labels.amountLabel}
              </span>
              <div className="relative mt-1">
                <input
                  type="number"
                  value={amount}
                  onChange={(event) => onAmountChange(event.target.value)}
                  disabled={isBusy}
                  className="w-full rounded-xl border border-gray-700 bg-black px-4 py-3 text-lg font-bold text-white outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/50 disabled:opacity-50"
                  min="1"
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-4">
                  <span className="font-bold text-gray-500">USDC</span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                  <p className="text-gray-500">{labels.walletUsdcLabel}</p>
                  <p className="mt-1 font-mono font-semibold text-white">
                    {walletUsdcBalance.toFixed(2)} USDC
                  </p>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                  <p className="text-gray-500">{labels.nativeGasLabel}</p>
                  <p className="mt-1 font-mono font-semibold text-white">
                    {nativeGasBalance.toFixed(4)} {nativeGasSymbol}
                  </p>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                  <p className="text-gray-500">{labels.networkLabel}</p>
                  <p className="mt-1 truncate font-mono font-semibold text-white">
                    {networkLabel}
                  </p>
                </div>
              </div>
            </label>
          ) : (
            <div className="space-y-5">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center">
                <p className="text-4xl font-black tracking-normal text-white">
                  {normalizedAmount} {tokenSymbol}
                </p>
                <div className="mt-5 flex items-center justify-center gap-3 text-sm text-gray-300">
                  <span>{labels.fromYourWalletLabel}</span>
                  <CopyableValue
                    value={walletAddress}
                    displayValue={shortAddress(walletAddress)}
                    label={labels.fromYourWalletLabel}
                    valueClassName="font-mono text-white"
                  />
                  <ChevronRight className="h-4 w-4 text-gray-500" />
                  <span>{labels.toSynapseVaultLabel}</span>
                  <CopyableValue
                    value={vaultAddress}
                    displayValue={vaultDisplayValue}
                    label={labels.vaultAddressLabel}
                    valueClassName="font-semibold text-cyan-200"
                  />
                </div>
              </div>

              <p className="rounded-xl border border-cyan-900/50 bg-cyan-950/25 px-4 py-3 text-sm leading-6 text-cyan-50">
                {interpolateCopy(labels.expectedResult, {
                  amount: normalizedAmount,
                  symbol: tokenSymbol,
                })}
              </p>

              <details className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-gray-300">
                <summary className="cursor-pointer font-semibold text-gray-200">
                  {labels.detailsLabel}
                </summary>
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-gray-500">
                      {labels.vaultAddressLabel}
                    </span>
                    <CopyableValue
                      value={vaultAddress}
                      displayValue={shortAddress(vaultAddress)}
                      label={labels.vaultAddressLabel}
                      valueClassName="font-mono text-cyan-200"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-gray-500">{labels.tokenLabel}</span>
                    <span className="text-right font-semibold text-gray-200">
                      {tokenName} ({tokenSymbol})
                    </span>
                  </div>
                </div>
              </details>

              {flowMode === "preapproved" ? (
                <p className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-100">
                  {labels.allowancePreapprovedLabel}
                </p>
              ) : null}

              <section
                className="space-y-3"
                aria-label={labels.progressAriaLabel}
              >
                {flowMode === "permit" ? (
                  <StepCard
                    title={labels.stepPermitTitle}
                    description={
                      step === "signing_permit"
                        ? labels.stepPermitActive
                        : labels.stepPermitDone
                    }
                    state={permitState}
                  />
                ) : null}
                {flowMode === "approveFallback" ? (
                  <StepCard
                    title={labels.stepApproveTitle}
                    description={
                      step === "approving"
                        ? labels.stepApproveActive
                        : labels.stepApproveDone
                    }
                    state={approveState}
                  />
                ) : null}
                <StepCard
                  title={labels.stepDepositTitle}
                  description={
                    depositState === "active"
                      ? labels.stepDepositActive
                      : depositWaitingDescription
                  }
                  state={depositState}
                />
              </section>

              {step === "permit_timed_out" ? (
                <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-100">
                  {labels.permitTimedOut}
                </p>
              ) : null}
              {flowMode === "permit" || step === "permit_timed_out" ? (
                <button
                  type="button"
                  onClick={onUseApproveFallback}
                  className="text-left text-sm font-semibold text-cyan-200 underline-offset-4 hover:underline"
                >
                  {labels.hardwareWalletFallback}
                </button>
              ) : null}
              {step === "executing_tx" || isConfirming ? (
                <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs leading-5 text-amber-100">
                  {confirmationNotice}
                </p>
              ) : null}
            </div>
          )}

          {visibleError ? (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {visibleError}
            </div>
          ) : null}

          {isReviewing ? (
            <p className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-5 text-gray-300">
              {interpolateCopy(labels.walletPromptNotice, {
                amount: normalizedAmount,
                symbol: tokenSymbol,
              })}
            </p>
          ) : null}

          <div className="mt-8 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending || isConfirming}
              className="px-4 py-2 text-sm font-semibold text-gray-300 transition-colors hover:text-white disabled:opacity-50"
            >
              {labels.cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!canSubmit}
              className="flex items-center gap-2 rounded-xl bg-green-500 px-6 py-2 text-sm font-bold text-black transition-colors hover:bg-green-400 disabled:opacity-50"
            >
              {isBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
              {isBusy ? labels.processingLabel : primaryLabel}
            </button>
          </div>
        </div>
      </section>
    </dialog>
  );
}
