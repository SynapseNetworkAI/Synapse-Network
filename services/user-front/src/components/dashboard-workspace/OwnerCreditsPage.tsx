"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CircleAlert } from "lucide-react";
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import toast from "react-hot-toast";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useAuth } from "@/components/WalletAuthGuard";
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
  type ConsumerWithdrawIntent,
  type OwnerSpendingLimit,
  type RefundIntentRecord,
} from "@/utils/balanceApi";
import {
  calculateSpendRatio,
  getBillingCycleWindow,
} from "@/utils/creditsSpendCap";
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
  userAddress: string;
  onClose: () => void;
  onSuccess: (result: ConsumerWithdrawIntent) => Promise<void>;
};

function normalizeSignature(signature: string): `0x${string}` {
  const normalized = signature.startsWith("0x") ? signature : `0x${signature}`;
  return normalized as `0x${string}`;
}

type WithdrawStep = "form" | "signing" | "onchain" | "confirming" | "completing" | "done";

function WithdrawBalanceModal({ availableBalance, userAddress, onClose, onSuccess }: Readonly<WithdrawModalProps>) {
  const [amount, setAmount] = useState(String(availableBalance > 0 ? availableBalance.toFixed(2) : ""));
  const [reason, setReason] = useState("");
  const [step, setStep] = useState<WithdrawStep>("form");
  const [withdrawResult, setWithdrawResult] = useState<ConsumerWithdrawIntent | null>(null);
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
      activeResult?: ConsumerWithdrawIntent | null
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
        toast.error(fallbackMessage);
        await onSuccess({ ...target, status: "FAILED" });
      } catch (error) {
        const msg =
          error instanceof Error
            ? error.message
            : "Failed to release the pending withdrawal.";
        toast.error(msg);
      } finally {
        setStep("form");
        onClose();
      }
    },
    [onClose, onSuccess, userAddress, withdrawResult]
  );

  // Step: tx confirmed → call backend /complete
  useEffect(() => {
    if (!isTxConfirmed || !txHash || !withdrawResult?.withdrawId || completingRef.current) return;
    completingRef.current = true;
    setStep("completing");
    const complete = async () => {
      try {
        await completeV2Refund(userAddress, withdrawResult.withdrawId, txHash);
        toast.success(`Withdrawal of $${withdrawResult.netUsdc.toFixed(2)} USDC completed!`);
        setStep("done");
        await onSuccess({ ...withdrawResult, status: "COMPLETED" });
        onClose();
      } catch {
        toast.error("On-chain transfer succeeded but backend update failed. The background processor will complete it automatically.");
        onClose();
      }
    };
    void complete();
  }, [isTxConfirmed, txHash, withdrawResult, userAddress, onSuccess, onClose]);

  // Step: tx failed
  useEffect(() => {
    if (!isTxFailed || !withdrawResult || !txHash) return;
    void syncFailedWithdrawal(
      "TX_FAILED",
      txReceiptError?.message || "On-chain transaction failed. Your balance was restored.",
      txHash
    );
  }, [isTxFailed, syncFailedWithdrawal, txHash, txReceiptError, withdrawResult]);

  const handleSubmit = async () => {
    const num = Number.parseFloat(amount);
    if (!Number.isFinite(num) || num <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    if (num > availableBalance + 1e-6) {
      toast.error(`Amount exceeds available balance ($${availableBalance.toFixed(2)}).`);
      return;
    }

    setStep("signing");
    let createdResult: ConsumerWithdrawIntent | null = null;
    try {
      const result = await requestConsumerWithdraw(userAddress, {
        amountUsdc: num,
        reason: reason.trim() || undefined,
      });
      createdResult = result;
      setWithdrawResult(result);
      await onSuccess(result);

      if (result.existingWithdrawal) {
        if (!result.ticket || result.status === "PENDING_MANUAL_REVIEW") {
          toast("A pending withdrawal already exists. Finish or wait for the current request.", {
            icon: "⏳",
            duration: 6000,
          });
          onClose();
          return;
        }
        toast("Resuming your pending withdrawal in the wallet.", {
          icon: "⏳",
          duration: 6000,
        });
      } else if (result.status === "PENDING_MANUAL_REVIEW") {
        toast.success(`Withdrawal submitted — under review. Reason: ${result.riskReasonCode || "manual review"}`);
        onClose();
        return;
      }

      if (!result.ticket) {
        toast.error("Withdrawal ticket is unavailable. Please retry after the gateway signs a fresh ticket.");
        onClose();
        return;
      }

      setStep("onchain");
      const ticket = result.ticket;
      const contractAddress = (ticket.contractAddress || "") as `0x${string}`;

      await writeContractAsync({
        address: contractAddress,
        abi: SynapseCoreABI,
        chainId: ticket.chainId || chainId,
        functionName: "withdraw",
        args: [
          BigInt(ticket.amount),
          BigInt(ticket.fee),
          BigInt(ticket.nonce),
          BigInt(ticket.deadline),
          normalizeSignature(ticket.signature),
        ],
      });

      setStep("confirming");
      toast.success("Transaction submitted — waiting for confirmation…");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Withdrawal failed.";
      if (msg.includes("User rejected") || msg.includes("denied")) {
        await syncFailedWithdrawal(
          "WALLET_REJECTED",
          "Transaction rejected by wallet.",
          undefined,
          createdResult
        );
      } else {
        if (createdResult?.withdrawId) {
          await syncFailedWithdrawal(
            "WITHDRAW_SUBMISSION_FAILED",
            msg,
            undefined,
            createdResult
          );
        } else {
          toast.error(msg);
        }
      }
      setStep("form");
    }
  };

  const submitting = step !== "form";
  let buttonLabel = "Withdraw";
  if (step === "signing") buttonLabel = "Requesting…";
  else if (step === "onchain") buttonLabel = "Confirm in Wallet…";
  else if (step === "confirming") buttonLabel = "Confirming on-chain…";
  else if (step === "completing") buttonLabel = "Completing…";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
      onClick={submitting ? undefined : onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[#2a2a2a] bg-[#111] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-base font-semibold text-white">Withdraw Balance</h3>
        <p className="mb-4 text-sm text-[#86868b]">
          Withdraw unused credits back to your wallet. Available:{" "}
          <span className="font-mono text-white">${availableBalance.toFixed(2)} USDC</span>
        </p>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-[#86868b]">
              Amount (USDC)
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                step="0.01"
                max={availableBalance}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={submitting}
                className="flex-1 rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-[#22c55e]/50 focus:outline-none disabled:opacity-40"
              />
              <button
                type="button"
                onClick={() => setAmount(availableBalance.toFixed(2))}
                disabled={submitting}
                className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-xs text-[#9ca3af] hover:text-white disabled:opacity-40"
              >
                Max
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-[#86868b]">
              Reason (optional)
            </label>
            <textarea
              rows={2}
              maxLength={256}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              placeholder="Why are you withdrawing?"
              className="w-full rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 text-sm text-white placeholder:text-[#555] focus:border-[#22c55e]/50 focus:outline-none disabled:opacity-40"
            />
          </div>

          <div className="rounded-xl border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-xs text-[#86868b] space-y-1">
            <p>⚠ Amounts ≥ $500 require manual review (12–24 h).</p>
            <p>⚠ Max 3 withdrawals per 24 hours.</p>
            <p>⚠ Your wallet will execute the on-chain transfer (you pay gas).</p>
          </div>

          {step !== "form" && step !== "done" && (
            <div className="rounded-xl border border-[#22c55e]/30 bg-[#22c55e]/5 px-3 py-2 text-xs text-[#22c55e]">
              {step === "signing" && "Requesting withdrawal ticket from server…"}
              {step === "onchain" && "Please confirm the transaction in your wallet."}
              {step === "confirming" && "Transaction submitted. Waiting for block confirmation…"}
              {step === "completing" && "On-chain confirmed. Updating records…"}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              disabled={submitting}
              className="flex-1 rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] py-2 text-sm text-[#9ca3af] hover:bg-[#151515] disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || availableBalance <= 0}
              className="flex-1 rounded-xl bg-[#22c55e] py-2 text-sm font-semibold text-black hover:bg-[#16a34a] disabled:opacity-40"
            >
              {submitting ? buttonLabel : "Withdraw"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

function formatUsd(value: number): string {
  return `$${Math.max(0, value).toFixed(2)}`;
}

function formatPlainAmount(value: number): string {
  return Math.max(0, value).toFixed(2);
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, value))
    .toFixed(1)
    .replace(/\\.0$/, "")}%`;
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
  const [pendingWithdrawal, setPendingWithdrawal] = useState<RefundIntentRecord | null>(null);
  const [optimisticBalanceOverride, setOptimisticBalanceOverride] = useState<{
    withdrawId: string;
    amountUsdc: number;
    targetBalance: number;
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
          amountUsdc: number;
          targetBalance: number;
        };
        if (parsed.withdrawId && typeof parsed.targetBalance === "number") {
          setOptimisticBalanceOverride(parsed);
        }
      }
    } catch { /* ignore */ }
  }, [optimisticStorageKey]);

  const fetchPendingWithdrawal = useCallback(async () => {
    if (!isConnected || !userAddress || !isSessionAuthenticated) {
      setPendingWithdrawal(null);
      return;
    }
    try {
      const rows = await listConsumerWithdrawals(userAddress);
      const active = rows.find((r) => {
        const s = (r.status ?? "").toUpperCase();
        return s === "REQUESTED" || s === "PENDING" || s === "PENDING_MANUAL_REVIEW";
      }) ?? null;
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
      const message =
        err instanceof Error ? err.message : "Failed to load credits page";
      if (message === WALLET_SESSION_MISSING_MESSAGE) {
        clearAuthSession();
        setError(message);
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
  }, [isConnected, isSessionAuthenticated, userAddress]);

  useEffect(() => {
    void fetchSpendingLimit();
  }, [fetchSpendingLimit]);

  const billingCycle = useMemo(() => getBillingCycleWindow(), []);

  const creditSummary = useMemo(() => {
    const treasuryAvailable = Number.parseFloat(stats.ownerBalance) || 0;
    const currentSpend = Number(spendingLimit?.currentCycleSpendUsdc ?? 0);
    const billingCycleCap =
      typeof spendingLimit?.spendingLimitUsdc === "number"
        ? spendingLimit.spendingLimitUsdc
        : null;
    const spendRatio = calculateSpendRatio(currentSpend, billingCycleCap);

    return {
      remainingBalance: treasuryAvailable,
      currentSpend,
      billingCycleCap,
      spendRatio,
      remainingSpend:
        typeof spendingLimit?.remainingSpendUsdc === "number"
          ? spendingLimit.remainingSpendUsdc
          : null,
    };
  }, [spendingLimit, stats.ownerBalance]);

  const displayedRemainingBalance = useMemo(() => {
    if (!optimisticBalanceOverride) {
      return creditSummary.remainingBalance;
    }

    const serverBalance = creditSummary.remainingBalance;
    if (serverBalance <= optimisticBalanceOverride.targetBalance + 1e-6) {
      return serverBalance;
    }

    return optimisticBalanceOverride.targetBalance;
  }, [creditSummary.remainingBalance, optimisticBalanceOverride]);

  const clearOptimisticOverride = useCallback(() => {
    setOptimisticBalanceOverride(null);
    if (optimisticStorageKey) sessionStorage.removeItem(optimisticStorageKey);
  }, [optimisticStorageKey]);

  useEffect(() => {
    if (
      optimisticBalanceOverride &&
      creditSummary.remainingBalance <= optimisticBalanceOverride.targetBalance + 1e-6
    ) {
      setOptimisticBalanceOverride(null);
      if (optimisticStorageKey) sessionStorage.removeItem(optimisticStorageKey);
    }
  }, [creditSummary.remainingBalance, optimisticBalanceOverride, optimisticStorageKey]);

  const {
    isOpen: isDepositModalOpen,
    openModal: openDepositModal,
    closeModal: closeDepositModal,
    depositAmount,
    setDepositAmount,
    depositError,
    depositStep,
    handleDeposit,
    isPending,
    isConfirming,
    walletUsdcBalance,
    vaultAddress,
    walletAddress,
    shortAddress,
  } = useVaultDeposit({
    initialAmount: "20",
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
            <div className="flex flex-col gap-4 rounded-[12px] border border-[#232323] bg-[#1a1a1a] p-4 md:h-[116px] md:flex-row md:items-center md:justify-between md:gap-6">
                <div>
                  <p className="mb-1 text-[14px] font-normal leading-[20px] text-[#9ca3af]">
                    {t("creditsPage.remainingBalanceLabel")}
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
                <div className="flex flex-wrap items-center self-start gap-2 md:self-auto">
                  <div className="relative group">
                    <button
                      type="button"
                      onClick={() => { void handleWithdraw(); }}
                      disabled={displayedRemainingBalance <= 0 || pendingWithdrawal !== null}
                      className="inline-flex h-[36px] min-w-[143px] items-center justify-center whitespace-nowrap rounded-full border border-[#2f3336] bg-transparent px-4 py-2 text-[14px] font-normal leading-[20px] text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Withdraw
                    </button>
                    {pendingWithdrawal && (
                      <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-[220px] rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-xs text-[#f59e0b] shadow-xl opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
                        A withdrawal of ${(pendingWithdrawal.amountUsdc ?? 0).toFixed(2)} is pending. Only one active withdrawal is allowed.
                      </div>
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
        amount={depositAmount}
        onAmountChange={setDepositAmount}
        error={depositError}
        step={depositStep}
        isPending={isPending}
        isConfirming={isConfirming}
        walletAddress={walletAddress}
        vaultAddress={vaultAddress}
        walletUsdcBalance={walletUsdcBalance}
        shortAddress={shortAddress}
        onClose={closeDepositModal}
        onConfirm={() => {
          void handleDeposit();
        }}
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
          userAddress={userAddress}
          onClose={() => setIsWithdrawModalOpen(false)}
          onSuccess={async (result) => {
            const normalizedStatus = (result.status || "").toUpperCase();
            const isActiveWithdrawal =
              normalizedStatus === "REQUESTED" ||
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
                targetBalance: Math.max(
                  0,
                  displayedRemainingBalance - result.amountUsdc
                ),
              };
              setOptimisticBalanceOverride((current) =>
                current?.withdrawId === result.withdrawId ? current : newOverride
              );
              if (optimisticStorageKey) {
                try {
                  sessionStorage.setItem(optimisticStorageKey, JSON.stringify(newOverride));
                } catch { /* ignore */ }
              }
            }

            await new Promise((resolve) => setTimeout(resolve, 300));
            await Promise.all([handleRefresh(), fetchSpendingLimit(), fetchPendingWithdrawal()]);
          }}
        />
      )}
    </div>
  );
}

export { WithdrawBalanceModal };
