"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  Copy,
  HelpCircle,
  KeyRound,
  Rocket,
  Wallet,
} from "lucide-react";
import toast from "react-hot-toast";
import DepositUsdcModal from "@/components/dashboard/shared/DepositUsdcModal";
import { useVaultDeposit } from "@/hooks/useVaultDeposit";
import { useAuth } from "@/components/WalletAuthGuard";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useLanguage } from "@/components/i18n/LanguageProvider";

type RunwayStep = "deposit" | "agent" | "credential" | "invoke";
type RunwayState = "LOCKED" | "READY" | "DONE" | "BLOCKED";

type ActivationRunwayProps = {
  isConnected: boolean;
  hasSession: boolean;
  ownerBalance: string;
  hasActiveAgent: boolean;
  latestCredentialPrefix?: string;
  latestIssuedToken?: string;
  hasSuccessfulInvocation: boolean;
  onAgentCreated: () => void;
  onRunExample: () => void;
  onDepositComplete?: () => void;
  onCopyLatestCredential?: () => void;
};

type RunwayCard = {
  step: RunwayStep;
  title: string;
  state: RunwayState;
  summary: string;
  hint: string;
  actionLabel: string;
  disabled?: boolean;
  icon: typeof Wallet;
  tooltip?: string;
};

type RunwayAvailability = {
  isConnected: boolean;
  hasSession: boolean;
  hasBalance: boolean;
  hasActiveAgent: boolean;
  hasCredential: boolean;
  hasSuccessfulInvocation: boolean;
  ownerBalance: string;
  walletUsdcBalance: number;
  latestCredentialPrefix?: string;
  latestIssuedToken?: string;
};

function getStateTone(state: RunwayState): string {
  if (state === "DONE") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  }
  if (state === "READY") {
    return "border-blue-500/25 bg-blue-500/10 text-blue-300";
  }
  if (state === "BLOCKED") {
    return "border-amber-500/25 bg-amber-500/10 text-amber-300";
  }
  return "border-white/10 bg-white/[0.02] text-gray-400";
}

function getDepositState(availability: RunwayAvailability): RunwayState {
  if (!(availability.isConnected && availability.hasSession)) {
    return "BLOCKED";
  }
  return availability.hasBalance ? "DONE" : "READY";
}

function getDepositHint(availability: RunwayAvailability, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (!availability.isConnected) {
    return t("agentsPage.runwayConnectWalletHint");
  }
  if (!availability.hasSession) {
    return t("agentsPage.runwaySignInHint");
  }
  if (availability.hasBalance) {
    return t("agentsPage.runwayCurrentBalanceHint", { balance: availability.ownerBalance });
  }
  return t("agentsPage.runwayWalletBalanceHint", { balance: availability.walletUsdcBalance.toFixed(2) });
}

function getAgentState(availability: RunwayAvailability): RunwayState {
  if (availability.hasActiveAgent) {
    return "DONE";
  }
  if (availability.hasBalance) {
    return "READY";
  }
  return "LOCKED";
}

function getCredentialState(availability: RunwayAvailability): RunwayState {
  if (availability.hasCredential) {
    return "DONE";
  }
  if (availability.hasActiveAgent) {
    return "READY";
  }
  return "LOCKED";
}

function getInvokeState(availability: RunwayAvailability): RunwayState {
  if (availability.hasSuccessfulInvocation) {
    return "DONE";
  }
  if (availability.hasCredential) {
    return "READY";
  }
  return "LOCKED";
}

