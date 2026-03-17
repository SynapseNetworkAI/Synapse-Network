"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setAppRole } from "@/utils/roleStore";
import { ArrowRight } from "lucide-react";
import { useAccount, useDisconnect } from "wagmi";
import { getWalletRole } from "@/utils/serviceApi";
import { fetchPublicNetworkStats, type PublicNetworkStats } from "@/utils/networkStatsApi";
import RoleWarningModal from "@/components/RoleWarningModal";
import { useLanguage } from "@/components/i18n/LanguageProvider";

const HOMEPAGE_STATS_POLL_MS = 12000;

const EMPTY_NETWORK_STATS: PublicNetworkStats = {
  totalCalls: 0,
  registeredServices: 0,
  connectedAgents: 0,
  runtimeReadyServices: 0,
};

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
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const { t } = useLanguage();

  const [isWarningOpen, setIsWarningOpen] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<{ role: "CONSUMER" | "PROVIDER" | "ADMIN"; path: string; targetRoleStr: string } | null>(null);
  const [networkStats, setNetworkStats] = useState<PublicNetworkStats>(EMPTY_NETWORK_STATS);

  const handleEnterRole = async (role: "CONSUMER" | "PROVIDER" | "ADMIN", path: string) => {
    if (!address) {
      setAppRole(role);
      router.push(path);
      return;
    }

    const walletRole = await getWalletRole(address);
    if (walletRole !== "UNKNOWN" && walletRole !== role) {
      setPendingRoute({
        role,
        path,
        targetRoleStr: role === "CONSUMER" ? t("home.agentWorkspaceBtn") : t("home.providerWorkspaceBtn"),
      });
      setIsWarningOpen(true);
      return;
    }

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
    <div className="relative overflow-hidden bg-[#050505] text-white selection:bg-white selection:text-black">
      <RoleWarningModal
        isOpen={isWarningOpen}
        onDisconnect={() => {
          disconnect();
          setIsWarningOpen(false);
        }}
        targetRole={pendingRoute?.targetRoleStr || t("home.agentWorkspaceBtn")}
      />

      <main className="relative">
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(127,247,190,0.12),transparent_18%),radial-gradient(circle_at_50%_26%,rgba(255,255,255,0.05),transparent_26%),linear-gradient(180deg,#040404_0%,#050505_54%,#080808_100%)]" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:136px_136px] [mask-image:radial-gradient(circle_at_center,black,transparent_80%)]" />
          <div className="pointer-events-none absolute inset-x-0 top-[17%] h-px bg-gradient-to-r from-transparent via-white/18 to-transparent opacity-70" />
          <div className="pointer-events-none absolute left-1/2 top-[17%] h-52 w-52 -translate-x-1/2 rounded-full bg-[#7ff7be]/10 blur-3xl" />
          <div className="pointer-events-none absolute left-1/2 top-[15%] h-[28rem] w-[28rem] -translate-x-1/2 rounded-full border border-white/[0.05] opacity-70" />
          <div className="pointer-events-none absolute left-1/2 top-[15%] h-[34rem] w-[34rem] -translate-x-1/2 rounded-full border border-white/[0.03] opacity-60" />
          <div className="ambient-signal ambient-signal-left" />
          <div className="ambient-signal ambient-signal-right" />
          <div className="ambient-orb ambient-orb-left" />
          <div className="ambient-orb ambient-orb-right" />
          <div className="hero-trace hero-trace-left" />
          <div className="hero-trace hero-trace-right" />
          <div className="hero-trace hero-trace-center" />

          <div className="relative mx-auto flex min-h-[calc(100svh-76px)] max-w-6xl flex-col justify-center px-6 py-24 sm:py-28">
            <div className="mx-auto max-w-4xl text-center">
              <h1 className="mx-auto max-w-[15.5ch] text-[clamp(3.1rem,6.8vw,6rem)] font-[840] leading-[0.92] tracking-[-0.07em] text-white">
                <span className="block 2xl:inline">{t("home.heroTitleLead")}</span>{" "}
                <span className="block 2xl:inline bg-gradient-to-r from-white via-white to-[#7ff7be] bg-clip-text text-transparent [text-shadow:0_0_26px_rgba(127,247,190,0.12)]">
                  {t("home.heroTitleAccent")}
                </span>
              </h1>
              <p className="mx-auto mt-8 max-w-3xl text-base leading-8 text-[#9a9aa2] sm:text-lg">
                {t("home.heroSubtitle")}
              </p>
              <p className="mx-auto mt-7 max-w-2xl text-lg font-medium tracking-[-0.03em] text-white/84 sm:text-[1.4rem]">
                {t("home.heroTagline")}
              </p>
            </div>
          </div>
        </section>

        <section id="features" className="relative mx-auto max-w-7xl px-6 py-24 sm:py-28">
          <div className="mx-auto max-w-5xl py-6 sm:py-10">
            <div className="mx-auto max-w-5xl">
              <div className="mx-auto max-w-3xl text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/34">
                  {t("home.liveStatsLabel")}
                </p>
              </div>

              <div className="mx-auto mt-6 grid w-full max-w-5xl gap-3 sm:grid-cols-3">
                {heroStats.map((item) => (
                  <article
                    key={item.label}
                    className="rounded-[1.6rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.016))] px-5 py-5 text-center shadow-[0_24px_80px_rgba(0,0,0,0.12)]"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/36">
                      {item.label}
                    </p>
                    <p className="mt-3 font-mono text-[2.15rem] font-bold tracking-[-0.05em] text-white sm:text-[2.45rem]">
                      <AnimatedCounter value={item.value} />
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="mx-auto max-w-4xl text-center">
              <p className="mt-18 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7ff7be] sm:mt-20">
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
                onClick={() => handleEnterRole("CONSUMER", "/dashboard/discover")}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#7ff7be] px-6 py-3 text-sm font-semibold text-black transition hover:bg-[#6ae5ac]"
              >
                {t("home.finalCta")}
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => handleEnterRole("PROVIDER", "/dashboard/sell")}
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
