"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  Copy,
  KeyRound,
  Rocket,
  Wallet,
} from "lucide-react";
import toast from "react-hot-toast";
import DepositUsdcModal from "@/components/dashboard/shared/DepositUsdcModal";
import { useVaultDeposit } from "@/hooks/useVaultDeposit";

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
  description: string;
  state: RunwayState;
  summary: string;
  hint: string;
  actionLabel: string;
  disabled?: boolean;
  icon: typeof Wallet;
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

function getDepositHint(availability: RunwayAvailability): string {
  if (!availability.isConnected) {
    return "Connect wallet first.";
  }
  if (!availability.hasSession) {
    return "Sign in to authorize deposits.";
  }
  return `Wallet balance: ${availability.walletUsdcBalance.toFixed(2)} USDC`;
}

function getAgentState(availability: RunwayAvailability): RunwayState {
  if (!(availability.isConnected && availability.hasSession)) {
    return "LOCKED";
  }
  if (!availability.hasBalance) {
    return "BLOCKED";
  }
  return availability.hasActiveAgent ? "DONE" : "READY";
}

function getCredentialState(availability: RunwayAvailability): RunwayState {
  if (!(availability.isConnected && availability.hasSession)) {
    return "LOCKED";
  }
  if (!availability.hasActiveAgent) {
    return "LOCKED";
  }
  return availability.hasCredential ? "DONE" : "READY";
}

function getCredentialActionLabel(availability: RunwayAvailability): string {
  if (availability.latestIssuedToken) {
    return "Copy Latest Token";
  }
  if (availability.hasCredential) {
    return "Credential Active";
  }
  return "Issue Credential";
}

function getInvokeState(availability: RunwayAvailability): RunwayState {
  if (!(availability.isConnected && availability.hasSession)) {
    return "LOCKED";
  }
  if (!availability.hasActiveAgent) {
    return "LOCKED";
  }
  if (!availability.hasBalance) {
    return "BLOCKED";
  }
  return availability.hasSuccessfulInvocation ? "DONE" : "READY";
}

function buildRunwayCards(availability: RunwayAvailability): RunwayCard[] {
  return [
    {
      step: "deposit",
      title: "Fund Owner Vault",
      description: "Move wallet USDC into Synapse credit so the runtime can settle paid calls.",
      state: getDepositState(availability),
      summary: `${availability.ownerBalance} USDC spendable`,
      hint: getDepositHint(availability),
      actionLabel: availability.hasBalance ? "Add More Funds" : "Deposit USDC",
      icon: Wallet,
    },
    {
      step: "agent",
      title: "Create Agent Runtime",
      description: "Issue a runtime identity with budget and call guards bound to the current owner.",
      state: getAgentState(availability),
      summary: availability.hasActiveAgent ? "At least one active agent exists" : "No active agent yet",
      hint: availability.hasBalance ? "Creation opens the credential issuance modal." : "Funding is required before issuing runtime credentials.",
      actionLabel: availability.hasActiveAgent ? "Create Another Agent" : "Create Agent",
      disabled: !(availability.isConnected && availability.hasSession && availability.hasBalance),
      icon: Bot,
    },
    {
      step: "credential",
      title: "Capture Credential",
      description: "Store the one-time secret somewhere your runtime can access it when calling Synapse.",
      state: getCredentialState(availability),
      summary: availability.latestCredentialPrefix ? `Token prefix: ${availability.latestCredentialPrefix}` : "No credential visible yet",
      hint: availability.latestIssuedToken ? "Copy the full credential now. It will not be shown again." : "Existing cards only show the token prefix for safety.",
      actionLabel: getCredentialActionLabel(availability),
      disabled: !availability.latestIssuedToken && availability.hasCredential,
      icon: KeyRound,
    },
    {
      step: "invoke",
      title: "Run First Paid Invocation",
      description: "Use the credential to discover a service, settle payment, and verify a real gateway response.",
      state: getInvokeState(availability),
      summary: availability.hasSuccessfulInvocation ? "At least one paid invocation succeeded" : "No successful invocation recorded",
      hint: availability.hasSuccessfulInvocation ? "Use the panel below to repeat against another service." : "Paste the saved credential into the sandbox and run the example.",
      actionLabel: availability.hasSuccessfulInvocation ? "Run Again" : "Run Example",
      disabled: !(availability.isConnected && availability.hasSession && availability.hasActiveAgent && availability.hasBalance),
      icon: Rocket,
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
  const hasBalance = Number(ownerBalance) > 0;
  const hasCredential = Boolean(latestCredentialPrefix);
  const [activeStep, setActiveStep] = useState<RunwayStep>("deposit");
  const [copiedCredential, setCopiedCredential] = useState(false);
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
      toast.success("Deposit confirmed. You can create the first runtime now.");
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
    toast.success("Credential copied to clipboard.");
    setTimeout(() => setCopiedCredential(false), 2000);
  }, [latestIssuedToken, onCopyLatestCredential]);

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
  });

  const handleCardAction = useCallback((card: RunwayCard) => {
    if (card.step === "deposit") {
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
  }, [handleCopyCredential, latestIssuedToken, onAgentCreated, onRunExample, openDepositModal]);

  return (
    <section id="activation-runway" className="space-y-6" aria-label="Activation runway">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-300/80">Activation Runway</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">From funded owner to first paid agent call</h2>
          <p className="mt-2 max-w-3xl text-sm text-gray-400">
            The runtime is only truly ready after a credential-backed invocation succeeds. These four stages make the blocker explicit and keep the next action local.
          </p>
        </div>
        {hasSuccessfulInvocation && (
          <p className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            First paid invocation completed
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
                <button
                  type="button"
                  onClick={() => setActiveStep(card.step)}
                  className="text-[10px] font-bold uppercase tracking-[0.24em] text-current/80"
                >
                  {card.state}
                </button>
              </div>

              <div className="mt-5 space-y-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">{card.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-300">{card.description}</p>
                </div>

                <dl className="rounded-2xl border border-white/8 bg-black/10 p-4">
                  <dt className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Current Summary</dt>
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
                  {card.step === "credential" && latestIssuedToken && copiedCredential ? "Copied" : card.actionLabel}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <DepositUsdcModal
        isOpen={isDepositModalOpen}
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