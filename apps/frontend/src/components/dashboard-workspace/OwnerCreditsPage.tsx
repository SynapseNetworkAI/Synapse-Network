"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CircleAlert } from "lucide-react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import toast from "react-hot-toast";
import DepositUsdcModal from "@/components/dashboard/shared/DepositUsdcModal";
import ManageSpendCapModal from "@/components/dashboard-workspace/ManageSpendCapModal";
import RedeemVoucherModal from "@/components/dashboard-workspace/RedeemVoucherModal";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useAuth } from "@/components/WalletAuthGuard";
import { useOwnerData } from "@/hooks/useOwnerData";
import { useVaultDeposit } from "@/hooks/useVaultDeposit";
import {
  clearAuthSession,
  WALLET_SESSION_MISSING_MESSAGE,
} from "@/utils/authSession";
import {
  getOwnerSpendingLimit,
  redeemCreditVoucher,
  type OwnerSpendingLimit,
} from "@/utils/balanceApi";
import {
  calculateSpendRatio,
  getBillingCycleWindow,
} from "@/utils/creditsSpendCap";

function formatUsd(value: number): string {
  return `$${Math.max(0, value).toFixed(2)}`;
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
  const { stats, handleRefresh } = useOwnerData();
  const [spendingLimit, setSpendingLimit] = useState<OwnerSpendingLimit | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [isSpendCapAvailable, setIsSpendCapAvailable] = useState(true);
  const [isSpendCapModalOpen, setIsSpendCapModalOpen] = useState(false);
  const [isRedeemVoucherModalOpen, setIsRedeemVoucherModalOpen] =
    useState(false);

  const fetchSpendingLimit = useCallback(async () => {
    if (!isConnected || !userAddress || !isSessionAuthenticated) {
      setSpendingLimit(null);
      setIsSpendCapAvailable(true);
      return;
    }

    try {
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
      await Promise.all([handleRefresh(), fetchSpendingLimit()]);
      toast.success(
        t("creditsPage.redeemVoucherModalSuccess", {
          amount: formatUsd(result.redemption.grantedAmountUsdc),
        })
      );
    },
    [fetchSpendingLimit, handleRefresh, t, userAddress]
  );

  return (
    <div className="mx-auto w-full max-w-[1040px] px-8 py-10">
      <div className="border-b border-white/8 pb-9">
        <h1 className="text-[43px] font-semibold tracking-[-0.04em] text-white">
          {t("creditsPage.title")}
        </h1>
        <p className="mt-3 text-[18px] text-[#8b98b4]">
          {t("creditsPage.description")}
        </p>
      </div>

      <div className="mt-12 space-y-7">
        {error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <section className="rounded-[18px] border border-white/10 bg-[#141414] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <div className="flex flex-col gap-5 rounded-[12px] border border-white/10 bg-[#1d1d1d] px-6 py-7 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[14px] text-[#8b98b4]">
                {t("creditsPage.remainingBalanceLabel")}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <p className="text-[44px] font-semibold leading-none tracking-[-0.04em] text-white">
                  {formatUsd(creditSummary.remainingBalance)}
                </p>
                <CircleAlert className="mt-1 h-4 w-4 text-[#8b98b4]" />
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                void handleOpenPurchaseCredits();
              }}
              className="inline-flex h-12 items-center justify-center rounded-full bg-white px-6 text-[15px] font-medium text-black transition hover:bg-white/90"
            >
              {t("creditsPage.purchaseCredits")}
            </button>
          </div>
        </section>

        <section className="rounded-[18px] border border-white/10 bg-[#1f1f1f] px-6 py-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-start gap-3">
              <CalendarDays className="mt-1 h-4 w-4 text-[#8b98b4]" />
              <div>
                <p className="text-[14px] text-[#8b98b4]">
                  {t("creditsPage.currentBillingCycle")}
                </p>
                <p className="mt-1 text-[18px] font-semibold text-white">
                  {billingCycle.cycleLabel}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[14px] text-[#8b98b4]">
                {t("creditsPage.daysRemaining")}
              </p>
              <p className="mt-1 text-[18px] font-semibold text-white">
                {billingCycle.daysRemaining}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-[18px] border border-white/10 bg-[#1f1f1f] px-6 py-7 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div className="max-w-[640px]">
              <h2 className="text-[18px] font-semibold text-white">
                {t("creditsPage.manageSpendCapTitle")}
              </h2>
              <p className="mt-3 text-[15px] leading-7 text-[#8b98b4]">
                {t("creditsPage.manageSpendCapDescription")}
              </p>
            </div>
            <button
              type="button"
              disabled={!isSpendCapAvailable}
              onClick={() => {
                void handleOpenManageSpendCap();
              }}
              className="inline-flex h-12 items-center justify-center rounded-full bg-white px-6 text-[15px] font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/45"
            >
              {t("creditsPage.manageSpendCap")}
            </button>
          </div>

          <div className="mt-14 grid grid-cols-1 gap-8 md:grid-cols-2">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#8b98b4]">
                {t("creditsPage.currentSpend")}
              </p>
              <p className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-white">
                {formatUsd(creditSummary.currentSpend)}
              </p>
            </div>
            <div className="text-left md:text-right">
              <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#8b98b4]">
                {t("creditsPage.billingCycleCap")}
              </p>
              <p className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-white">
                {creditSummary.billingCycleCap !== null
                  ? formatUsd(creditSummary.billingCycleCap)
                  : t("creditsPage.billingCycleCapNotConfigured")}
              </p>
            </div>
          </div>

          <div className="mt-7 h-2 rounded-full bg-white/10">
            <div
              className={`h-2 rounded-full transition-[width] ${
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
          <p className="mt-3 text-[14px] text-[#8b98b4]">
            {creditSummary.spendRatio !== null
              ? t("creditsPage.usedPercent", {
                  percent: formatPercent(creditSummary.spendRatio),
                })
              : t("creditsPage.manageSpendCapCoverageHint")}
          </p>
          {!isSpendCapAvailable ? (
            <p className="mt-2 text-[14px] text-[#d5a35b]">
              {t("creditsPage.manageSpendCapUnavailable")}
            </p>
          ) : null}
          {creditSummary.remainingSpend !== null ? (
            <p className="mt-2 text-[14px] text-[#8b98b4]">
              {t("creditsPage.manageSpendCapRemainingBudget", {
                amount: formatUsd(creditSummary.remainingSpend),
              })}
            </p>
          ) : null}
        </section>

        <section className="flex flex-col gap-6 rounded-[18px] border border-white/10 bg-[#1f1f1f] px-6 py-8 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] md:flex-row md:items-start md:justify-between">
          <div className="max-w-[600px]">
            <h2 className="text-[18px] font-semibold text-white">
              {t("creditsPage.freeCreditsVoucherTitle")}
            </h2>
            <p className="mt-3 text-[15px] leading-7 text-[#8b98b4]">
              {t("creditsPage.freeCreditsVoucherDescription")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void handleOpenRedeemVoucher();
            }}
            className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-white px-6 text-[15px] font-medium text-black transition hover:bg-white/90"
          >
            {t("creditsPage.redeemVoucher")}
          </button>
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
    </div>
  );
}
