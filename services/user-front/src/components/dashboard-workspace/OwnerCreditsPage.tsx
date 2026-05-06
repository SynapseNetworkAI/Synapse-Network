"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CircleAlert, Info } from "lucide-react";
import {
  useAccount,
  useChainId,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import toast from "react-hot-toast";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useAuth } from "@/components/WalletAuthGuard";
import ConsumerWithdrawPendingTooltip from "@/components/dashboard-workspace/ConsumerWithdrawPendingTooltip";
import SupportContactPanel from "@/components/shared/SupportContactPanel";
import { useOwnerData } from "@/hooks/useOwnerData";
import { useVaultDeposit } from "@/hooks/useVaultDeposit";
import {
  clearAuthSession,
  WALLET_SESSION_MISSING_MESSAGE,
} from "@/utils/authSession";
import {
  completeV2Refund,
  failV2Refund,
  getOwnerSpendingLimit,
  listConsumerWithdrawals,
  redeemCreditVoucher,
  requestConsumerWithdraw,
  ConsumerWithdrawApiError,
  type ConsumerWithdrawIntent,
  type OwnerSpendingLimit,
  type RefundIntentRecord,
} from "@/utils/balanceApi";
import {
  calculateSpendRatio,
  getBillingCycleWindow,
} from "@/utils/creditsSpendCap";
import {
  formatPercent,
  formatPlainAmount,
  formatUsd,
} from "@/utils/ownerCreditsFormat";
import {
  compareMoneyStrings,
  moneyStringToNumber,
  normalizeMoneyString,
  type MoneyString,
} from "@/utils/money";
import { isWithdrawTicketNearExpiry } from "@/utils/providerWithdrawApi";
import { normalizeWithdrawWalletError } from "@/utils/providerWithdrawWallet";
import { isWalletUserRejectedError } from "@/utils/walletActionErrors";
import SynapseCoreABI from "@/SynapseCoreABI.json";

const DepositUsdcModal = dynamic(
  () => import("@/components/dashboard/shared/DepositUsdcModal"),
  { ssr: false }
);
const ManageSpendCapModal = dynamic(
  () => import("@/components/dashboard-workspace/ManageSpendCapModal"),
  { ssr: false }
);
const RedeemVoucherModal = dynamic(
  () => import("@/components/dashboard-workspace/RedeemVoucherModal"),
  { ssr: false }
);

// ── Withdraw Balance Modal ───────────────────────────────────────────────────
type WithdrawModalProps = {
  availableBalance: number;
  withdrawableBalance: number;
  minWithdrawAmount: number;
  userAddress: string;
  onClose: () => void;
  onSuccess: (result: ConsumerWithdrawIntent) => Promise<void>;
};

function normalizeSignature(signature: string): `0x${string}` {
  const normalized = signature.startsWith("0x") ? signature : `0x${signature}`;
  return normalized as `0x${string}`;
}

type WithdrawStep =
  | "form"
  | "signing"
  | "onchain"
  | "confirming"
  | "completing"
  | "done";

const ACTIVE_WITHDRAWAL_STATUSES = new Set([
  "REQUESTED",
  "SIGNED",
  "BROADCASTED",
  "PENDING",
  "PENDING_MANUAL_REVIEW",
  "APPROVED_AUTO",
  "APPROVED_MANUAL",
  "PROCESSING",
  "TICKET_READY",
]);

const WITHDRAWAL_PENDING_BALANCE_STATUSES = new Set([
  "REQUESTED",
  "SIGNED",
  "BROADCASTED",
  "PENDING",
  "APPROVED_AUTO",
  "APPROVED_MANUAL",
  "PROCESSING",
  "TICKET_READY",
]);

function normalizeWithdrawalStatus(status?: string | null): string {
  return String(status || "")
    .trim()
    .toUpperCase();
}

function isActiveWithdrawalStatus(status?: string | null): boolean {
  return ACTIVE_WITHDRAWAL_STATUSES.has(normalizeWithdrawalStatus(status));
}

function isWithdrawalPendingBalanceStatus(status?: string | null): boolean {
  return WITHDRAWAL_PENDING_BALANCE_STATUSES.has(
    normalizeWithdrawalStatus(status)
  );
}

function resolveConsumerWithdrawErrorMessage(
  error: unknown,
  t: ReturnType<typeof useLanguage>["t"]
): string {
  if (error instanceof ConsumerWithdrawApiError) {
    if (
      error.code === "CHAIN_RPC_UNAVAILABLE" ||
      error.code === "WITHDRAW_TICKET_SIGNING_FAILED"
    ) {
      return t("creditsPage.consumerWithdrawChainRpcUnavailable");
    }
    if (error.code === "WITHDRAW_CONTRACT_NOT_CONFIGURED") {
      return t("creditsPage.consumerWithdrawContractNotConfigured");
    }
    if (error.code === "MIN_WITHDRAWAL_AMOUNT_NOT_MET") {
      return t("creditsPage.consumerWithdrawMinAmountNotMet");
    }
    if (error.code === "AMOUNT_TOO_LOW_FOR_FEE") {
      return t("creditsPage.consumerWithdrawAmountTooLowForFee");
    }
    if (error.code === "INSUFFICIENT_CONSUMER_BALANCE") {
      return t("creditsPage.consumerWithdrawInsufficientBalance");
    }
    if (error.code === "INSUFFICIENT_MATURE_CONSUMER_BALANCE") {
      return t("creditsPage.consumerWithdrawMatureBalanceRequired");
    }
    return t("creditsPage.consumerWithdrawRequestFailed");
  }

  return t("creditsPage.consumerWithdrawRequestFailed");
}

