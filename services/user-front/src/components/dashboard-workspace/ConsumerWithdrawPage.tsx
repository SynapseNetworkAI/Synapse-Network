"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { CircleAlert, Wallet } from "lucide-react";
import { useAccount } from "wagmi";
import { useAuth } from "@/components/WalletAuthGuard";
import ConsumerWithdrawHistoryTable from "@/components/dashboard-workspace/ConsumerWithdrawHistoryTable";
import {
  canResumeConsumerWithdrawal,
  isActiveWithdrawalStatus,
  isWithdrawalPendingBalanceStatus,
  WithdrawBalanceModal,
} from "@/components/dashboard-workspace/OwnerCreditsPage";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useOwnerData } from "@/hooks/useOwnerData";
import {
  listConsumerWithdrawals,
  type ConsumerWithdrawIntent,
  type RefundIntentRecord,
} from "@/utils/balanceApi";
import {
  WALLET_SESSION_MISSING_MESSAGE,
  clearAuthSession,
} from "@/utils/authSession";
import { moneyStringToNumber } from "@/utils/money";
import { formatUsd } from "@/utils/ownerCreditsFormat";

type Translate = ReturnType<typeof useLanguage>["t"];
type OwnerStats = ReturnType<typeof useOwnerData>["stats"];

type WithdrawalsState = {
  withdrawals: RefundIntentRecord[];
  loadingWithdrawals: boolean;
  error: string | null;
  fetchWithdrawals: () => Promise<void>;
  setWithdrawals: Dispatch<SetStateAction<RefundIntentRecord[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
};

type ActionPanelProps = {
  activeWithdrawal: RefundIntentRecord | null;
  canResume: boolean;
  isConnected: boolean;
  isSessionAuthenticated: boolean;
  minWithdrawAmount: number;
  spendableBalance: number;
  userAddress?: string;
  withdrawableBalance: number;
  ensureAccountReady: () => Promise<boolean>;
  handleWithdrawSuccess: (result: ConsumerWithdrawIntent) => Promise<void>;
  t: Translate;
};

type ConsumerWithdrawPageModel = {
  activeWithdrawal: RefundIntentRecord | null;
  canResume: boolean;
  ensureAccountReady: () => Promise<boolean>;
  error: string | null;
  handleWithdrawSuccess: (result: ConsumerWithdrawIntent) => Promise<void>;
  isBootstrapping: boolean;
  isConnected: boolean;
  isSessionAuthenticated: boolean;
  loadingWithdrawals: boolean;
  minWithdrawAmount: number;
  pendingWithdrawalBalance: number;
  spendableBalance: number;
  t: Translate;
  userAddress?: string;
  withdrawableBalance: number;
  withdrawals: RefundIntentRecord[];
};

function getActiveWithdrawal(withdrawals: RefundIntentRecord[]) {
  return (
    withdrawals.find((row) => isActiveWithdrawalStatus(row.status)) ?? null
  );
}

function getConsumerWithdrawBalances(
  stats: OwnerStats,
  activeWithdrawal: RefundIntentRecord | null
) {
  const spendableBalance = moneyStringToNumber(
    stats.consumerAvailableBalance ?? stats.ownerBalance
  );
  const withdrawableBalance = moneyStringToNumber(
    stats.consumerWithdrawableBalance ?? "0"
  );
  const minWithdrawAmount = moneyStringToNumber(
    stats.consumerWithdrawMinUsdc ?? "10"
  );
  const pendingWithdrawalBalance =
    activeWithdrawal &&
    isWithdrawalPendingBalanceStatus(activeWithdrawal.status)
      ? moneyStringToNumber(activeWithdrawal.amountUsdc ?? "0")
      : 0;

  return {
    minWithdrawAmount,
    pendingWithdrawalBalance,
    spendableBalance,
    withdrawableBalance,
  };
}

function mergeWithdrawalResult(
  current: RefundIntentRecord[],
  result: ConsumerWithdrawIntent
) {
  const existing = current.find((row) => row.id === result.withdrawId);
  const next: RefundIntentRecord = {
    ...(existing ?? {}),
    id: result.withdrawId,
    amountUsdc: result.amountUsdc,
    status: result.status,
    message: result.message,
    riskReasonCode: result.riskReasonCode,
    createdAt: result.createdAt ?? existing?.createdAt,
    ticket: result.ticket ?? existing?.ticket,
  };
  return [next, ...current.filter((row) => row.id !== result.withdrawId)];
}

function useConsumerWithdrawals({
  isConnected,
  isSessionAuthenticated,
  t,
  userAddress,
}: {
  isConnected: boolean;
  isSessionAuthenticated: boolean;
  t: Translate;
  userAddress?: string;
}): WithdrawalsState {
  const [withdrawals, setWithdrawals] = useState<RefundIntentRecord[]>([]);
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWithdrawals = useCallback(async () => {
    if (!isConnected || !userAddress || !isSessionAuthenticated) {
      setWithdrawals([]);
      return;
    }
    setLoadingWithdrawals(true);
    try {
      setWithdrawals(await listConsumerWithdrawals(userAddress));
      setError(null);
    } catch (err) {
      if (
        err instanceof Error &&
        err.message === WALLET_SESSION_MISSING_MESSAGE
      ) {
        clearAuthSession();
      }
      setWithdrawals([]);
      setError(t("consumerWithdrawPage.historyLoadFailed"));
    } finally {
      setLoadingWithdrawals(false);
    }
  }, [isConnected, isSessionAuthenticated, t, userAddress]);

  useEffect(() => {
    void fetchWithdrawals();
  }, [fetchWithdrawals]);

  return {
    withdrawals,
    loadingWithdrawals,
    error,
    fetchWithdrawals,
    setWithdrawals,
    setError,
  };
}

function BalanceMetric({
  label,
  amount,
  hint,
}: Readonly<{ label: string; amount: number; hint?: string }>) {
  return (
    <div className="rounded-[14px] border border-[#2f3336] bg-[#16181c] p-4">
      <p className="text-[13px] leading-5 text-[#9ca3af]">{label}</p>
      <p className="mt-1 text-[24px] font-bold leading-8 tracking-[-0.02em] text-white">
        {formatUsd(amount)}
      </p>
      {hint ? (
        <p className="mt-2 text-[12px] leading-5 text-[#71767b]">{hint}</p>
      ) : null}
    </div>
  );
}

function ConsumerWithdrawActionPanel({
  activeWithdrawal,
  canResume,
  isConnected,
  isSessionAuthenticated,
  minWithdrawAmount,
  spendableBalance,
  userAddress,
  withdrawableBalance,
  ensureAccountReady,
  handleWithdrawSuccess,
  t,
}: Readonly<ActionPanelProps>) {
  if (!isConnected || !isSessionAuthenticated || !userAddress) {
    return (
      <div className="rounded-[16px] border border-[#2f3336] bg-[#111] p-6">
        <h2 className="text-[18px] font-semibold text-white">
          {t("consumerWithdrawPage.signInTitle")}
        </h2>
        <p className="mt-2 text-[14px] leading-6 text-[#9ca3af]">
          {t("consumerWithdrawPage.signInDescription")}
        </p>
        <button
          type="button"
          onClick={() => {
            void ensureAccountReady();
          }}
          className="mt-5 inline-flex h-10 items-center justify-center rounded-full bg-[#eff3f4] px-5 text-[14px] font-medium text-[#0f141a] transition hover:bg-[#e7eaeb]"
        >
          {t("overviewPage.connectWallet")}
        </button>
      </div>
    );
  }

  if (activeWithdrawal && !canResume) {
    return (
      <div className="rounded-[16px] border border-[#2f3336] bg-[#111] p-6">
        <div className="flex items-start gap-3">
          <CircleAlert className="mt-1 h-5 w-5 text-amber-300" />
          <div>
            <h2 className="text-[18px] font-semibold text-white">
              {t("consumerWithdrawPage.activeTitle")}
            </h2>
            <p className="mt-2 text-[14px] leading-6 text-[#9ca3af]">
              {activeWithdrawal.status === "PENDING_MANUAL_REVIEW"
                ? t("consumerWithdrawPage.reviewBody")
                : t("consumerWithdrawPage.processingBody")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <WithdrawBalanceModal
      variant="panel"
      availableBalance={spendableBalance}
      withdrawableBalance={withdrawableBalance}
      minWithdrawAmount={minWithdrawAmount}
      userAddress={userAddress}
      resumeWithdrawal={activeWithdrawal}
      onClose={() => {}}
      onSuccess={handleWithdrawSuccess}
    />
  );
}

function useEnsureConsumerWithdrawAccountReady({
  authorize,
  isConnected,
  isSessionAuthenticated,
  openConnectModal,
  setError,
  t,
  userAddress,
}: {
  authorize: () => Promise<boolean>;
  isConnected: boolean;
  isSessionAuthenticated: boolean;
  openConnectModal?: () => void;
  setError: Dispatch<SetStateAction<string | null>>;
  t: Translate;
  userAddress?: string;
}) {
  return useCallback(async (): Promise<boolean> => {
    setError(null);
    if (!isConnected) {
      openConnectModal?.();
      return false;
    }
    if (!userAddress) {
      setError(t("creditsPage.walletUnavailable"));
      return false;
    }
    if (!isSessionAuthenticated && !(await authorize())) {
      setError(t("creditsPage.signInBeforePurchase"));
      return false;
    }
    return true;
  }, [
    authorize,
    isConnected,
    isSessionAuthenticated,
    openConnectModal,
    setError,
    t,
    userAddress,
  ]);
}

function useConsumerWithdrawSuccessHandler({
  fetchWithdrawals,
  handleRefresh,
  setWithdrawals,
}: {
  fetchWithdrawals: () => Promise<void>;
  handleRefresh: () => Promise<void>;
  setWithdrawals: Dispatch<SetStateAction<RefundIntentRecord[]>>;
}) {
  return useCallback(
    async (result: ConsumerWithdrawIntent) => {
      if (isActiveWithdrawalStatus(result.status)) {
        setWithdrawals((current) => mergeWithdrawalResult(current, result));
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      await Promise.all([handleRefresh(), fetchWithdrawals()]);
    },
    [fetchWithdrawals, handleRefresh, setWithdrawals]
  );
}

function useConsumerWithdrawPageModel(): ConsumerWithdrawPageModel {
  const { t } = useLanguage();
  const { address: userAddress, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { isSessionAuthenticated, authorize } = useAuth();
  const { stats, handleRefresh, isBootstrapping } = useOwnerData();
  const withdrawalState = useConsumerWithdrawals({
    isConnected,
    isSessionAuthenticated,
    t,
    userAddress,
  });
  const activeWithdrawal = useMemo(
    () => getActiveWithdrawal(withdrawalState.withdrawals),
    [withdrawalState.withdrawals]
  );
  const canResume = canResumeConsumerWithdrawal(activeWithdrawal);
  const balances = getConsumerWithdrawBalances(stats, activeWithdrawal);
  const ensureAccountReady = useEnsureConsumerWithdrawAccountReady({
    authorize,
    isConnected,
    isSessionAuthenticated,
    openConnectModal,
    setError: withdrawalState.setError,
    t,
    userAddress,
  });
  const handleWithdrawSuccess = useConsumerWithdrawSuccessHandler({
    fetchWithdrawals: withdrawalState.fetchWithdrawals,
    handleRefresh,
    setWithdrawals: withdrawalState.setWithdrawals,
  });

  return {
    activeWithdrawal,
    canResume,
    ensureAccountReady,
    error: withdrawalState.error,
    handleWithdrawSuccess,
    isBootstrapping,
    isConnected,
    isSessionAuthenticated,
    loadingWithdrawals: withdrawalState.loadingWithdrawals,
    minWithdrawAmount: balances.minWithdrawAmount,
    pendingWithdrawalBalance: balances.pendingWithdrawalBalance,
    spendableBalance: balances.spendableBalance,
    t,
    userAddress,
    withdrawableBalance: balances.withdrawableBalance,
    withdrawals: withdrawalState.withdrawals,
  };
}

function ConsumerWithdrawPageView({
  activeWithdrawal,
  canResume,
  ensureAccountReady,
  error,
  handleWithdrawSuccess,
  isBootstrapping,
  isConnected,
  isSessionAuthenticated,
  loadingWithdrawals,
  minWithdrawAmount,
  pendingWithdrawalBalance,
  spendableBalance,
  t,
  userAddress,
  withdrawableBalance,
  withdrawals,
}: Readonly<ConsumerWithdrawPageModel>) {
  return (
    <div className="mx-auto w-full max-w-[920px] px-4 pb-24 pt-12 sm:px-6 lg:px-0">
      <div className="border-b border-[#2f3336] pb-8">
        <div className="flex items-center gap-3">
          <Wallet className="h-6 w-6 text-[#22c55e]" />
          <h1 className="text-[28px] font-semibold leading-9 tracking-[-0.02em] text-white">
            {t("consumerWithdrawPage.title")}
          </h1>
        </div>
        <p className="mt-2 text-[16px] leading-[24px] text-[#71767b]">
          {t("consumerWithdrawPage.description")}
        </p>
      </div>

      <div className="py-8">
        {error ? (
          <div className="mb-6 rounded-[8px] border border-[#4a1d24] bg-[#240b11] px-4 py-3 text-[14px] leading-5 text-[#ff9b9b]">
            {error}
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-3">
          <BalanceMetric
            label={t("creditsPage.withdrawableBalanceLabel")}
            amount={isBootstrapping ? 0 : withdrawableBalance}
            hint={t("consumerWithdrawPage.maturityHint")}
          />
          <BalanceMetric
            label={t("creditsPage.spendableBalanceLabel")}
            amount={isBootstrapping ? 0 : spendableBalance}
          />
          <BalanceMetric
            label={t("creditsPage.pendingWithdrawalBalanceLabel")}
            amount={pendingWithdrawalBalance}
            hint={
              activeWithdrawal
                ? t("consumerWithdrawPage.activeHint")
                : undefined
            }
          />
        </div>

        <section className="mt-6">
          <ConsumerWithdrawActionPanel
            activeWithdrawal={activeWithdrawal}
            canResume={canResume}
            isConnected={isConnected}
            isSessionAuthenticated={isSessionAuthenticated}
            minWithdrawAmount={minWithdrawAmount}
            spendableBalance={spendableBalance}
            userAddress={userAddress}
            withdrawableBalance={withdrawableBalance}
            ensureAccountReady={ensureAccountReady}
            handleWithdrawSuccess={handleWithdrawSuccess}
            t={t}
          />
        </section>

        <ConsumerWithdrawHistoryTable
          loadingWithdrawals={loadingWithdrawals}
          withdrawals={withdrawals}
          t={t}
        />
      </div>
    </div>
  );
}

export default function ConsumerWithdrawPage() {
  return <ConsumerWithdrawPageView {...useConsumerWithdrawPageModel()} />;
}
