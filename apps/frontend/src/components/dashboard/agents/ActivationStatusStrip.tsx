"use client";

import { Activity, ArrowRight, Bot, ShieldCheck, Wallet } from "lucide-react";

type ActivationStatusStripProps = {
  isConnected: boolean;
  isSessionAuthenticated: boolean;
  ownerBalance: string;
  activeAgents: number;
  lastInvocationAt?: number;
  primaryActionLabel: string;
  onPrimaryAction: () => void;
  isPrimaryActionDisabled?: boolean;
};

function formatInvocationTime(timestamp?: number): string {
  if (!timestamp) {
    return "No successful invocation yet";
  }

  return new Date(timestamp * 1000).toLocaleString();
}

function getStatusTone(isReady: boolean): string {
  return isReady
    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
    : "border-white/10 bg-white/[0.03] text-gray-400";
}

export default function ActivationStatusStrip({
  isConnected,
  isSessionAuthenticated,
  ownerBalance,
  activeAgents,
  lastInvocationAt,
  primaryActionLabel,
  onPrimaryAction,
  isPrimaryActionDisabled = false,
}: Readonly<ActivationStatusStripProps>) {
  const metrics = [
    {
      title: "Wallet",
      value: isConnected ? "Connected" : "Disconnected",
      icon: Wallet,
      tone: getStatusTone(isConnected),
    },
    {
      title: "Session",
      value: isSessionAuthenticated ? "Authenticated" : "Missing",
      icon: ShieldCheck,
      tone: getStatusTone(isSessionAuthenticated),
    },
    {
      title: "Spendable Balance",
      value: `${ownerBalance} USDC`,
      icon: Wallet,
      tone: getStatusTone(Number(ownerBalance) > 0),
    },
    {
      title: "Active Agents",
      value: String(activeAgents),
      icon: Bot,
      tone: getStatusTone(activeAgents > 0),
    },
    {
      title: "Last Invocation",
      value: formatInvocationTime(lastInvocationAt),
      icon: Activity,
      tone: getStatusTone(Boolean(lastInvocationAt)),
    },
  ] as const;

  return (
    <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(59,130,246,0.14),rgba(8,15,28,0.82))] p-6 shadow-[0_20px_80px_rgba(2,6,23,0.45)]" aria-label="Activation status strip">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-blue-300/80">Activation Status</p>
          <div>
            <h2 className="text-2xl font-semibold text-white">Owner readiness for the first paid agent call</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-300">
              Synapse is only activated when an issued credential completes a paid invocation. This strip shows the current blocker and the next action.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onPrimaryAction}
          disabled={isPrimaryActionDisabled}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-xs font-bold uppercase tracking-[0.22em] text-slate-950 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {primaryActionLabel}
          <ArrowRight className="h-4 w-4" />
        </button>
      </header>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {metrics.map((item) => {
          const Icon = item.icon;
          return (
            <article key={item.title} className={`rounded-2xl border p-4 ${item.tone}`}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em]">{item.title}</p>
                <span className="rounded-xl border border-current/15 bg-black/10 p-2" aria-hidden="true">
                  <Icon className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-4 text-sm font-semibold text-white">{item.value}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}