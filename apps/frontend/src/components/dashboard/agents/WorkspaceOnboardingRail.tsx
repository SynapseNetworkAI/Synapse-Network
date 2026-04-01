"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Coins, KeyRound, Rocket, Wallet } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";

type RailState = "DONE" | "READY" | "LOCKED" | "BLOCKED";

type WorkspaceOnboardingRailProps = {
  treasuryBalance: number;
  allocatedCredits: number;
  activeAgents: number;
  hasCredential: boolean;
  hasSuccessfulInvocation: boolean;
  onCreateAgent: () => void;
};

type StepCard = {
  key: string;
  title: string;
  summary: string;
  state: RailState;
  href?: string;
  actionLabel: string;
  onAction?: () => void;
  icon: typeof Wallet;
};

function toneForState(state: RailState): string {
  if (state === "DONE") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  }
  if (state === "READY") {
    return "border-blue-500/25 bg-blue-500/10 text-blue-300";
  }
  if (state === "BLOCKED") {
    return "border-amber-500/25 bg-amber-500/10 text-amber-300";
  }
  return "border-white/10 bg-white/[0.03] text-gray-400";
}

function labelForState(state: RailState, t: (key: string) => string): string {
  if (state === "DONE") return t("agentsPage.workspaceRailStateDone");
  if (state === "READY") return t("agentsPage.workspaceRailStateReady");
  if (state === "BLOCKED") return t("agentsPage.workspaceRailStateBlocked");
  return t("agentsPage.workspaceRailStateLocked");
}