function WithdrawBalanceModal({
  availableBalance,
  withdrawableBalance,
  minWithdrawAmount,
  userAddress,
  onClose,
  onSuccess,
}: Readonly<WithdrawModalProps>) {
  const { t } = useLanguage();
  const [amount, setAmount] = useState(
    String(withdrawableBalance > 0 ? withdrawableBalance.toFixed(2) : "")
  );
  const [reason, setReason] = useState("");
  const [step, setStep] = useState<WithdrawStep>("form");
  const [withdrawResult, setWithdrawResult] =
    useState<ConsumerWithdrawIntent | null>(null);
  const chainId = useChainId();
  const { data: txHash, writeContractAsync } = useWriteContract();
  const {
    isSuccess: isTxConfirmed,
    isError: isTxFailed,
    error: txReceiptError,
  } = useWaitForTransactionReceipt({ hash: txHash, chainId });
  const completingRef = useRef(false);
  const failingRef = useRef(false);

  const syncFailedWithdrawal = useCallback(
    async (
      reasonCode: string,
      fallbackMessage: string,
      maybeTxHash?: string,
      activeResult?: ConsumerWithdrawIntent | null,
      tone: "error" | "neutral" = "error"
    ) => {
      const target = activeResult ?? withdrawResult;
      if (!target?.withdrawId || failingRef.current) {
        return;
      }
      failingRef.current = true;
      try {
        await failV2Refund(userAddress, target.withdrawId, {
          reasonCode,
          message: fallbackMessage,
          txHash: maybeTxHash,
        });
        if (tone === "neutral") {
          toast(fallbackMessage, { icon: "ℹ️" });
        } else {
          toast.error(fallbackMessage);
        }
        await onSuccess({ ...target, status: "FAILED" });
      } catch (error) {
        console.error(
          "Failed to release consumer withdrawal after wallet rejection:",
          error
        );
        toast.error(t("creditsPage.consumerWithdrawReleaseFailed"));
      } finally {
        setStep("form");
        onClose();
      }
    },
    [onClose, onSuccess, t, userAddress, withdrawResult]
  );

  // Step: tx confirmed → call backend /complete
  useEffect(() => {
    if (
      !isTxConfirmed ||
      !txHash ||
      !withdrawResult?.withdrawId ||
      completingRef.current
    )
      return;
    completingRef.current = true;
    setStep("completing");
    const complete = async () => {
      try {
        await completeV2Refund(userAddress, withdrawResult.withdrawId, txHash);
        toast.success(
          t("creditsPage.consumerWithdrawSubmitted", {
            amount: formatPlainAmount(withdrawResult.netUsdc),
          })
        );
        setStep("done");
        await onSuccess({ ...withdrawResult, status: "COMPLETED" });
        onClose();
      } catch {
        toast.error(t("creditsPage.consumerWithdrawBackendSyncFailed"));
        onClose();
      }
    };
    void complete();
  }, [
    isTxConfirmed,
    txHash,
    withdrawResult,
    userAddress,
    onSuccess,
    onClose,
    t,
  ]);

  // Step: tx failed
  useEffect(() => {
    if (!isTxFailed || !withdrawResult || !txHash) return;
    void syncFailedWithdrawal(
      "TX_FAILED",
      normalizeWithdrawWalletError(txReceiptError, {
        fallback: t("creditsPage.consumerWithdrawTxFailed"),
      }),
      txHash
    );
  }, [
    isTxFailed,
    syncFailedWithdrawal,
    t,
    txHash,
    txReceiptError,
    withdrawResult,
  ]);

  const handleSubmit = async () => {
    const normalizedAmount = normalizeMoneyString(amount, "");
    const num = moneyStringToNumber(normalizedAmount);
    if (!normalizedAmount || !Number.isFinite(num) || num <= 0) {
      toast.error(t("creditsPage.consumerWithdrawInvalidAmount"));
      return;
    }
    if (
      compareMoneyStrings(
        normalizedAmount,
        normalizeMoneyString(availableBalance)
      ) > 0
    ) {
      toast.error(
        t("creditsPage.consumerWithdrawAmountExceeds", {
          amount: availableBalance.toFixed(2),
        })
      );
      return;
    }
    if (
      compareMoneyStrings(
        normalizedAmount,
        normalizeMoneyString(withdrawableBalance)
      ) > 0
    ) {
      toast.error(
        t("creditsPage.consumerWithdrawAmountExceeds", {
          amount: withdrawableBalance.toFixed(2),
        })
      );
      return;
    }

    setStep("signing");
    let createdResult: ConsumerWithdrawIntent | null = null;
    try {
      const result = await requestConsumerWithdraw(userAddress, {
        amountUsdc: normalizedAmount,
        reason: reason.trim() || undefined,
      });
      createdResult = result;
      setWithdrawResult(result);
      await onSuccess(result);

      if (result.existingWithdrawal) {
        if (!result.ticket || result.status === "PENDING_MANUAL_REVIEW") {
          toast(t("creditsPage.consumerWithdrawPendingExists"), {
            icon: "⏳",
            duration: 6000,
          });
          onClose();
          return;
        }
        toast(t("creditsPage.consumerWithdrawResumingPending"), {
          icon: "⏳",
          duration: 6000,
        });
      } else if (result.status === "PENDING_MANUAL_REVIEW") {
        toast.success(
          t("creditsPage.consumerWithdrawUnderReview", {
            reason: result.riskReasonCode || "manual review",
          })
        );
        onClose();
        return;
      }

      if (!result.ticket) {
        toast.error(t("creditsPage.consumerWithdrawTicketUnavailable"));
        onClose();
        return;
      }

      setStep("onchain");
      const ticket = result.ticket;
      const contractAddress = (ticket.contractAddress || "") as `0x${string}`;
      if (isWithdrawTicketNearExpiry(ticket)) {
        toast.error(t("creditsPage.consumerWithdrawTicketExpiring"));
        onClose();
        return;
      }

      await writeContractAsync({
        address: contractAddress,
        abi: SynapseCoreABI,
        chainId: ticket.chainId || chainId,
        functionName: "withdraw",
        args: [
          BigInt(ticket.amount),
          BigInt(ticket.fee),
          ticket.ticketId,
          BigInt(ticket.deadline),
          normalizeSignature(ticket.signature),
        ],
      });

      setStep("confirming");
      toast.success(t("creditsPage.consumerWithdrawTxSubmitted"));
    } catch (err) {
      const requestMessage = resolveConsumerWithdrawErrorMessage(err, t);
      const walletMessage = normalizeWithdrawWalletError(err, {
        fallback: requestMessage,
      });
      if (isWalletUserRejectedError(err)) {
        await syncFailedWithdrawal(
          "WALLET_REJECTED",
          t("walletActions.requestCancelled"),
          undefined,
          createdResult,
          "neutral"
        );
      } else {
        if (createdResult?.withdrawId) {
          await syncFailedWithdrawal(
            "WITHDRAW_SUBMISSION_FAILED",
            walletMessage,
            undefined,
            createdResult
          );
        } else {
          toast.error(requestMessage);
        }
      }
      setStep("form");
    }
  };

  const submitting = step !== "form";
  const withdrawDisabled =
    submitting || withdrawableBalance < minWithdrawAmount;
  const showMaturityGapWarning = availableBalance > withdrawableBalance;
  let buttonLabel = t("creditsPage.consumerWithdrawAction");
  if (step === "signing")
    buttonLabel = t("creditsPage.consumerWithdrawRequesting");
  else if (step === "onchain")
    buttonLabel = t("creditsPage.consumerWithdrawConfirmWallet");
  else if (step === "confirming")
    buttonLabel = t("creditsPage.consumerWithdrawConfirmingChain");
  else if (step === "completing")
    buttonLabel = t("creditsPage.consumerWithdrawCompleting");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
      onClick={submitting ? undefined : onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[#2a2a2a] bg-[#111] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-base font-semibold text-white">
          {t("creditsPage.consumerWithdrawTitle")}
        </h3>
        <p className="mb-4 text-sm text-[#86868b]">
          {t("creditsPage.consumerWithdrawDescription", {
            amount: withdrawableBalance.toFixed(2),
          })}
        </p>

        <div className="space-y-4">
          {showMaturityGapWarning ? (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
              {t("creditsPage.consumerWithdrawMaturityWarning")}
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-[#86868b]">
              {t("creditsPage.consumerWithdrawAmountLabel")}
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                step="0.01"
                max={withdrawableBalance}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={submitting}
                className="flex-1 rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-[#22c55e]/50 focus:outline-none disabled:opacity-40"
              />
              <button
                type="button"
                onClick={() => setAmount(withdrawableBalance.toFixed(2))}
                disabled={submitting}
                className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-xs text-[#9ca3af] hover:text-white disabled:opacity-40"
              >
                {t("creditsPage.consumerWithdrawMax")}
              </button>
            </div>
            <p className="mt-2 text-xs leading-5 text-[#71767b]">
              {t("creditsPage.consumerWithdrawMinimumRule", {
                amount: minWithdrawAmount.toFixed(2),
              })}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-[#86868b]">
              {t("creditsPage.consumerWithdrawReasonLabel")}
            </label>
            <textarea
              rows={2}
              maxLength={256}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              placeholder={t("creditsPage.consumerWithdrawReasonPlaceholder")}
              className="w-full rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 text-sm text-white placeholder:text-[#555] focus:border-[#22c55e]/50 focus:outline-none disabled:opacity-40"
            />
          </div>

          <div className="rounded-xl border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-xs text-[#86868b] space-y-1">
            <p>{t("creditsPage.consumerWithdrawManualReviewHint")}</p>
            <p>{t("creditsPage.consumerWithdrawFrequencyHint")}</p>
            <p>{t("creditsPage.consumerWithdrawGasHint")}</p>
          </div>

          {step !== "form" && step !== "done" && (
            <div className="rounded-xl border border-[#22c55e]/30 bg-[#22c55e]/5 px-3 py-2 text-xs text-[#22c55e]">
              {step === "signing" &&
                t("creditsPage.consumerWithdrawProgressSigning")}
              {step === "onchain" &&
                t("creditsPage.consumerWithdrawProgressOnchain")}
              {step === "confirming" &&
                t("creditsPage.consumerWithdrawProgressConfirming")}
              {step === "completing" &&
                t("creditsPage.consumerWithdrawProgressCompleting")}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              disabled={submitting}
              className="flex-1 rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] py-2 text-sm text-[#9ca3af] hover:bg-[#151515] disabled:opacity-40"
            >
              {t("creditsPage.depositCancel")}
            </button>
            <button
              onClick={handleSubmit}
              disabled={withdrawDisabled}
              className="flex-1 rounded-xl bg-[#22c55e] py-2 text-sm font-semibold text-black hover:bg-[#16a34a] disabled:opacity-40"
            >
              {submitting
                ? buttonLabel
                : t("creditsPage.consumerWithdrawAction")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

function CreditBucketRow({
  label,
  amount,
  hint,
  info,
  tone = "default",
}: Readonly<{
  label: string;
  amount: number;
  hint?: string;
  info?: string;
  tone?: "default" | "pending" | "frozen";
}>) {
  const amountTone =
    tone === "pending"
      ? "text-amber-200"
      : tone === "frozen"
      ? "text-sky-200"
      : "text-white";

  return (
    <div className="flex flex-col gap-1 rounded-[10px] border border-white/[0.06] bg-black/20 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex items-center gap-1.5">
          <p className="text-[13px] leading-5 text-[#9ca3af]">{label}</p>
          {info ? (
            <Info
              className="h-[13px] w-[13px] text-[#71767b]"
              aria-label={info}
            >
              <title>{info}</title>
            </Info>
          ) : null}
        </div>
        {hint ? (
          <p className="mt-1 max-w-[420px] text-[12px] leading-5 text-[#71767b]">
            {hint}
          </p>
        ) : null}
      </div>
      <p
        className={`font-mono text-[15px] font-semibold leading-6 ${amountTone}`}
      >
        {formatUsd(amount)}
      </p>
    </div>
  );
}

export default function OwnerCreditsPage() {
  const { t } = useLanguage();
  const { address: userAddress, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { isSessionAuthenticated, authorize } = useAuth();
  const { stats, handleRefresh, isBootstrapping } = useOwnerData();
  const optimisticStorageKey = userAddress
    ? `synapse_credits_optimistic_${userAddress.toLowerCase()}`
    : null;
  const [spendingLimit, setSpendingLimit] = useState<OwnerSpendingLimit | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [isSpendCapLoading, setIsSpendCapLoading] = useState(false);
  const [isSpendCapAvailable, setIsSpendCapAvailable] = useState(true);
  const [isSpendCapModalOpen, setIsSpendCapModalOpen] = useState(false);
  const [isRedeemVoucherModalOpen, setIsRedeemVoucherModalOpen] =
    useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [pendingWithdrawal, setPendingWithdrawal] =
    useState<RefundIntentRecord | null>(null);
  const [optimisticBalanceOverride, setOptimisticBalanceOverride] = useState<{
    withdrawId: string;
    amountUsdc: MoneyString;
    targetBalance: MoneyString;
  } | null>(null);

  // Restore optimistic override from sessionStorage on mount / address change
  // so that a page refresh still shows the pending-withdrawal balance.
  useEffect(() => {
    if (!optimisticStorageKey) return;
    try {
      const stored = sessionStorage.getItem(optimisticStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as {
          withdrawId: string;
          amountUsdc: MoneyString;
          targetBalance: MoneyString;
        };
        if (parsed.withdrawId && typeof parsed.targetBalance === "string") {
          setOptimisticBalanceOverride(parsed);
        }
      }
    } catch {
      /* ignore */
    }
  }, [optimisticStorageKey]);

  const fetchPendingWithdrawal = useCallback(async () => {
    if (!isConnected || !userAddress || !isSessionAuthenticated) {
      setPendingWithdrawal(null);
      return;
    }
    try {
      const rows = await listConsumerWithdrawals(userAddress);
      const active =
        rows.find((row) => isActiveWithdrawalStatus(row.status)) ?? null;
      setPendingWithdrawal(active);
    } catch {
      setPendingWithdrawal(null);
    }
  }, [isConnected, isSessionAuthenticated, userAddress]);

  useEffect(() => {
    void fetchPendingWithdrawal();
  }, [fetchPendingWithdrawal]);

  const fetchSpendingLimit = useCallback(async () => {
    if (!isConnected || !userAddress || !isSessionAuthenticated) {
      setSpendingLimit(null);
      setIsSpendCapLoading(false);
      setIsSpendCapAvailable(true);
      return;
    }

    try {
      setIsSpendCapLoading(true);
      setError(null);
      const nextLimit = await getOwnerSpendingLimit(userAddress);
      setSpendingLimit(nextLimit);
      setIsSpendCapAvailable(true);
    } catch (err) {
      if (
        err instanceof Error &&
        err.message === WALLET_SESSION_MISSING_MESSAGE
      ) {
        clearAuthSession();
        setError(t("creditsPage.signInBeforePurchase"));
        return;
      }
      console.warn(
        "Owner spending limit endpoint unavailable, falling back to no-cap UI:",
        err
      );
      setSpendingLimit(null);
      setIsSpendCapAvailable(false);
    } finally {
      setIsSpendCapLoading(false);
    }
  }, [isConnected, isSessionAuthenticated, t, userAddress]);

  useEffect(() => {
    void fetchSpendingLimit();
  }, [fetchSpendingLimit]);

  const billingCycle = useMemo(() => getBillingCycleWindow(), []);

  const creditSummary = useMemo(() => {
    const treasuryAvailable = moneyStringToNumber(
      stats.consumerAvailableBalance ?? stats.ownerBalance
    );
    const withdrawableBalance = moneyStringToNumber(
      stats.consumerWithdrawableBalance ?? "0"
    );
    const minWithdrawAmount = moneyStringToNumber(
      stats.consumerWithdrawMinUsdc ?? "10"
    );
    const totalPendingBalance = moneyStringToNumber(
      stats.consumerPendingBalance
    );
    const withdrawalPendingBalance =
      pendingWithdrawal &&
      isWithdrawalPendingBalanceStatus(pendingWithdrawal.status)
        ? Math.min(
            totalPendingBalance,
            moneyStringToNumber(pendingWithdrawal.amountUsdc ?? "0")
          )
        : 0;
    const depositPendingBalance = Math.max(
      0,
      totalPendingBalance - withdrawalPendingBalance
    );
    const frozenBalance = moneyStringToNumber(stats.consumerFrozenBalance);
    const currentSpend = moneyStringToNumber(
      spendingLimit?.currentCycleSpendUsdc ?? "0"
    );
    const billingCycleCap =
      typeof spendingLimit?.spendingLimitUsdc === "string"
        ? moneyStringToNumber(spendingLimit.spendingLimitUsdc)
        : null;
    const spendRatio = calculateSpendRatio(currentSpend, billingCycleCap);

    return {
      remainingBalance: treasuryAvailable,
      withdrawableBalance,
      minWithdrawAmount,
      depositPendingBalance,
      withdrawalPendingBalance,
      frozenBalance,
      currentSpend,
      billingCycleCap,
      spendRatio,
      remainingSpend:
        typeof spendingLimit?.remainingSpendUsdc === "string"
          ? moneyStringToNumber(spendingLimit.remainingSpendUsdc)
          : null,
    };
  }, [
    spendingLimit,
    pendingWithdrawal,
    stats.consumerAvailableBalance,
    stats.consumerFrozenBalance,
    stats.consumerPendingBalance,
    stats.consumerWithdrawableBalance,
    stats.consumerWithdrawMinUsdc,
    stats.ownerBalance,
  ]);

  const displayedRemainingBalance = useMemo(() => {
    if (!optimisticBalanceOverride) {
      return creditSummary.remainingBalance;
    }

    const serverBalance = creditSummary.remainingBalance;
    if (
      compareMoneyStrings(
        normalizeMoneyString(serverBalance),
        optimisticBalanceOverride.targetBalance
      ) <= 0
    ) {
      return serverBalance;
    }

    return moneyStringToNumber(optimisticBalanceOverride.targetBalance);
  }, [creditSummary.remainingBalance, optimisticBalanceOverride]);

  const clearOptimisticOverride = useCallback(() => {
    setOptimisticBalanceOverride(null);
    if (optimisticStorageKey) sessionStorage.removeItem(optimisticStorageKey);
  }, [optimisticStorageKey]);

  const depositHookCopy = useMemo(
    () => ({
      transactionFailed: t("creditsPage.depositTransactionFailed"),
      cancelled: t("creditsPage.depositCancelled"),
      gasInsufficient: t("creditsPage.depositGasInsufficient"),
      usdcInsufficient: t("creditsPage.depositUsdcInsufficient"),
      vaultRejectedWithError: t("creditsPage.depositVaultRejectedWithError"),
      vaultRejectedWithReason: t("creditsPage.depositVaultRejectedWithReason"),
      vaultRejectedCustomError: t(
        "creditsPage.depositVaultRejectedCustomError"
      ),
      vaultRejected: t("creditsPage.depositVaultRejected"),
      nonceOutOfDate: t("creditsPage.depositNonceOutOfDate"),
      walletReconnect: t("creditsPage.depositWalletReconnect"),
      walletSingleAccount: t("creditsPage.depositWalletSingleAccount"),
      walletUnstable: t("creditsPage.depositWalletUnstable"),
      invalidAmount: t("creditsPage.depositInvalidAmount"),
      minDepositAmountNotMet: t("creditsPage.depositMinAmountNotMet"),
      insufficientWalletUsdc: t("creditsPage.depositInsufficientWalletUsdc"),
      nativeGasRequired: t("creditsPage.depositNativeGasRequired"),
      gatewayBalanceSynced: t("creditsPage.depositGatewayBalanceSynced"),
      gatewayStillSyncing: t("creditsPage.depositGatewayStillSyncing"),
      depositConfirmedSyncing: t("creditsPage.depositConfirmedSyncing"),
      connectWalletFirst: t("creditsPage.depositConnectWalletFirst"),
      cancelledToast: t("creditsPage.depositCancelledToast"),
      insufficientFundsRetry: t("creditsPage.depositInsufficientFundsRetry"),
      topUpFailedPrefix: t("creditsPage.depositTopUpFailedPrefix"),
      unknownError: t("creditsPage.depositUnknownError"),
      reviewUnavailable: t("creditsPage.depositReviewUnavailable"),
      walletBalanceChanged: t("creditsPage.depositWalletBalanceChanged"),
      networkSwitchPending: t("creditsPage.depositNetworkSwitchPending"),
      networkSwitchFailed: t("creditsPage.depositNetworkSwitchFailed"),
      permitTimedOut: t("creditsPage.depositPermitTimedOut"),
      permitFallbackAvailable: t("creditsPage.depositPermitFallbackAvailable"),
      approveTransactionFailed: t("creditsPage.depositApproveFailed"),
    }),
    [t]
  );

  useEffect(() => {
    if (
      optimisticBalanceOverride &&
      compareMoneyStrings(
        normalizeMoneyString(creditSummary.remainingBalance),
        optimisticBalanceOverride.targetBalance
      ) <= 0
    ) {
      setOptimisticBalanceOverride(null);
      if (optimisticStorageKey) sessionStorage.removeItem(optimisticStorageKey);
    }
  }, [
    creditSummary.remainingBalance,
    optimisticBalanceOverride,
    optimisticStorageKey,
  ]);

  const {
    isOpen: isDepositModalOpen,
    openModal: openDepositModal,
    closeModal: closeDepositModal,
    depositAmount,
    setDepositAmount,
    depositError,
    depositStep,
    depositFlowMode,
    primaryAction,
    isReviewingDeposit,
    handleDeposit,
    handleUseApproveFallback,
    isPending,
    isConfirming,
    walletUsdcBalance,
    nativeGasBalance,
    nativeGasSymbol,
    depositPreflightError,
    canSubmitDeposit,
    networkLabel,
    vaultAddress,
    walletAddress,
    tokenName,
    tokenSymbol,
    shortAddress,
  } = useVaultDeposit({
    initialAmount: "20",
    copy: depositHookCopy,
    onDepositSynced: async () => {
      clearOptimisticOverride();
      await Promise.all([handleRefresh(), fetchSpendingLimit()]);
    },
  });

  const ensureBillingControlReady = useCallback(async (): Promise<boolean> => {
    setError(null);

    if (!isConnected) {
      openConnectModal?.();
      return false;
    }

    if (!userAddress) {
      setError(t("creditsPage.walletUnavailable"));
      return false;
    }

    if (!isSessionAuthenticated) {
      const ok = await authorize();
      if (!ok) {
        setError(t("creditsPage.signInBeforePurchase"));
        return false;
      }
    }

    return true;
  }, [
    authorize,
    isConnected,
    isSessionAuthenticated,
    openConnectModal,
    t,
    userAddress,
  ]);

  const handleOpenPurchaseCredits = useCallback(async () => {
    const ready = await ensureBillingControlReady();
    if (!ready) {
      return;
    }
    openDepositModal();
  }, [ensureBillingControlReady, openDepositModal]);

  const handleOpenManageSpendCap = useCallback(async () => {
    const ready = await ensureBillingControlReady();
    if (!ready) {
      return;
    }
    setIsSpendCapModalOpen(true);
  }, [ensureBillingControlReady]);

  const handleOpenRedeemVoucher = useCallback(async () => {
    const ready = await ensureBillingControlReady();
    if (!ready) {
      return;
    }
    setIsRedeemVoucherModalOpen(true);
  }, [ensureBillingControlReady]);

  const handleRedeemVoucher = useCallback(
    async (voucherCode: string) => {
      if (!userAddress) {
        throw new Error(t("creditsPage.walletUnavailable"));
      }

      const result = await redeemCreditVoucher(userAddress, voucherCode);
      clearOptimisticOverride();
      await Promise.all([handleRefresh(), fetchSpendingLimit()]);
      toast.success(
        t("creditsPage.redeemVoucherModalSuccess", {
          amount: formatUsd(result.redemption.grantedAmountUsdc),
        })
      );
    },
    [clearOptimisticOverride, fetchSpendingLimit, handleRefresh, t, userAddress]
  );

  const handleWithdraw = useCallback(async () => {
    const ready = await ensureBillingControlReady();
    if (!ready) return;
    setIsWithdrawModalOpen(true);
  }, [ensureBillingControlReady]);

  const showBalanceSkeleton =
    isConnected && isSessionAuthenticated && isBootstrapping;
  const showSpendCapSkeleton =
    isConnected && isSessionAuthenticated && isSpendCapLoading;

  return (
    <div className="mx-auto w-full max-w-[768px] px-4 pb-24 pt-12 sm:px-6 lg:px-0">
      <div className="border-b border-[#2f3336] pb-8">
        <h1 className="text-[24px] font-normal leading-[32px] tracking-[-0.01em] text-white">
          {t("creditsPage.title")}
        </h1>
        <p className="mt-2 text-[16px] leading-[24px] text-[#71767b]">
          {t("creditsPage.description")}
        </p>
      </div>

      <div className="py-8">
        {error && (
          <div className="mb-6 rounded-[8px] border border-[#4a1d24] bg-[#240b11] px-4 py-3 text-[14px] leading-5 text-[#ff9b9b]">
            {error}
          </div>
        )}

        <div className="mb-6">
          <SupportContactPanel
            title={t("creditsPage.supportTitle")}
            description={t("creditsPage.supportDescription")}
            actionLabel={t("creditsPage.supportAction")}
            subject="Synapse credits or billing support"
          />
        </div>

        <section className="border-b border-[#232323] py-8 first:pt-0">
          <div className="rounded-[16px] border border-[#2f3336] bg-[#16181c] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
            <div className="flex flex-col gap-4 rounded-[12px] border border-[#232323] bg-[#1a1a1a] p-4 md:flex-row md:items-start md:justify-between md:gap-6">
              <div>
                <p className="mb-1 text-[14px] font-normal leading-[20px] text-[#9ca3af]">
                  {t("creditsPage.spendableBalanceLabel")}
                </p>
                {showBalanceSkeleton ? (
                  <div className="flex items-center gap-2 mt-2">
                    <div className="h-[32px] w-[112px] animate-pulse rounded-full bg-white/[0.09]" />
                    <div className="h-[14px] w-[14px] animate-pulse rounded-full bg-white/[0.08]" />
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-[24px] font-bold leading-[32px] tracking-[-0.02em] text-white">
                      {formatUsd(displayedRemainingBalance)}
                    </p>
                    <CircleAlert className="h-[14px] w-[14px] text-[#71767b]" />
                  </div>
                )}
              </div>
              <div>
                <div className="mb-1 flex items-center gap-1.5">
                  <p className="text-[14px] font-normal leading-[20px] text-[#9ca3af]">
                    {t("creditsPage.withdrawableBalanceLabel")}
                  </p>
                  <Info
                    className="h-[14px] w-[14px] text-[#71767b]"
                    aria-label={t("creditsPage.withdrawableBalanceTooltip")}
                  >
                    <title>{t("creditsPage.withdrawableBalanceTooltip")}</title>
                  </Info>
                </div>
                {showBalanceSkeleton ? (
                  <div className="mt-2 h-[32px] w-[112px] animate-pulse rounded-full bg-white/[0.09]" />
                ) : (
                  <p className="text-[24px] font-bold leading-[32px] tracking-[-0.02em] text-white">
                    {formatUsd(creditSummary.withdrawableBalance)}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center self-start gap-2 md:self-auto">
                <div className="relative group">
                  <button
                    type="button"
                    onClick={() => {
                      void handleWithdraw();
                    }}
                    disabled={pendingWithdrawal !== null}
                    className="inline-flex h-[36px] min-w-[143px] items-center justify-center whitespace-nowrap rounded-full border border-[#2f3336] bg-transparent px-4 py-2 text-[14px] font-normal leading-[20px] text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("creditsPage.consumerWithdrawAction")}
                  </button>
                  {pendingWithdrawal && (
                    <ConsumerWithdrawPendingTooltip
                      amountUsdc={pendingWithdrawal.amountUsdc}
                    />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void handleOpenPurchaseCredits();
                  }}
                  className="inline-flex h-[36px] min-w-[143px] items-center justify-center whitespace-nowrap rounded-full bg-[#eff3f4] px-4 py-2 text-[14px] font-normal leading-[20px] text-[#0f141a] transition hover:bg-[#e7eaeb]"
                >
                  {t("creditsPage.purchaseCredits")}
                </button>
              </div>
            </div>
            {!showBalanceSkeleton ? (
              <div className="mt-3 space-y-2">
                {creditSummary.depositPendingBalance > 0 ? (
                  <CreditBucketRow
                    label={t("creditsPage.pendingDepositBalanceLabel")}
                    amount={creditSummary.depositPendingBalance}
                    hint={t("creditsPage.pendingDepositBalanceHint")}
                    tone="pending"
                  />
                ) : null}
                {creditSummary.withdrawalPendingBalance > 0 ? (
                  <CreditBucketRow
                    label={t("creditsPage.pendingWithdrawalBalanceLabel")}
                    amount={creditSummary.withdrawalPendingBalance}
                    hint={t("creditsPage.pendingWithdrawalBalanceHint")}
                    tone="pending"
                  />
                ) : null}
                {creditSummary.frozenBalance > 0 ? (
                  <CreditBucketRow
                    label={t("creditsPage.frozenBalanceLabel")}
                    amount={creditSummary.frozenBalance}
                    hint={t("creditsPage.frozenBalanceHint")}
                    tone="frozen"
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mt-6 rounded-[8px] border border-[#323232] bg-[#1a1a1a] p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CalendarDays className="h-4 w-4 text-[#71767b]" />
                <div>
                  <p className="mb-1 text-[14px] font-normal leading-[20px] text-[#9ca3af]">
                    {t("creditsPage.currentBillingCycle")}
                  </p>
                  <p className="text-[16px] font-medium leading-[24px] text-white">
                    {billingCycle.cycleLabel}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="mb-1 text-[14px] font-normal leading-[20px] text-[#9ca3af]">
                  {t("creditsPage.daysRemaining")}
                </p>
                <p className="text-[16px] font-medium leading-[24px] text-white">
                  {billingCycle.daysRemaining}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-4 rounded-[8px] border border-[#323232] bg-[#1a1a1a] p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="max-w-[540px]">
                <h2 className="text-[18px] font-medium leading-[28px] text-white">
                  {t("creditsPage.manageSpendCapTitle")}
                </h2>
                <p className="mt-2 text-[14px] font-normal leading-[20px] text-[#9ca3af]">
                  {t("creditsPage.manageSpendCapDescription")}
                </p>
              </div>
              <button
                type="button"
                disabled={!isSpendCapAvailable}
                onClick={() => {
                  void handleOpenManageSpendCap();
                }}
                className="inline-flex h-[36px] min-w-[162px] items-center justify-center whitespace-nowrap rounded-full bg-[#eff3f4] px-4 py-2 text-[14px] font-normal leading-[20px] text-[#0f141a] transition hover:bg-[#e7eaeb] disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/45"
              >
                {t("creditsPage.manageSpendCap")}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-8 pt-4 md:grid-cols-2">
              <div>
                <p className="text-[12px] font-medium uppercase leading-[16px] tracking-[0.08em] text-[#a3a3a3]">
                  {t("creditsPage.currentSpend")}
                </p>
                {showSpendCapSkeleton ? (
                  <div className="mt-2 h-[32px] w-[96px] animate-pulse rounded-full bg-white/[0.09]" />
                ) : (
                  <p className="text-[24px] font-semibold leading-[32px] text-white">
                    {formatPlainAmount(creditSummary.currentSpend)}
                  </p>
                )}
              </div>
              <div className="text-left md:text-right">
                <p className="text-[12px] font-medium uppercase leading-[16px] tracking-[0.08em] text-[#a3a3a3]">
                  {t("creditsPage.billingCycleCap")}
                </p>
                {showSpendCapSkeleton ? (
                  <div className="mt-2 h-[32px] w-[128px] animate-pulse rounded-full bg-white/[0.09] md:ml-auto" />
                ) : (
                  <p className="text-[24px] font-semibold leading-[32px] text-white">
                    {creditSummary.billingCycleCap !== null
                      ? formatPlainAmount(creditSummary.billingCycleCap)
                      : t("creditsPage.billingCycleCapNotConfigured")}
                  </p>
                )}
              </div>
            </div>

            <div className="relative mt-3">
              {showSpendCapSkeleton ? (
                <div className="h-3 animate-pulse rounded-full bg-white/[0.08]" />
              ) : (
                <div className="h-3 rounded-full bg-[#262626]">
                  <div
                    className={`h-3 rounded-full transition-[width] ${
                      creditSummary.spendRatio !== null
                        ? "bg-[#4f8df7]"
                        : "bg-white/20"
                    }`}
                    style={{
                      width: `${
                        creditSummary.spendRatio !== null
                          ? Math.max(1.5, creditSummary.spendRatio)
                          : 100
                      }%`,
                    }}
                  />
                </div>
              )}
            </div>
            {showSpendCapSkeleton ? (
              <div className="h-5 w-[260px] animate-pulse rounded-full bg-white/[0.08]" />
            ) : (
              <p className="text-[14px] font-normal leading-[20px] text-[#71767b]">
                {creditSummary.spendRatio !== null
                  ? t("creditsPage.usedPercent", {
                      percent: formatPercent(creditSummary.spendRatio),
                    })
                  : t("creditsPage.manageSpendCapCoverageHint")}
              </p>
            )}
            {!isSpendCapAvailable ? (
              <p className="text-[14px] leading-5 text-[#d5a35b]">
                {t("creditsPage.manageSpendCapUnavailable")}
              </p>
            ) : null}
          </div>
        </section>

        <section className="border-b border-[#232323] py-8">
          <div className="flex flex-col gap-4 text-center md:flex-row md:items-center md:justify-between md:text-left">
            <div className="max-w-[512px]">
              <h2 className="text-[18px] font-medium leading-[28px] text-white">
                {t("creditsPage.freeCreditsVoucherTitle")}
              </h2>
              <p className="mt-2 text-[14px] font-normal leading-[20px] text-[#9ca3af]">
                {t("creditsPage.freeCreditsVoucherDescription")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void handleOpenRedeemVoucher();
              }}
              className="inline-flex h-[36px] min-w-[145px] shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-[#eff3f4] px-4 py-2 text-[14px] font-normal leading-[20px] text-[#0f141a] transition hover:bg-[#e7eaeb]"
            >
              {t("creditsPage.redeemVoucher")}
            </button>
          </div>
        </section>
      </div>

      <DepositUsdcModal
        isOpen={isDepositModalOpen}
        title={t("creditsPage.depositModalTitle")}
        description={t("creditsPage.depositModalDescription")}
        confirmationNotice={t("creditsPage.depositConfirmationNotice")}
        amount={depositAmount}
        onAmountChange={setDepositAmount}
        error={depositError}
        step={depositStep}
        flowMode={depositFlowMode}
        primaryAction={primaryAction}
        isReviewing={isReviewingDeposit}
        isPending={isPending}
        isConfirming={isConfirming}
        walletAddress={walletAddress}
        vaultAddress={vaultAddress}
        tokenName={tokenName}
        tokenSymbol={tokenSymbol}
        walletUsdcBalance={walletUsdcBalance}
        nativeGasBalance={nativeGasBalance}
        nativeGasSymbol={nativeGasSymbol}
        networkLabel={networkLabel}
        preflightError={depositPreflightError}
        canSubmit={canSubmitDeposit}
        shortAddress={shortAddress}
        copy={{
          amountLabel: t("creditsPage.depositAmountLabel"),
          walletUsdcLabel: t("creditsPage.depositWalletUsdcLabel"),
          nativeGasLabel: t("creditsPage.depositNativeGasLabel"),
          networkLabel: t("creditsPage.depositNetworkLabel"),
          reviewDepositLabel: t("creditsPage.depositReviewDeposit"),
          checkingWalletLabel: t("creditsPage.depositCheckingWallet"),
          switchNetworkLabel: t("creditsPage.depositSwitchNetwork"),
          insufficientUsdcLabel: t("creditsPage.depositInsufficientUsdcAction"),
          insufficientGasLabel: t("creditsPage.depositInsufficientGasAction"),
          continueToWalletLabel: t("creditsPage.depositContinueToWallet"),
          fromYourWalletLabel: t("creditsPage.depositFromYourWallet"),
          toSynapseVaultLabel: t("creditsPage.depositToSynapseVault"),
          synapseVaultLabel: t("creditsPage.depositSynapseVault"),
          expectedResult: t("creditsPage.depositExpectedResult"),
          detailsLabel: t("creditsPage.depositDetails"),
          vaultAddressLabel: t("creditsPage.depositVaultAddress"),
          tokenLabel: t("creditsPage.depositToken"),
          allowancePreapprovedLabel: t("creditsPage.depositPreapproved"),
          stepPermitTitle: t("walletActions.depositPermitStepTitle"),
          stepPermitActive: t("creditsPage.depositPermitStepActive"),
          stepPermitDone: t("creditsPage.depositPermitStepDone"),
          stepApproveTitle: t("creditsPage.depositApproveStepTitle"),
          stepApproveActive: t("creditsPage.depositApproveStepActive"),
          stepApproveDone: t("creditsPage.depositApproveStepDone"),
          stepDepositTitle: t("walletActions.depositVaultStepTitle"),
          stepDepositActive: t("creditsPage.depositVaultStepActive"),
          stepDepositWaiting: t("creditsPage.depositVaultStepWaiting"),
          hardwareWalletFallback: t(
            "creditsPage.depositHardwareWalletFallback"
          ),
          permitTimedOut: t("creditsPage.depositPermitTimedOut"),
          progressAriaLabel: t("creditsPage.depositProgressAria"),
          cancelLabel: t("creditsPage.depositCancel"),
          processingLabel: t("creditsPage.depositProcessing"),
          closeDialogLabel: t("creditsPage.depositCloseDialog"),
        }}
        onClose={closeDepositModal}
        onConfirm={() => {
          void handleDeposit();
        }}
        onUseApproveFallback={handleUseApproveFallback}
      />

      <ManageSpendCapModal
        open={isSpendCapModalOpen}
        userAddress={userAddress}
        spendingLimit={spendingLimit}
        onClose={() => setIsSpendCapModalOpen(false)}
        onSaved={async (nextLimit) => {
          setSpendingLimit(nextLimit);
          await handleRefresh();
        }}
      />

      <RedeemVoucherModal
        open={isRedeemVoucherModalOpen}
        onClose={() => setIsRedeemVoucherModalOpen(false)}
        onRedeem={handleRedeemVoucher}
      />

      {isWithdrawModalOpen && userAddress && (
        <WithdrawBalanceModal
          availableBalance={displayedRemainingBalance}
          withdrawableBalance={creditSummary.withdrawableBalance}
          minWithdrawAmount={creditSummary.minWithdrawAmount}
          userAddress={userAddress}
          onClose={() => setIsWithdrawModalOpen(false)}
          onSuccess={async (result) => {
            const normalizedStatus = (result.status || "").toUpperCase();
            const isActiveWithdrawal =
              normalizedStatus === "REQUESTED" ||
              normalizedStatus === "PENDING" ||
              normalizedStatus === "APPROVED_AUTO" ||
              normalizedStatus === "TICKET_READY" ||
              normalizedStatus === "PENDING_MANUAL_REVIEW";

            if (!isActiveWithdrawal) {
              setPendingWithdrawal(null);
              clearOptimisticOverride();
            } else {
              setPendingWithdrawal((current) => {
                if (result.existingWithdrawal && current) {
                  return current;
                }
                return {
                  id: result.withdrawId,
                  amountUsdc: result.amountUsdc,
                  status: result.status,
                  message: result.message,
                  riskReasonCode: result.riskReasonCode,
                  createdAt: result.createdAt,
                  txHash: undefined,
                  ticket: result.ticket,
                };
              });
            }

            if (isActiveWithdrawal && !result.existingWithdrawal) {
              const newOverride = {
                withdrawId: result.withdrawId,
                amountUsdc: result.amountUsdc,
                targetBalance: normalizeMoneyString(
                  Math.max(
                    0,
                    displayedRemainingBalance -
                      moneyStringToNumber(result.amountUsdc)
                  )
                ),
              };
              setOptimisticBalanceOverride((current) =>
                current?.withdrawId === result.withdrawId
                  ? current
                  : newOverride
              );
              if (optimisticStorageKey) {
                try {
                  sessionStorage.setItem(
                    optimisticStorageKey,
                    JSON.stringify(newOverride)
                  );
                } catch {
                  /* ignore */
                }
              }
            }

            await new Promise((resolve) => setTimeout(resolve, 300));
            await Promise.all([
              handleRefresh(),
              fetchSpendingLimit(),
              fetchPendingWithdrawal(),
            ]);
          }}
        />
      )}
    </div>
  );
}

export { WithdrawBalanceModal };
