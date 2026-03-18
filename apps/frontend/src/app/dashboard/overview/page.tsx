"use client";

import React, { useState } from "react";
import { useAccount } from "wagmi";
import { useOwnerData } from "@/hooks/useOwnerData";
import { useAuth } from "@/components/WalletAuthGuard";
import OverviewHero from "@/components/dashboard/overview/OverviewHero";
import RolePathCards from "@/components/dashboard/overview/RolePathCards";
import TreasurySection from "@/components/dashboard/overview/TreasurySection";
import AnalyticsCards from "@/components/dashboard/overview/AnalyticsCards";
import EventStreamTable from "@/components/dashboard/overview/EventStreamTable";
import CapabilityCards from "@/components/dashboard/overview/CapabilityCards";
import FeeTransparencyPanel from "@/components/dashboard/overview/FeeTransparencyPanel";
import { RefreshCw, Activity, LayoutGrid, ShieldCheck, Zap } from "lucide-react";

export default function OverviewPage() {
  const { isConnected } = useAccount();
  const { isSessionAuthenticated } = useAuth();
  const { stats, handleRefresh, isRefreshing, userAddress } = useOwnerData();
  const [activeTab, setActiveTab] = useState<"agent" | "provider">("agent");

  const currentBalance = isConnected && isSessionAuthenticated ? stats?.ownerBalance || "0.00" : "0.00";

  return (
    <div className="min-h-screen bg-[#050505] text-[#f5f5f7] font-sans selection:bg-white/90 selection:text-black">
      {/* HEADER */}
      <header className="border-b border-white/5 bg-[#0a0a0c]/80 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400/80">System Operational</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Control Plane Overview</h1>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="hidden lg:flex items-center gap-6 mr-4 px-4 py-2 rounded-full bg-white/[0.03] border border-white/5">
              <div className="flex flex-col">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold">Network Status</span>
                <span className="text-xs font-mono text-gray-300">Mainnet-Beta v0.4.2</span>
              </div>
              <div className="h-8 w-px bg-white/5" />
              <div className="flex flex-col">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold">Latency</span>
                <span className="text-xs font-mono text-emerald-400">24ms</span>
              </div>
            </div>
            
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="group flex items-center gap-2 px-4 py-2 text-xs font-bold bg-white text-black rounded-full hover:bg-gray-200 transition-all active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : "group-hover:rotate-180 transition-transform duration-500"}`} />
              {isRefreshing ? "SYNCING..." : "REFRESH DATA"}
            </button>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="max-w-[1400px] mx-auto px-6 lg:px-10 py-10 space-y-12">
        {/* HERO SECTION */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-8">
            <OverviewHero />
          </div>
          <div className="lg:col-span-4 space-y-4">
            <div className="p-6 rounded-2xl bg-gradient-to-br from-white/[0.05] to-transparent border border-white/10 shadow-2xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <Zap className="w-4 h-4 text-blue-400" />
                </div>
                <h3 className="text-sm font-bold text-white">Quick Integration</h3>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed mb-6">
                Start building with Synapse SDK. Our high-performance gateway handles all the complexity of M2M payments.
              </p>
              <div className="space-y-2">
                <code className="block p-3 rounded-lg bg-black border border-white/5 text-[10px] font-mono text-blue-300/80">
                  npm install @synapse/sdk
                </code>
                <button className="w-full py-2.5 text-[11px] font-bold tracking-wider uppercase bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors">
                  View Documentation
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* WORKSPACE SELECTOR */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Workspace Selection</h2>
              <p className="text-xs text-gray-500 mt-1">Switch between Agent and Provider operational contexts.</p>
            </div>
            <div className="flex p-1 rounded-full bg-white/[0.03] border border-white/5">
              <button 
                onClick={() => setActiveTab("agent")}
                className={`px-6 py-1.5 rounded-full text-[11px] font-bold transition-all ${activeTab === "agent" ? "bg-white text-black shadow-lg" : "text-gray-500 hover:text-gray-300"}`}
              >
                AGENT
              </button>
              <button 
                onClick={() => setActiveTab("provider")}
                className={`px-6 py-1.5 rounded-full text-[11px] font-bold transition-all ${activeTab === "provider" ? "bg-white text-black shadow-lg" : "text-gray-500 hover:text-gray-300"}`}
              >
                PROVIDER
              </button>
            </div>
          </div>
          <RolePathCards />
        </section>

        {/* FINANCIAL INFRASTRUCTURE */}
        <section className="space-y-8">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-white/5" />
            <div className="flex items-center gap-2 px-4 py-1 rounded-full border border-white/5 bg-white/[0.02]">
              <ShieldCheck className="w-3 h-3 text-amber-400/60" />
              <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase">Financial Infrastructure</span>
            </div>
            <div className="h-px flex-1 bg-white/5" />
          </div>
          
          <TreasurySection masterBalance={currentBalance} userAddress={userAddress} />
          
          <AnalyticsCards
            servicesCount={0}
            serviceWalletTotal="0.00"
            totalEarned={0}
            totalFees={0}
            paidCount24h={0}
          />
        </section>

        {/* CORE CAPABILITIES */}
        <section>
          <div className="mb-8">
            <h2 className="text-lg font-bold text-white tracking-tight">Core Capabilities</h2>
            <p className="text-xs text-gray-500 mt-1">The architectural pillars of the Synapse M2M economy.</p>
          </div>
          <CapabilityCards />
        </section>

        {/* ACTIVITY & TRANSPARENCY */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-8">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-white/[0.03] border border-white/5">
                  <Activity className="w-4 h-4 text-gray-400" />
                </div>
                <h2 className="text-lg font-bold text-white tracking-tight">Real-time Activity</h2>
              </div>
              <button className="text-[10px] font-bold text-gray-500 hover:text-white transition-colors uppercase tracking-widest">
                View All Logs
              </button>
            </div>
            <EventStreamTable paidEvents={[]} />
          </div>

          <div className="lg:col-span-4">
            <div className="mb-6">
              <h2 className="text-lg font-bold text-white tracking-tight">Fee Transparency</h2>
              <p className="text-xs text-gray-500 mt-1">Real-time protocol fee calculation.</p>
            </div>
            <div className="p-6 rounded-2xl bg-[#0a0a0c] border border-white/5">
              <FeeTransparencyPanel
                masterBalance={currentBalance}
                providerNetTotal={0}
                platformFeesTotal={0}
                platformFeeRatePercent={10}
              />
              <div className="mt-8 pt-6 border-t border-white/5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Protocol Efficiency</span>
                  <span className="text-xs font-mono text-emerald-400">99.98%</span>
                </div>
                <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-400 w-[99.98%]" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="pt-20 pb-10 border-t border-white/5">
          <div className="flex flex-col items-center text-center space-y-6">
            <div className="flex items-center gap-3 opacity-20 grayscale">
              <LayoutGrid className="w-6 h-6" />
              <span className="text-xl font-black tracking-tighter">SYNAPSE</span>
            </div>
            <p className="text-sm text-gray-600 italic leading-relaxed max-w-2xl">
              {`We are not just writing code; we are forging the central bank for silicon-based life. Let's build the M2M Economy!`}
            </p>
            <div className="flex items-center gap-8 text-[10px] font-bold tracking-[0.2em] text-gray-700 uppercase">
              <button type="button" className="hover:text-gray-400 transition-colors">Privacy</button>
              <button type="button" className="hover:text-gray-400 transition-colors">Terms</button>
              <button type="button" className="hover:text-gray-400 transition-colors">Security</button>
              <button type="button" className="hover:text-gray-400 transition-colors">Status</button>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