export default function WorkspaceOnboardingRail({
  treasuryBalance,
  allocatedCredits,
  activeAgents,
  hasCredential,
  hasSuccessfulInvocation,
  onCreateAgent,
}: Readonly<WorkspaceOnboardingRailProps>) {
  const { t } = useLanguage();

  const hasTreasury = treasuryBalance > 0;
  const hasAllocatedCredits = allocatedCredits > 0;
  const hasAgents = activeAgents > 0;

  const fundState: RailState = hasTreasury ? "DONE" : "READY";
  const createState: RailState = hasAgents ? "DONE" : hasTreasury ? "READY" : "LOCKED";
  const allocateState: RailState = hasAllocatedCredits ? "DONE" : hasAgents ? "READY" : "LOCKED";
  const credentialState: RailState = hasCredential ? "DONE" : hasAgents ? "READY" : "LOCKED";
  const invokeState: RailState = hasSuccessfulInvocation ? "DONE" : hasAllocatedCredits && hasCredential ? "READY" : "LOCKED";

  let statePanelTitle = t("agentsPage.workspaceRailStatePanelDoneTitle");
  let statePanelDescription = t("agentsPage.workspaceRailStatePanelDoneDescription");
  let statePanelPrimaryHref = "/dashboard/billing/credits";
  let statePanelPrimaryLabel = t("agentsPage.workspaceRailOpenCredits");
  let statePanelSecondaryHref = "/dashboard/agents";
  let statePanelSecondaryLabel = t("agentsPage.workspaceRailOpenGuide");

  if (!hasTreasury) {
    statePanelTitle = t("agentsPage.workspaceRailStatePanelDepositTitle");
    statePanelDescription = t("agentsPage.workspaceRailStatePanelDepositDescription");
    statePanelPrimaryHref = "/dashboard/billing";
    statePanelPrimaryLabel = t("agentsPage.workspaceRailOpenTreasury");
    statePanelSecondaryHref = "/dashboard/agents";
    statePanelSecondaryLabel = t("agentsPage.workspaceRailReviewRegistry");
  } else if (!hasAgents) {
    statePanelTitle = t("agentsPage.workspaceRailStatePanelCreateTitle");
    statePanelDescription = t("agentsPage.workspaceRailStatePanelCreateDescription");
    statePanelPrimaryHref = "";
    statePanelPrimaryLabel = t("agentsPage.workspaceRailCreateAgent");
    statePanelSecondaryHref = "/dashboard/billing";
    statePanelSecondaryLabel = t("agentsPage.workspaceRailOpenTreasury");
  } else if (!hasAllocatedCredits) {
    statePanelTitle = t("agentsPage.workspaceRailStatePanelAllocateTitle");
    statePanelDescription = t("agentsPage.workspaceRailStatePanelAllocateDescription");
    statePanelPrimaryHref = "/dashboard/billing/credits";
    statePanelPrimaryLabel = t("agentsPage.workspaceRailOpenCredits");
    statePanelSecondaryHref = "/dashboard/agents";
    statePanelSecondaryLabel = t("agentsPage.workspaceRailReviewRegistry");
  } else if (!hasSuccessfulInvocation) {
    statePanelTitle = t("agentsPage.workspaceRailStatePanelInvokeTitle");
    statePanelDescription = t("agentsPage.workspaceRailStatePanelInvokeDescription");
    statePanelPrimaryHref = "/dashboard/agents";
    statePanelPrimaryLabel = t("agentsPage.workspaceRailOpenGuide");
    statePanelSecondaryHref = "/dashboard/billing/credits";
    statePanelSecondaryLabel = t("agentsPage.workspaceRailOpenCredits");
  }

  const steps: StepCard[] = [
    {
      key: "fund",
      title: t("agentsPage.workspaceRailStepFundTitle"),
      summary: hasTreasury ? t("agentsPage.workspaceRailStepFundSummaryReady") : t("agentsPage.workspaceRailStepFundSummaryEmpty"),
      state: fundState,
      href: "/dashboard/billing",
      actionLabel: t("agentsPage.workspaceRailOpenTreasury"),
      icon: Wallet,
    },
    {
      key: "create",
      title: t("agentsPage.workspaceRailStepCreateTitle"),
      summary: hasAgents ? t("agentsPage.workspaceRailStepCreateSummaryReady") : t("agentsPage.workspaceRailStepCreateSummaryEmpty"),
      state: createState,
      actionLabel: t("agentsPage.workspaceRailCreateAgent"),
      onAction: onCreateAgent,
      icon: CheckCircle2,
    },
    {
      key: "allocate",
      title: t("agentsPage.workspaceRailStepAllocateTitle"),
      summary: hasAllocatedCredits ? t("agentsPage.workspaceRailStepAllocateSummaryReady") : t("agentsPage.workspaceRailStepAllocateSummaryEmpty"),
      state: allocateState,
      href: "/dashboard/billing/credits",
      actionLabel: t("agentsPage.workspaceRailOpenCredits"),
      icon: Coins,
    },
    {
      key: "credential",
      title: t("agentsPage.workspaceRailStepCredentialTitle"),
      summary: hasCredential ? t("agentsPage.workspaceRailStepCredentialSummaryReady") : t("agentsPage.workspaceRailStepCredentialSummaryEmpty"),
      state: credentialState,
      href: "/dashboard/agents",
      actionLabel: t("agentsPage.workspaceRailReviewRegistry"),
      icon: KeyRound,
    },
    {
      key: "invoke",
      title: t("agentsPage.workspaceRailStepInvokeTitle"),
      summary: hasSuccessfulInvocation ? t("agentsPage.workspaceRailStepInvokeSummaryReady") : t("agentsPage.workspaceRailStepInvokeSummaryEmpty"),
      state: invokeState,
      href: "/dashboard/agents",
      actionLabel: t("agentsPage.workspaceRailOpenGuide"),
      icon: Rocket,
    },
  ];

  return (
    <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(37,99,235,0.18),rgba(8,15,28,0.90))] p-6 shadow-[0_20px_80px_rgba(2,6,23,0.45)]">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-blue-300/80">{t("agentsPage.workspaceRailEyebrow")}</p>
          <div>
            <h2 className="text-2xl font-semibold text-white">{t("agentsPage.workspaceRailTitle")}</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-300">{t("agentsPage.workspaceRailDescription")}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {statePanelPrimaryHref ? (
            <Link href={statePanelPrimaryHref} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-xs font-bold uppercase tracking-[0.22em] text-slate-950 transition hover:bg-blue-100">
              {statePanelPrimaryLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <button type="button" onClick={onCreateAgent} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-xs font-bold uppercase tracking-[0.22em] text-slate-950 transition hover:bg-blue-100">
              {statePanelPrimaryLabel}
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
          <Link href={statePanelSecondaryHref} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 text-xs font-bold uppercase tracking-[0.22em] text-white transition hover:bg-white/[0.08]">
            {statePanelSecondaryLabel}
          </Link>
        </div>
      </header>

      <div className="mt-6 grid gap-3 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {steps.map((step) => {
            const Icon = step.icon;
            const card = (
              <article className={`h-full rounded-2xl border p-4 transition ${toneForState(step.state)}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-current/75">{step.title}</p>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-white">{step.summary}</p>
                  </div>
                  <span className="rounded-full border border-current/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-current">
                    {labelForState(step.state, t)}
                  </span>
                </div>
                <div className="mt-4">
                  {step.href ? (
                    <Link href={step.href} className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-current transition hover:text-white">
                      {step.actionLabel}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  ) : (
                    <button type="button" onClick={step.onAction} className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-current transition hover:text-white">
                      {step.actionLabel}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </article>
            );

            return <div key={step.key}>{card}</div>;
          })}
        </div>

        <aside className="rounded-2xl border border-white/10 bg-black/20 p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">{t("agentsPage.currentSummaryLabel")}</p>
          <h3 className="mt-3 text-lg font-semibold text-white">{statePanelTitle}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-300">{statePanelDescription}</p>
        </aside>
      </div>
    </section>
  );
}