function buildRunwayCards(
  availability: RunwayAvailability,
  t: (key: string, vars?: Record<string, string | number>) => string,
): RunwayCard[] {
  const depositState = getDepositState(availability);
  const depositHint = getDepositHint(availability, t);
  const agentState = getAgentState(availability);
  const credentialState = getCredentialState(availability);
  const invokeState = getInvokeState(availability);

  return [
    {
      step: "deposit",
      title: t("agentsPage.runwayFundOwnerVaultTitle"),
      state: depositState,
      summary: `${availability.ownerBalance} USDC available`,
      hint: depositHint,
      actionLabel: t("agentsPage.runwayDepositUsdc"),
      icon: Wallet,
      tooltip: t("agentsPage.runwayDepositTooltip"),
    },
    {
      step: "agent",
      title: t("agentsPage.runwayCreateAgentRuntimeTitle"),
      state: agentState,
      summary: availability.hasActiveAgent ? t("agentsPage.runwayAgentCreated") : t("agentsPage.runwayNoActiveAgent"),
      hint: availability.hasBalance
        ? t("agentsPage.runwayFundingReady")
        : t("agentsPage.runwayFundVaultFirst"),
      actionLabel: t("agentsPage.runwayCreateAgentAction"),
      disabled: !availability.hasBalance,
      icon: Bot,
      tooltip: t("agentsPage.runwayAgentTooltip"),
    },
    {
      step: "credential",
      title: t("agentsPage.runwayCaptureCredentialTitle"),
      state: credentialState,
      summary: availability.hasCredential
        ? t("agentsPage.runwayCredentialSummary", { prefix: availability.latestCredentialPrefix ?? "" })
        : t("agentsPage.runwayNoCredentialVisible"),
      hint: availability.hasCredential
        ? t("agentsPage.runwayCopySaveToken")
        : t("agentsPage.runwayCreateAgentFirst"),
      actionLabel: t("agentsPage.runwayCopyCredential"),
      disabled: !availability.hasCredential,
      icon: KeyRound,
      tooltip: t("agentsPage.runwayCredentialTooltip"),
    },
    {
      step: "invoke",
      title: t("agentsPage.runwayRunInvocationTitle"),
      state: invokeState,
      summary: availability.hasSuccessfulInvocation
        ? t("agentsPage.runwayInvocationCompleted")
        : t("agentsPage.noSuccessfulInvocationYet"),
      hint: availability.hasCredential
        ? t("agentsPage.runwayScrollSandbox")
        : t("agentsPage.runwayCompletePreviousSteps"),
      actionLabel: t("agentsPage.runwayRunExample"),
      disabled: !availability.hasCredential,
      icon: Rocket,
      tooltip: t("agentsPage.runwayInvokeTooltip"),
    },
  ];
}

