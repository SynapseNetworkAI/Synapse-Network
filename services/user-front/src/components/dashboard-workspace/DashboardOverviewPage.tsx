"use client";

import React from "react";
import { useAccount } from "wagmi";
import DashboardPageLoadingState from "@/components/loading/DashboardPageLoadingState";
import { useOwnerData } from "@/hooks/useOwnerData";
import { useAuth } from "@/components/WalletAuthGuard";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import OverviewHero from "@/components/dashboard/overview/OverviewHero";
import WorkflowSection from "@/components/dashboard/overview/WorkflowSection";
import CapabilityCards from "@/components/dashboard/overview/CapabilityCards";
import { RefreshCw, LayoutGrid, ShieldCheck, Zap, Layers, User, Bot, Server, Cpu } from "lucide-react";

export default function OverviewPage() {
  const { isConnected } = useAccount();
  const { isSessionAuthenticated } = useAuth();
  const { handleRefresh, isRefreshing, isBootstrapping } = useOwnerData();
  const { t } = useLanguage();

  if (isConnected && isSessionAuthenticated && isBootstrapping) {
    return <DashboardPageLoadingState />;
  }

  return (
    <div className="min-h-screen bg-[#050505] text-[#f5f5f7] font-sans selection:bg-white/90 selection:text-black">
      {/* HEADER */}
      <header className="border-b border-white/5 bg-[#0a0a0c]/80 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400/80">{t("overviewPage.systemOperational")}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">{t("overviewPage.controlPlaneOverview")}</h1>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="hidden lg:flex items-center gap-6 mr-4 px-4 py-2 rounded-full bg-white/[0.03] border border-white/5">
              <div className="flex flex-col">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold">{t("overviewPage.networkStatus")}</span>
                <span className="text-xs font-mono text-gray-300">Mainnet-Beta v0.4.2</span>
              </div>
              <div className="h-8 w-px bg-white/5" />
              <div className="flex flex-col">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold">{t("overviewPage.latency")}</span>
                <span className="text-xs font-mono text-emerald-400">24ms</span>
              </div>
            </div>
            
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="group flex items-center gap-2 px-4 py-2 text-xs font-bold bg-white text-black rounded-full hover:bg-gray-200 transition-all active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : "group-hover:rotate-180 transition-transform duration-500"}`} />
              {isRefreshing ? t("overviewPage.syncing") : t("overviewPage.refreshData")}
            </button>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="max-w-[1400px] mx-auto px-6 lg:px-10 py-10 space-y-16">
        {/* HERO SECTION */}
        <section>
          <OverviewHero />
        </section>

        {/* WORKFLOW SECTION */}
        <section className="space-y-8">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-white/5" />
            <div className="flex items-center gap-2 px-4 py-1 rounded-full border border-white/5 bg-white/[0.02]">
              <Zap className="w-3 h-3 text-blue-400/60" />
              <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase">{t("overviewPage.operationalWorkflows")}</span>
            </div>
            <div className="h-px flex-1 bg-white/5" />
          </div>
          <WorkflowSection />
        </section>

        {/* IDENTITY MODEL SECTION */}
        <section className="space-y-8">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-white/5" />
            <div className="flex items-center gap-2 px-4 py-1 rounded-full border border-white/5 bg-white/[0.02]">
              <Layers className="w-3 h-3 text-purple-400/60" />
              <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase">{t("overviewPage.platformIdentityModel")}</span>
            </div>
            <div className="h-px flex-1 bg-white/5" />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all">
              <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 w-fit mb-4">
                <User className="w-5 h-5 text-blue-400" />
              </div>
              <h4 className="text-sm font-bold text-white mb-2">{t("overviewPage.ownerTitle")}</h4>
              <p className="text-xs text-gray-500 leading-relaxed">
                {t("overviewPage.ownerDescription")}
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all">
              <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 w-fit mb-4">
                <Bot className="w-5 h-5 text-purple-400" />
              </div>
              <h4 className="text-sm font-bold text-white mb-2">{t("overviewPage.agentTitle")}</h4>
              <p className="text-xs text-gray-500 leading-relaxed">
                {t("overviewPage.agentDescription")}
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all">
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 w-fit mb-4">
                <Server className="w-5 h-5 text-emerald-400" />
              </div>
              <h4 className="text-sm font-bold text-white mb-2">{t("overviewPage.providerTitle")}</h4>
              <p className="text-xs text-gray-500 leading-relaxed">
                {t("overviewPage.providerDescription")}
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all">
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 w-fit mb-4">
                <Cpu className="w-5 h-5 text-amber-400" />
              </div>
              <h4 className="text-sm font-bold text-white mb-2">{t("overviewPage.platformTitle")}</h4>
              <p className="text-xs text-gray-500 leading-relaxed">
                {t("overviewPage.platformDescription")}
              </p>
            </div>
          </div>
        </section>

        {/* CORE CAPABILITIES */}
        <section>
          <div className="mb-8">
            <h2 className="text-lg font-bold text-white tracking-tight">{t("overviewPage.coreCapabilities")}</h2>
            <p className="text-xs text-gray-500 mt-1">{t("overviewPage.coreCapabilitiesDescription")}</p>
          </div>
          <CapabilityCards />
        </section>

        {/* FOOTER */}
        <footer className="pt-20 pb-10 border-t border-white/5">
          <div className="flex flex-col items-center text-center space-y-6">
            <div className="flex items-center gap-3 opacity-20 grayscale">
              <LayoutGrid className="w-6 h-6" />
              <span className="text-xl font-black tracking-tighter">SYNAPSE</span>
            </div>
            <p className="text-sm text-gray-600 italic leading-relaxed max-w-2xl">
              {t("overviewPage.footerTagline")}
            </p>
            <div className="flex items-center gap-8 text-[10px] font-bold tracking-[0.2em] text-gray-700 uppercase">
              <button type="button" className="hover:text-gray-400 transition-colors">{t("overviewPage.footerPrivacy")}</button>
              <button type="button" className="hover:text-gray-400 transition-colors">{t("overviewPage.footerTerms")}</button>
              <button type="button" className="hover:text-gray-400 transition-colors">{t("overviewPage.footerSecurity")}</button>
              <button type="button" className="hover:text-gray-400 transition-colors">{t("overviewPage.footerStatus")}</button>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
