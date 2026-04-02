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
import DashboardPageLoadingState from "@/components/loading/DashboardPageLoadingState";
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
  const [spendingLimit, setSpendingLimit] = useState<OwnerSpendingLimit | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [isSpendCapLoading, setIsSpendCapLoading] = useState(false);
  const [isSpendCapAvailable, setIsSpendCapAvailable] = useState(true);
  const [isSpendCapModalOpen, setIsSpendCapModalOpen] = useState(false);
  const [isRedeemVoucherModalOpen, setIsRedeemVoucherModalOpen] =
    useState(false);

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

  if (isConnected && isSessionAuthenticated && (isBootstrapping || isSpendCapLoading)) {
    return <DashboardPageLoadingState />;
  }

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

        <section className="border-b border-[#232323] py-8 first:pt-0">
          <div className="rounded-[16px] border border-[#2f3336] bg-[#16181c] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
            <div className="flex flex-col gap-4 rounded-[12px] border border-[#232323] bg-[#1a1a1a] p-4 md:h-[116px] md:flex-row md:items-center md:justify-between md:gap-6">
                <div>
                  <p className="mb-1 text-[14px] font-normal leading-[20px] text-[#9ca3af]">
                    {t("creditsPage.remainingBalanceLabel")}
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="text-[24px] font-bold leading-[32px] tracking-[-0.02em] text-white">
                      {formatUsd(creditSummary.remainingBalance)}
                    </p>
                    <CircleAlert className="h-[14px] w-[14px] text-[#71767b]" />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void handleOpenPurchaseCredits();
                  }}
                  className="inline-flex h-[36px] min-w-[143px] items-center justify-center self-start whitespace-nowrap rounded-full bg-[#eff3f4] px-4 py-2 text-[14px] font-normal leading-[20px] text-[#0f141a] transition hover:bg-[#e7eaeb] md:self-auto"
                >
                  {t("creditsPage.purchaseCredits")}
                </button>
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
                <p className="text-[24px] font-semibold leading-[32px] text-white">
                  {formatPlainAmount(creditSummary.currentSpend)}
                </p>
              </div>
              <div className="text-left md:text-right">
                <p className="text-[12px] font-medium uppercase leading-[16px] tracking-[0.08em] text-[#a3a3a3]">
                  {t("creditsPage.billingCycleCap")}
                </p>
                <p className="text-[24px] font-semibold leading-[32px] text-white">
                  {creditSummary.billingCycleCap !== null
                    ? formatPlainAmount(creditSummary.billingCycleCap)
                    : t("creditsPage.billingCycleCapNotConfigured")}
                </p>
              </div>
            </div>

            <div className="relative mt-3">
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
            </div>
            <p className="text-[14px] font-normal leading-[20px] text-[#71767b]">
              {creditSummary.spendRatio !== null
                ? t("creditsPage.usedPercent", {
                    percent: formatPercent(creditSummary.spendRatio),
                  })
                : t("creditsPage.manageSpendCapCoverageHint")}
            </p>
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
    </div>
  );
}