export default function ActivationRunway({
  isConnected,
  hasSession,
  ownerBalance,
  hasActiveAgent,
  latestCredentialPrefix,
  latestIssuedToken,
  hasSuccessfulInvocation,
  onAgentCreated,
  onRunExample,
  onDepositComplete,
  onCopyLatestCredential,
}: Readonly<ActivationRunwayProps>) {
  const { t } = useLanguage();
  const { isSessionAuthenticated, authorize } = useAuth();
  const { openConnectModal } = useConnectModal();
  const [activeStep, setActiveStep] = useState<RunwayStep>("deposit");
  const [copiedCredential, setCopiedCredential] = useState(false);

  const hasBalance = Number(ownerBalance) > 0;
  const hasCredential = Boolean(latestCredentialPrefix);

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
    initialAmount: "10",
    onDepositSynced: async () => {
      setActiveStep("agent");
      onDepositComplete?.();
      toast.success(t("agentsPage.depositConfirmedToast"));
    },
  });

  useEffect(() => {
    if (!isConnected || !hasSession) {
      setActiveStep("deposit");
      return;
    }
    if (Number(ownerBalance) <= 0) {
      setActiveStep("deposit");
      return;
    }
    if (!hasActiveAgent) {
      setActiveStep("agent");
      return;
    }
    if (!latestCredentialPrefix) {
      setActiveStep("credential");
      return;
    }
    setActiveStep("invoke");
  }, [hasActiveAgent, hasSession, isConnected, latestCredentialPrefix, ownerBalance]);

  const handleCopyCredential = useCallback(() => {
    if (!latestIssuedToken) {
      return;
    }
    navigator.clipboard.writeText(latestIssuedToken);
    setCopiedCredential(true);
    onCopyLatestCredential?.();
    toast.success(t("agentsPage.credentialCopiedToast"));
    setTimeout(() => setCopiedCredential(false), 2000);
  }, [latestIssuedToken, onCopyLatestCredential, t]);

  const cards = buildRunwayCards({
    isConnected,
    hasSession,
    hasBalance,
    hasActiveAgent,
    hasCredential,
    hasSuccessfulInvocation,
    ownerBalance,
    walletUsdcBalance,
    latestCredentialPrefix,
    latestIssuedToken,
  }, t);

  const handleCardAction = useCallback(async (card: RunwayCard) => {
    if (card.step === "deposit") {
      // Check authentication before opening deposit modal
      if (!isConnected) {
        openConnectModal?.();
        return;
      }
      if (!isSessionAuthenticated) {
        const ok = await authorize();
        if (!ok) {
          return;
        }
      }
      openDepositModal();
      return;
    }
    if (card.step === "agent") {
      onAgentCreated();
      return;
    }
    if (card.step === "credential") {
      if (latestIssuedToken) {
        handleCopyCredential();
      } else {
        onAgentCreated();
      }
      return;
    }
    onRunExample();
  }, [handleCopyCredential, latestIssuedToken, onAgentCreated, onRunExample, isConnected, isSessionAuthenticated, authorize, openConnectModal, openDepositModal, t]);

  return (
    <section id="activation-runway" className="space-y-6" aria-label={t("agentsPage.activationRunwayAria")}>
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-300/80">{t("agentsPage.activationRunwayEyebrow")}</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{t("agentsPage.activationRunwayTitle")}</h2>
          <p className="mt-2 max-w-3xl text-sm text-gray-400">
            {t("agentsPage.activationRunwayDescription")}
          </p>
        </div>
        {hasSuccessfulInvocation && (
          <p className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            {t("agentsPage.firstPaidInvocationCompleted")}
          </p>
        )}
      </header>

      <div className="grid gap-4 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          const isActive = activeStep === card.step;

          return (
            <article
              key={card.step}
              className={`rounded-[24px] border p-5 transition ${getStateTone(card.state)} ${isActive ? "ring-1 ring-blue-400/40" : ""}`}
            >
              <div className="flex items-start justify-between gap-4">
                <span className="rounded-2xl border border-current/15 bg-black/10 p-3" aria-hidden="true">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveStep(card.step)}
                    className="text-[10px] font-bold uppercase tracking-[0.24em] text-current/80"
                  >
                    {card.state}
                  </button>
                  {card.tooltip && (
                    <div className="group/tooltip relative">
                      <button
                        type="button"
                        className="text-current/60 hover:text-current transition"
                        aria-label={t("agentsPage.activationStatusHelpAria", { title: card.title })}
                        aria-describedby={`${card.step}-tooltip`}
                      >
                        <HelpCircle className="h-4 w-4" />
                      </button>
                      <div
                        id={`${card.step}-tooltip`}
                        role="tooltip"
                        className="pointer-events-none absolute right-0 top-6 z-20 w-64 translate-y-1 rounded-lg border border-white/20 bg-black/95 p-3 text-xs leading-5 text-gray-300 opacity-0 shadow-lg transition-all duration-150 group-hover/tooltip:translate-y-0 group-hover/tooltip:opacity-100 group-focus-within/tooltip:translate-y-0 group-focus-within/tooltip:opacity-100"
                      >
                        {card.tooltip}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-5 space-y-3">
                <h3 className="text-lg font-semibold text-white">{card.title}</h3>

                <dl className="rounded-2xl border border-white/8 bg-black/10 p-4">
                  <dt className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">{t("agentsPage.currentSummaryLabel")}</dt>
                  <dd className="mt-2 text-sm font-medium text-white">{card.summary}</dd>
                  <dd className="mt-3 text-xs leading-5 text-gray-400">{card.hint}</dd>
                </dl>

                <button
                  type="button"
                  onClick={() => handleCardAction(card)}
                  disabled={card.disabled}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white px-4 py-3 text-xs font-bold uppercase tracking-[0.22em] text-slate-950 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-gray-500"
                >
                  {card.step === "credential" && latestIssuedToken && copiedCredential ? <Copy className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {card.step === "credential" && latestIssuedToken && copiedCredential ? t("agentsPage.copied") : card.actionLabel}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <DepositUsdcModal
        isOpen={isDepositModalOpen}
        title={t("agentsPage.depositModalTitle")}
        description={t("agentsPage.depositModalDescription")}
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
        onConfirm={handleDeposit}
      />
    </section>
  );
}
