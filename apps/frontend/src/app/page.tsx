"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setAppRole } from "@/utils/roleStore";
import { ArrowRight } from "lucide-react";
import { useAccount } from "wagmi";
import { fetchPublicNetworkStats, type PublicNetworkStats } from "@/utils/networkStatsApi";
import { useLanguage } from "@/components/i18n/LanguageProvider";

const HOMEPAGE_STATS_POLL_MS = 12000;

const EMPTY_NETWORK_STATS: PublicNetworkStats = {
  totalCalls: 0,
  registeredServices: 0,
  connectedAgents: 0,
  runtimeReadyServices: 0,
};

const AGENT_NETWORK_NODES = [
  "agent-network-node-a",
  "agent-network-node-b",
  "agent-network-node-c",
  "agent-network-node-d",
  "agent-network-node-e",
  "agent-network-node-f",
];

const AGENT_NETWORK_FLOWS = [
  "agent-network-flow-a",
  "agent-network-flow-b",
  "agent-network-flow-c",
  "agent-network-flow-d",
];

function easeOutQuart(progress: number): number {
  return 1 - (1 - progress) ** 4;
}

function AnimatedCounter({ value }: Readonly<{ value: number }>) {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValueRef = useRef(value);

  useEffect(() => {
    const startValue = previousValueRef.current;
    const endValue = value;
    previousValueRef.current = endValue;

    if (startValue === endValue) {
      setDisplayValue(endValue);
      return;
    }

    let frameId = 0;
    const startedAt = performance.now();
    const durationMs = 900;

    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / durationMs, 1);
      const eased = easeOutQuart(progress);
      setDisplayValue(Math.round(startValue + (endValue - startValue) * eased));
      if (progress < 1) {
        frameId = globalThis.requestAnimationFrame(tick);
      }
    };

    frameId = globalThis.requestAnimationFrame(tick);
    return () => {
      globalThis.cancelAnimationFrame(frameId);
    };
  }, [value]);

  return <>{new Intl.NumberFormat("en-US").format(displayValue)}</>;
}

