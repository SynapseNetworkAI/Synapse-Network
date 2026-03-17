"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setAppRole } from "@/utils/roleStore";
import { ArrowRight } from "lucide-react";
import { useAccount, useDisconnect } from "wagmi";
import { getWalletRole } from "@/utils/serviceApi";
import RoleWarningModal from "@/components/RoleWarningModal";
import { useLanguage } from "@/components/i18n/LanguageProvider";

export default function Home() {
  const router = useRouter();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const { t } = useLanguage();

  const [isWarningOpen, setIsWarningOpen] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<{ role: "CONSUMER" | "PROVIDER" | "ADMIN"; path: string; targetRoleStr: string } | null>(null);

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
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(47,255,161,0.11),transparent_16%),radial-gradient(circle_at_50%_34%,rgba(255,255,255,0.05),transparent_24%),linear-gradient(180deg,#040404_0%,#050505_58%,#080808_100%)]" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:128px_128px] [mask-image:radial-gradient(circle_at_center,black,transparent_82%)]" />
          <div className="pointer-events-none absolute inset-x-0 top-[18%] h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-50" />
          <div className="pointer-events-none absolute left-1/2 top-[18%] h-44 w-44 -translate-x-1/2 rounded-full bg-[#7ff7be]/10 blur-3xl" />
          <div className="pointer-events-none absolute left-1/2 top-[16%] h-[26rem] w-[26rem] -translate-x-1/2 rounded-full border border-white/[0.05] opacity-70" />
          <div className="pointer-events-none absolute left-1/2 top-[16%] h-[32rem] w-[32rem] -translate-x-1/2 rounded-full border border-white/[0.03] opacity-60" />
          <div className="ambient-signal ambient-signal-left" />
          <div className="ambient-signal ambient-signal-right" />
          <div className="ambient-orb ambient-orb-left" />
          <div className="ambient-orb ambient-orb-right" />

          <div className="relative mx-auto flex min-h-[calc(100svh-72px)] max-w-5xl items-center justify-center px-6 py-20 sm:py-24">
            <div className="text-center">
              <h1 className="mx-auto max-w-4xl text-5xl font-[820] leading-[0.92] tracking-[-0.06em] text-white sm:text-6xl lg:text-7xl">
                {t("home.heroTitle")}
              </h1>
              <p className="mx-auto mt-6 max-w-3xl text-base leading-8 text-[#9a9aa2] sm:text-lg">
                {t("home.heroSubtitle")}
              </p>

              <div className="mt-10">
                <button
                  onClick={() => handleEnterRole("CONSUMER", "/dashboard/discover")}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white px-7 py-4 text-sm font-semibold text-black shadow-[0_18px_60px_rgba(255,255,255,0.08)] transition duration-200 hover:translate-y-[-1px] hover:bg-[#f0f0f1]"
                >
                  {t("home.agentWorkspaceBtn")}
                  <ArrowRight className="h-4 w-4" />
                </button>
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
                    className="rounded-[1.8rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.012))] px-6 py-7 shadow-[0_24px_80px_rgba(0,0,0,0.16)]"
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
