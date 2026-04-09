"use client";

import React, { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { listApiSecrets } from "@/utils/serviceApi";
import { Activity, AlertTriangle, Key, Database, Zap, Server, ArrowRight, TerminalSquare, RefreshCw, Plus } from "lucide-react";
import { useDashboardData } from "@/hooks/useDashboardData";

export default function ProviderConsolePage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [missingCredentials, setMissingCredentials] = useState(false);

  const {
    services,
    providerStats,
    handleRefresh: loadDashboardData
  } = useDashboardData();

  useEffect(() => {
    if (!address) { setMissingCredentials(false); return; }
    let cancelled = false;
    listApiSecrets(address)
      .then((secrets) => { if (!cancelled) setMissingCredentials(secrets.length === 0); })
      .catch(() => { if (!cancelled) setMissingCredentials(false); });
    return () => { cancelled = true; };
  }, [address]);

  const handlePublishClick = async () => {
    if (!address) {
      openConnectModal?.();
      return;
    }
    try {
      const secrets = await listApiSecrets(address);
      if (secrets.length === 0) {
        toast.error(t("providerConsolePage.missingSigningSecret"));
        router.push("/provider/secrets");
        return;
      }
      router.push("/provider/services/deploy");
    } catch(e) {
      console.warn("Precheck failed", e);
      toast.error(t("providerConsolePage.verifySigningSecretFailed"));
      router.push("/provider/secrets");
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadDashboardData();
    if (address) {
      try {
        const secrets = await listApiSecrets(address);
        setMissingCredentials(secrets.length === 0);
      } catch { /* keep current state */ }
    }
    setIsRefreshing(false);
  };

  return (
    <div className="p-6 md:p-10 mx-auto space-y-12 max-w-7xl font-sans text-white bg-[#000000] min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-[#222222]">
        <div>
          <h1 className="text-3xl md:text-5xl font-[800] tracking-tighter text-white flex items-center">
            {t("providerConsolePage.title")}
          </h1>
          <p className="mt-4 text-[#86868b] font-medium tracking-wide text-sm md:text-base">
            {t("providerConsolePage.description")}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => void handlePublishClick()}
            className="hidden md:flex items-center px-6 py-3 text-sm font-bold text-black transition-colors bg-white rounded-xl hover:bg-gray-200"
          >
            <Plus className="w-4 h-4 mr-2" />
            {t("providerConsolePage.newService")}
          </button>
          <button
            onClick={handleRefresh}
            aria-label={t("providerConsolePage.refreshConsole")}
            title={t("providerConsolePage.refreshConsole")}
            className="p-3 text-[#86868b] transition-colors bg-[#0a0a0a] border border-[#222222] rounded-xl hover:bg-[#111111] hover:text-[#ffffff]"
          >
            <RefreshCw className={`w-5 h-5 ${isRefreshing ? "animate-spin text-[#22c55e]" : ""}`} />
          </button>
        </div>
      </div>

      {/* Missing credentials banner */}
      {isConnected && missingCredentials && (
        <div className="flex items-center gap-3 rounded-2xl border border-[#ff9f0a]/30 bg-[#ff9f0a]/10 px-5 py-4">
          <AlertTriangle className="h-5 w-5 flex-shrink-0 text-[#ff9f0a]" />
          <p className="flex-1 text-sm text-[#ffd7a1]">
            {t("providerConsolePage.credentialsBannerText")}
          </p>
          <Link
            href="/provider/secrets"
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[#ff9f0a]/40 bg-[#ff9f0a]/20 px-4 py-1.5 text-xs font-bold text-[#ff9f0a] transition hover:bg-[#ff9f0a]/30"
          >
            {t("providerConsolePage.credentialsBannerAction")} <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}

      {/* KPI METRICS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <div className="p-6 bg-[#0a0a0a] border border-[#22c55e]/30 rounded-3xl relative overflow-hidden group hover:border-[#22c55e]/60 transition-colors">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#ffffff] opacity-[0.02] blur-3xl rounded-full pointer-events-none group-hover:bg-[#22c55e] transition-colors duration-500" />
          <h3 className="text-[10px] text-[#86868b] font-semibold uppercase tracking-[0.2em] mb-4 flex items-center justify-between">
            {t("providerConsolePage.metricNetEarnings")}
            <Activity className="w-4 h-4" />
          </h3>
          <div className="flex items-end justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-[800] text-[#ffffff] font-mono tracking-tighter group-hover:text-[#22c55e] transition-colors">
                {isConnected ? providerStats.receivable.toFixed(2) : "0.00"}
              </span>
              <span className="text-sm text-[#86868b] font-bold">USDC</span>
            </div>
            {isConnected && (
              <button
                onClick={() => router.push("/provider/withdraw")}
                className="text-[10px] uppercase tracking-widest font-bold px-3 py-1.5 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e] hover:text-[#000000] transition-all rounded-lg"
              >
                {t("providerConsolePage.claim")}
              </button>
            )}
          </div>
          <p className="mt-3 text-[11px] text-[#86868b] tracking-wide uppercase">
            {t("providerConsolePage.withdrawableConsistent")}
          </p>
        </div>

        {/* Metric 2 */}
        <div className="p-6 bg-[#0a0a0a] border border-[#222222] rounded-3xl group hover:border-[#444444] transition-colors relative overflow-hidden flex flex-col justify-between">
          <h3 className="text-[10px] text-[#86868b] font-semibold uppercase tracking-[0.2em] mb-4 flex items-center justify-between">
            {t("providerConsolePage.metricGrossEarnings")}
            <Database className="w-4 h-4" />
          </h3>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-[800] text-[#ffffff] font-mono tracking-tighter">
              {isConnected ? providerStats.totalEarned.toFixed(2) : "0.00"}
            </span>
            <span className="text-xs text-[#86868b] font-bold">USDC</span>
          </div>
          <p className="mt-3 text-[11px] text-[#86868b] tracking-wide uppercase">
            {t("providerConsolePage.beforeProtocolDeductions")}
          </p>
        </div>

        {/* Metric 3 */}
        <div className="p-6 bg-[#0a0a0a] border border-[#222222] rounded-3xl group hover:border-[#444444] transition-colors relative overflow-hidden flex flex-col justify-between">
          <h3 className="text-[10px] text-[#86868b] font-semibold uppercase tracking-[0.2em] mb-4 flex items-center justify-between">
            {t("providerConsolePage.metricTotalApiCalls")}
            <Zap className="w-4 h-4" />
          </h3>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-[800] text-[#ffffff] font-mono tracking-tighter group-hover:text-[#e5e5ea] transition-colors">
              {isConnected ? providerStats.totalApiCalls.toLocaleString() : "0"}
            </span>
          </div>
          <p className="mt-3 text-[11px] text-[#86868b] tracking-wide uppercase">
            {t("providerConsolePage.deduplicatedSettledCalls")}
          </p>
        </div>

        {/* Metric 4 */}
        <div className="p-6 bg-[#0a0a0a] border border-[#222222] rounded-3xl group hover:border-[#444444] transition-colors relative overflow-hidden flex flex-col justify-between">
          <h3 className="text-[10px] text-[#86868b] font-semibold uppercase tracking-[0.2em] mb-4 flex items-center justify-between">
            {t("providerConsolePage.metricActiveServices")}
            <Server className="w-4 h-4" />
          </h3>
          <div className="flex items-center gap-3">
            <span className="text-3xl font-[800] text-[#ffffff] font-mono tracking-tighter">
              {isConnected ? services.filter(s => s.isActive).length : "0"}
            </span>
            {isConnected ? (
              <span className="flex items-center text-[10px] uppercase font-bold tracking-widest text-[#22c55e] bg-[#22c55e]/10 px-2 py-1 rounded-md border border-[#22c55e]/20">
                <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse mr-2"></span>
                {" "}
                {t("providerConsolePage.online")}
              </span>
            ) : (
              <span className="text-[10px] uppercase font-bold tracking-widest text-[#86868b] bg-[#222222]/50 px-2 py-1 rounded-md">{t("providerConsolePage.offline")}</span>
            )}
          </div>
          <p className="mt-3 text-[11px] text-[#86868b] tracking-wide uppercase">
            {t("providerConsolePage.runtimeAvailability")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 -mt-6">
        <div className="lg:col-span-3 p-4 bg-[#0a0a0a] border border-[#222222] rounded-2xl flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="text-[11px] text-[#86868b] uppercase tracking-[0.2em] font-semibold">{t("providerConsolePage.settlementBreakdown")}</div>
          <div className="flex flex-wrap items-center gap-3 md:gap-6">
            <div className="px-3 py-2 rounded-xl border border-[#222222] bg-[#050505]">
              <div className="text-[10px] uppercase tracking-widest text-[#86868b]">{t("providerConsolePage.protocolFee")}</div>
              <div className="text-sm font-mono font-bold text-[#ff9f0a]">{isConnected ? providerStats.totalFees.toFixed(4) : "0.0000"} USDC</div>
            </div>
            <div className="px-3 py-2 rounded-xl border border-[#222222] bg-[#050505]">
              <div className="text-[10px] uppercase tracking-widest text-[#86868b]">{t("providerConsolePage.routingTax")}</div>
              <div className="text-sm font-mono font-bold text-[#22c55e]">{isConnected ? providerStats.totalRoutingTax.toFixed(4) : "0.0000"} USDC</div>
            </div>
            <div className="px-3 py-2 rounded-xl border border-[#222222] bg-[#050505]">
              <div className="text-[10px] uppercase tracking-widest text-[#86868b]">{t("providerConsolePage.providerNetLifetime")}</div>
              <div className="text-sm font-mono font-bold text-[#ffffff]">{isConnected ? providerStats.netEarned.toFixed(4) : "0.0000"} USDC</div>
            </div>
          </div>
        </div>
      </div>

      {/* QUICK ACTIONS ROW */}
      <section className="space-y-6 pt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl md:text-2xl font-bold text-[#ffffff] tracking-tight flex items-center">
            <TerminalSquare className="w-6 h-6 mr-3 text-[#86868b]" />
            {t("providerConsolePage.deploymentPipeline")}
          </h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Step 1 */}
          <div className="bg-[#050505] border border-[#222222] p-8 rounded-[2rem] group flex flex-col hover:border-[#444444] transition-colors">
            <div className="flex items-center justify-between mb-8">
              <span className="text-xl font-mono font-[800] text-[#333333] group-hover:text-[#ffffff] transition-colors">01</span>
              <Key className="w-6 h-6 text-[#86868b]" />
            </div>
            <h3 className="text-xl font-bold text-[#ffffff] mb-3">{t("providerConsolePage.providerCredentialsTitle")}</h3>
            <p className="text-[#86868b] mb-8 font-medium leading-relaxed flex-1 text-sm">
              {t("providerConsolePage.providerCredentialsDescription")}
            </p>
            <button 
              onClick={() => {
                if(!isConnected) { toast.error(t("providerConsolePage.connectTerminalToManageKeys")); return; }
                router.push("/provider/secrets");
              }}
              className="w-full py-4 text-sm font-bold border border-[#222222] text-[#ffffff] hover:bg-[#ffffff] hover:text-[#000000] transition-all bg-[#0a0a0a] flex items-center justify-center gap-2 rounded-2xl"
            >
              {t("providerConsolePage.manageProviderCredentials")} <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Step 2 */}
          <div className="bg-[#0a0a0a] border border-[#22c55e]/30 p-8 rounded-[2rem] group flex flex-col relative overflow-hidden transition-all hover:border-[#22c55e]/60">
            <div className="absolute inset-0 bg-[#22c55e]/[0.02] group-hover:bg-[#22c55e]/10 transition-colors duration-500"></div>
            <div className="relative flex flex-col h-full">
            <div className="flex items-center justify-between mb-8">
              <span className="text-xl font-mono font-[800] text-[#22c55e]">02</span>
              <Server className="w-6 h-6 text-[#22c55e]" />
            </div>
            <h3 className="text-xl font-bold text-[#ffffff] mb-3">{t("providerConsolePage.publishApiServiceTitle")}</h3>
            <p className="text-[#86868b] mb-8 font-medium leading-relaxed flex-1 text-sm group-hover:text-[#e5e5ea] transition-colors">
              {t("providerConsolePage.publishApiServiceDescription")}
            </p>
            <button 
              onClick={handlePublishClick}
              className="w-full py-4 text-sm font-bold border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e] hover:text-[#000000] transition-all bg-[#000000] rounded-2xl shadow-[0_0_20px_rgba(34,197,94,0.1)] flex items-center justify-center gap-2"
            >
              {t("providerConsolePage.createService")} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          </div>
        </div>
      </section>
    </div>
  );
}