export default function Home() {
  const router = useRouter();
  useAccount();
  const { t } = useLanguage();

  const [networkStats, setNetworkStats] = useState<PublicNetworkStats>(EMPTY_NETWORK_STATS);

  const handleEnterRole = (role: "CONSUMER" | "PROVIDER" | "ADMIN", path: string) => {
    setAppRole(role);
    router.push(path);
  };

  const capabilityNodes = [
    {
      title: t("home.discoveryTitle"),
      body: t("home.discoveryBody"),
    },
    {
      title: t("home.budgetTitle"),
      body: t("home.budgetBody"),
    },
    {
      title: t("home.settlementTitle"),
      body: t("home.settlementBody"),
    },
  ];

  useEffect(() => {
    let mounted = true;

    const loadNetworkStats = async () => {
      const nextStats = await fetchPublicNetworkStats();
      if (!mounted) {
        return;
      }
      setNetworkStats(nextStats);
    };

    void loadNetworkStats();
    const interval = globalThis.setInterval(() => {
      void loadNetworkStats();
    }, HOMEPAGE_STATS_POLL_MS);

    return () => {
      mounted = false;
      globalThis.clearInterval(interval);
    };
  }, []);

  const heroStats = [
    {
      label: t("home.totalCallsLabel"),
      value: networkStats.totalCalls,
    },
    {
      label: t("home.registeredServicesLabel"),
      value: networkStats.registeredServices,
    },
    {
      label: t("home.connectedAgentsLabel"),
      value: networkStats.connectedAgents,
    },
  ];

  return (
    <div className="relative overflow-hidden bg-black text-white selection:bg-white selection:text-black">
      <main className="relative">
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-black" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.02] [background-image:linear-gradient(rgba(255,255,255,1)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,1)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(circle_at_center,black,transparent_80%)]" />
          <div className="pointer-events-none absolute left-1/2 top-[20%] h-[30rem] w-[50rem] -translate-x-1/2 rounded-full bg-emerald-900/20 blur-3xl opacity-50" />
          
          <div className="ambient-signal ambient-signal-left" />
          <div className="ambient-signal ambient-signal-right" />
          <div className="ambient-orb ambient-orb-left" />
          <div className="ambient-orb ambient-orb-right" />
          <div className="hero-trace hero-trace-left" />
          <div className="hero-trace hero-trace-right" />
          <div className="hero-trace hero-trace-center" />
          {AGENT_NETWORK_FLOWS.map((className) => (
            <div key={className} className={`agent-network-flow ${className}`} />
          ))}
          {AGENT_NETWORK_NODES.map((className) => (
            <div key={className} className={`agent-network-node ${className}`} />
          ))}

          <div className="relative mx-auto flex min-h-[calc(100svh-76px)] max-w-6xl flex-col justify-center px-6 py-24 sm:py-28">
            <div className="mx-auto max-w-5xl text-center">
              <h1 className="mx-auto text-center text-[clamp(2rem,4.5vw,3.75rem)] font-extrabold leading-tight tracking-tight text-white lg:leading-none">
                {t("home.heroTitlePart1")}
                <br className="hidden md:block" />
                <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                  {t("home.heroTitlePart2")}
                </span>
                {t("home.heroTitlePart3")}
                <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                  {t("home.heroTitlePart4")}
                </span>
              </h1>
              
              <div className="mx-auto mt-8 max-w-3xl flex flex-col gap-2">
                <p className="text-xl font-medium tracking-tight text-white md:text-2xl">
                  {t("home.heroTagline")}
                </p>
                <p className="text-sm leading-relaxed text-zinc-500 md:text-base">
                  {t("home.heroSubtitle")}
                </p>
              </div>

              <div className="mx-auto mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <button
                  onClick={() => handleEnterRole("CONSUMER", "/dashboard/overview")}
                  className="group relative inline-flex items-center justify-center gap-2 rounded-full bg-emerald-500 px-8 py-3.5 text-base font-semibold text-black transition-all hover:-translate-y-0.5 hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.4)]"
                >
                  Launch Console
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </button>
                <button
                  onClick={() => router.push("/dashboard/console")}
                  className="inline-flex items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/50 px-8 py-3.5 text-base font-semibold text-white backdrop-blur-md transition-all hover:bg-zinc-800 hover:text-zinc-200"
                >
                  Read Documentation
                </button>
              </div>

              <div className="mx-auto mt-16 grid max-w-5xl gap-6 sm:grid-cols-3">
                {heroStats.map((item) => (
                  <article
                    key={item.label}
                    className="relative flex cursor-default flex-col items-center rounded-2xl border border-white/10 bg-zinc-900/50 px-6 py-8 text-center backdrop-blur-md transition-colors duration-500 hover:border-green-500/30"
                  >
                    <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                      {item.label}
                    </p>
                    <p className="mt-4 font-mono text-4xl font-bold tracking-tight text-white sm:text-5xl">
                      <AnimatedCounter value={item.value} />
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="relative mx-auto max-w-7xl px-6 py-24 sm:py-28">
          <div className="mx-auto max-w-5xl py-6 sm:py-10">
            <div className="mx-auto max-w-4xl text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7ff7be]">
                {t("home.capabilitiesEyebrow")}
              </p>
              <h2 className="mt-4 text-4xl font-[760] tracking-[-0.05em] text-white md:text-5xl lg:text-[3.7rem] lg:leading-[1.02]">
                {t("home.capabilitiesTitle")}
              </h2>
              <p className="mx-auto mt-6 max-w-3xl text-base leading-8 text-[#8d8d95] md:text-lg">
                {t("home.capabilitiesBody")}
              </p>
            </div>

            <div className="mx-auto mt-16 max-w-5xl lg:mt-20">
              <div className="grid gap-4 md:grid-cols-3 md:gap-5">
                {capabilityNodes.map((node) => (
                  <article
                    key={node.title}
                    className="rounded-[1.8rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.012))] px-6 py-7 text-left shadow-[0_24px_80px_rgba(0,0,0,0.16)]"
                  >
                    <h3 className="text-[1.55rem] font-semibold tracking-[-0.04em] text-white">
                      {node.title}
                    </h3>
                    <p className="mt-4 text-sm leading-7 text-[#8d8d95]">
                      {node.body}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-20 rounded-[2rem] border border-white/10 bg-white/[0.03] px-6 py-10 text-center shadow-[0_30px_120px_rgba(0,0,0,0.26)] sm:px-10">
            <p className="mx-auto max-w-4xl text-xl font-medium leading-9 text-[#d2d2d7] md:text-2xl">
              {t("home.finalLine")}
            </p>
            <div className="mt-8 flex flex-col justify-center gap-4 sm:flex-row">
              <button
                onClick={() => handleEnterRole("CONSUMER", "/dashboard/discovery")}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#7ff7be] px-6 py-3 text-sm font-semibold text-black transition hover:bg-[#6ae5ac]"
              >
                {t("home.finalCta")}
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => handleEnterRole("PROVIDER", "/provider/sell")}
                className="inline-flex items-center justify-center rounded-full border border-white/16 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/35 hover:bg-white/[0.05]"
              >
                {t("home.providerWorkspaceBtn")}
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
