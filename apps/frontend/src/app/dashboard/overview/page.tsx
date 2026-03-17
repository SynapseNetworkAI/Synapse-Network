"use client";

import { useRouter } from "next/navigation";
import { Bot, Database, ArrowRight, Activity } from "lucide-react";
import { useAccount } from "wagmi";
import { useBuyerData } from "@/hooks/useBuyerData";

export default function VercelStyleOverviewPage() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { stats } = useBuyerData();

  // Convert to formatted string to ensure standard display mapping
  const currentBalance = isConnected ? (stats?.buyerBalance || "0.00") : "0.00";

  return (
    <div className="min-h-[calc(100vh-73px)] w-full bg-[#0a0a0a] text-white font-sans">
      {/* Maximum width constraint container equivalent to Stripe/Vercel narrow layouts */}
      <div className="mx-auto w-full max-w-5xl px-6 py-12 md:py-20 lg:px-8">
        
        {/* HEADER & VAULT BADGE */}
        <header className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div className="space-y-1">
            <h1 className="text-[28px] font-semibold tracking-tight text-zinc-100">
              Welcome to Synapse Network.
            </h1>
            <p className="text-[15px] font-medium text-zinc-500">
              The settlement layer for machine-to-machine economy.
            </p>
          </div>

          <div
            onClick={() => router.push("/dashboard/billing")}
            className="group flex cursor-pointer items-center gap-3 rounded-full border border-white/10 bg-zinc-900/40 px-4 py-1.5 shadow-sm transition hover:border-zinc-700 hover:bg-zinc-900"
          >
            <div className="relative flex h-2 w-2 items-center justify-center">
              <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-500 opacity-30"></span>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
            </div>
            <span className="font-mono text-[13px] font-medium tracking-wide text-zinc-200">
              {currentBalance} <span className="text-zinc-500">USDC</span>
            </span>
          </div>
        </header>

        {/* THE TWIN ENGINES (CORE TWO CARDS) */}
        <section className="mb-14 grid grid-cols-1 gap-5 md:grid-cols-2">
          
          {/* CARD 1: AGENT WORKSPACE */}
          <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/5 bg-[#111113] p-8 transition-all hover:border-zinc-600 hover:bg-[#151518]">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-emerald-900/10 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            
            <div className="relative z-10 mb-10">
              <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-800/80 shadow-inner">
                <Bot className="h-6 w-6 text-emerald-400" />
              </div>
              <h2 className="mb-3 text-[22px] font-semibold tracking-tight text-white">
                Agent Workspace
              </h2>
              <p className="text-[15px] leading-relaxed text-zinc-400">
                Fund your agents and let them consume APIs autonomously. Issue keys, set budgets, and observe runtime behavior.
              </p>
            </div>

            <div className="relative z-10 flex flex-wrap items-center gap-3">
              <button
                onClick={() => router.push("/dashboard/console")}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 px-5 py-2.5 text-[14px] font-medium text-black transition-colors"
              >
                Create Agent
              </button>
              <button
                onClick={() => router.push("/dashboard/discover")}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-transparent px-5 py-2.5 text-[14px] font-medium text-zinc-300 transition-colors hover:bg-white/5"
              >
                Explore APIs
              </button>
            </div>
          </div>

          {/* CARD 2: PROVIDER WORKSPACE */}
          <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/5 bg-[#111113] p-8 transition-all hover:border-zinc-600 hover:bg-[#151518]">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-900/10 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            
            <div className="relative z-10 mb-10">
              <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-800/80 shadow-inner">
                <Database className="h-6 w-6 text-blue-400" />
              </div>
              <h2 className="mb-3 text-[22px] font-semibold tracking-tight text-white">
                Provider Workspace
              </h2>
              <p className="text-[15px] leading-relaxed text-zinc-400">
                Expose your services to the network and earn USDC instantly. Zero-gas metering backed by the Synapse gateway.
              </p>
            </div>

            <div className="relative z-10 flex flex-wrap items-center gap-3">
              <button
                onClick={() => router.push("/provider/sell")}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-500 hover:border-zinc-400 bg-zinc-800/50 px-5 py-2.5 text-[14px] font-medium text-white transition-colors hover:bg-zinc-700/50"
              >
                Register Service
              </button>
              <button
                onClick={() => router.push("/provider/sell")}
                className="inline-flex items-center gap-2 rounded-lg border border-transparent bg-transparent px-5 py-2.5 text-[14px] font-medium text-zinc-400 transition-colors hover:text-zinc-200"
              >
                View Earnings
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          
        </section>

        {/* RECENT ACTIVITY */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 text-[13px] font-medium uppercase tracking-[0.1em] text-zinc-600">
            <Activity className="h-4 w-4" />
            Recent Activity
          </div>
          <div className="flex min-h-[140px] items-center justify-center rounded-xl border border-dashed border-white/10 bg-[#0a0a0a]">
            <p className="text-[14px] text-zinc-500">
              No recent activity. Launch an agent or register a service to get started.
            </p>
          </div>
        </section>

      </div>
    </div>
  );
}