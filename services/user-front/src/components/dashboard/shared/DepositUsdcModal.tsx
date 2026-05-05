"use client";

import { AlertCircle, CheckCircle2, RefreshCw, X } from "lucide-react";
import CopyableValue from "@/components/xui/CopyableValue";

type DepositUsdcModalCopy = {
  amountLabel: string;
  walletUsdcLabel: string;
  nativeGasLabel: string;
  networkLabel: string;
  transactionSummaryLabel: string;
  fromWalletLabel: string;
  toVaultLabel: string;
  depositAmountLabel: string;
  permitAllowanceLabel: string;
  expectationTitle: string;
  expectationPermit: string;
  expectationGas: string;
  expectationSync: string;
  stepPermitTitle: string;
  stepPermitActive: string;
  stepPermitDone: string;
  stepDepositTitle: string;
  stepDepositActive: string;
  stepDepositWaiting: string;
  progressAriaLabel: string;
  cancelLabel: string;
  processingLabel: string;
  confirmLabel: string;
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
  step: "input" | "signing_permit" | "executing_tx";
  isPending: boolean;
  isConfirming: boolean;
  walletAddress?: string;
  vaultAddress: string;
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
};

const DEFAULT_COPY: DepositUsdcModalCopy = {
  amountLabel: "Amount (USDC)",
  walletUsdcLabel: "Wallet USDC",
  nativeGasLabel: "Native gas balance",
  networkLabel: "Network",
  transactionSummaryLabel: "Transaction summary",
  fromWalletLabel: "From wallet",
  toVaultLabel: "To vault contract",
  depositAmountLabel: "Deposit amount",
  permitAllowanceLabel: "Permit allowance",
  expectationTitle: "Before you confirm",
  expectationPermit:
    "The permit signature is gasless and authorizes only this USDC amount.",
  expectationGas:
    "The vault deposit is an on-chain transaction and requires native gas.",
  expectationSync:
    "Spendable credits appear after Gateway indexes and confirms the deposit.",
  stepPermitTitle: "Step 1: Permit authorization",
  stepPermitActive:
    "Wallet prompt: sign a gasless permit for the exact amount.",
  stepPermitDone: "Permit signature completed.",
  stepDepositTitle: "Step 2: Vault deposit transaction",
  stepDepositActive:
    "Wallet prompt: submit the on-chain vault deposit and pay gas.",
  stepDepositWaiting: "Waiting for permit authorization.",
  progressAriaLabel: "Deposit progress",
  cancelLabel: "Cancel",
  processingLabel: "Processing...",
  confirmLabel: "Confirm Deposit",
  closeDialogLabel: "Close deposit dialog",
};

export default function DepositUsdcModal({
  isOpen,
  title = "Deposit USDC",
  description = "Deposit USDC into your vault to pay for Synapse calls without signing each request.",
  confirmationNotice = "Blockchain confirmation is in progress. Credits usually appear within 1-2 minutes. You can keep this page open or refresh later.",
  amount,
  presetAmounts = [5, 25, 100, 250, 500],
  onAmountChange,
  error,
  step,
  isPending,
  isConfirming,
  walletAddress,
  vaultAddress,
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
}: Readonly<DepositUsdcModalProps>) {
  if (!isOpen) {
    return null;
  }

  const normalizedAmount = Number.isFinite(Number(amount))
    ? Number(amount).toFixed(2)
    : "0.00";
  const isBusy = step !== "input" || isPending || isConfirming;
  const labels = { ...DEFAULT_COPY, ...copy };
  const visibleError = error || preflightError;

  return (
    <dialog
      open
      className="x-dialog-shell x-modal-overlay"
      aria-labelledby="deposit-usdc-title"
    >
      <section className="x-modal-flat x-modal-surface max-w-md shadow-2xl">
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
                disabled={step !== "input"}
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

          {visibleError ? (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {visibleError}
            </div>
          ) : null}

          <div className="mt-5 rounded-xl border border-cyan-900/50 bg-cyan-950/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
              {labels.transactionSummaryLabel}
            </p>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="text-gray-400">{labels.fromWalletLabel}</span>
                <CopyableValue
                  value={walletAddress}
                  displayValue={shortAddress(walletAddress)}
                  label={labels.fromWalletLabel}
                  valueClassName="font-mono text-gray-200"
                />
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-gray-400">{labels.toVaultLabel}</span>
                <CopyableValue
                  value={vaultAddress}
                  displayValue={shortAddress(vaultAddress)}
                  label={labels.toVaultLabel}
                  valueClassName="font-mono text-cyan-300"
                />
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-gray-400">
                  {labels.depositAmountLabel}
                </span>
                <span className="font-bold text-white">
                  {normalizedAmount} USDC
                </span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-gray-400">
                  {labels.permitAllowanceLabel}
                </span>
                <span className="font-semibold text-cyan-200">
                  {normalizedAmount} USDC
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-300">
              {labels.expectationTitle}
            </p>
            <ul className="mt-3 space-y-2 text-xs leading-5 text-gray-400">
              <li>{labels.expectationPermit}</li>
              <li>{labels.expectationGas}</li>
              <li>{labels.expectationSync}</li>
            </ul>
          </div>

          {isBusy && (
            <section
              className="mt-6 space-y-3"
              aria-label={labels.progressAriaLabel}
            >
              <article
                className={`flex items-center gap-3 rounded-xl border p-3 ${
                  step === "signing_permit"
                    ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                    : "border-green-500/50 bg-green-500/10 text-green-400"
                }`}
              >
                {step === "signing_permit" ? (
                  <RefreshCw className="h-5 w-5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-5 w-5" />
                )}
                <div className="text-sm">
                  <p className="font-bold">{labels.stepPermitTitle}</p>
                  <p className="text-xs opacity-80">
                    {step === "signing_permit"
                      ? labels.stepPermitActive
                      : labels.stepPermitDone}
                  </p>
                </div>
              </article>

              <article
                className={`flex items-center gap-3 rounded-xl border p-3 ${
                  step === "executing_tx" || isConfirming
                    ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                    : "border-gray-800 bg-gray-800/30 text-gray-500"
                }`}
              >
                {step === "executing_tx" || isConfirming ? (
                  <RefreshCw className="h-5 w-5 animate-spin" />
                ) : (
                  <AlertCircle className="h-5 w-5" />
                )}
                <div className="text-sm">
                  <p className="font-bold">{labels.stepDepositTitle}</p>
                  <p className="text-xs opacity-80">
                    {step === "executing_tx" || isConfirming
                      ? labels.stepDepositActive
                      : labels.stepDepositWaiting}
                  </p>
                </div>
              </article>
              {step === "executing_tx" || isConfirming ? (
                <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs leading-5 text-amber-100">
                  {confirmationNotice}
                </p>
              ) : null}
            </section>
          )}

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
              {isPending || isConfirming ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : null}
              {isBusy
                ? labels.processingLabel
                : `${labels.confirmLabel} ${normalizedAmount} USDC`}
            </button>
          </div>
        </div>
      </section>
    </dialog>
  );
}
