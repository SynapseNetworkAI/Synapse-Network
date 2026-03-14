"use client";

import React, { useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { listAgentCredentials } from "@/utils/agentCredentialApi";
import RoleWarningModal from "@/components/RoleWarningModal";
import Link from "next/link";
import { Activity, Shield, Key, Database, Zap, Server, ArrowRight, TerminalSquare, RefreshCw, Plus } from "lucide-react";
import { useAuth } from "@/components/WalletAuthGuard";
import { useDashboardData } from "@/hooks/useDashboardData";

export default function SellDashboard() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { isSessionAuthenticated } = useAuth();
  const [isRoleWarningOpen, setIsRoleWarningOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    services,
    providerStats,
    handleRefresh: loadDashboardData
  } = useDashboardData();

  const handlePublishClick = async () => {
    if (!address) {
      toast.error("Please connect your wallet first.");
      return;
    }
    try {
      const keys = await listAgentCredentials(address);
      const activeKeys = keys.filter(k => k.status === "active");
      if (activeKeys.length > 0) {
        setIsRoleWarningOpen(true);
        return;
      }
      router.push("/dashboard/services/deploy");
    } catch(e) {
      console.warn("Check failed", e);
      router.push("/dashboard/services/deploy");
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadDashboardData();
    setIsRefreshing(false);
  };

  return (
    <div className="p-6 md:p-10 mx-auto space-y-12 max-w-7xl font-sans text-white bg-[#000000] min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-[#222222]">
        <div>
          <h1 className="text-3xl md:text-5xl font-[800] tracking-tighter text-white flex items-center">
            Provider Console
          </h1>
          <p className="mt-4 text-[#86868b] font-medium tracking-wide text-sm md:text-base">
            Deploy API Manifests. Wrap with SDK. Accumulate zero-gas billing and settle to Synapse Vault.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/dashboard/services/deploy" className="hidden md:flex items-center px-6 py-3 text-sm font-bold text-black transition-colors bg-white rounded-xl hover:bg-gray-200">
            <Plus className="w-4 h-4 mr-2" />
            Deploy Manifest
          </Link>
          <button
            onClick={handleRefresh}
            className="p-3 text-[#86868b] transition-colors bg-[#0a0a0a] border border-[#222222] rounded-xl hover:bg-[#111111] hover:text-[#ffffff]"
          >
            <RefreshCw className={`w-5 h-5 ${isRefreshing ? "animate-spin text-[#22c55e]" : ""}`} />
          </button>
        </div>
      </div>

      {/* KPI METRICS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <div className="p-6 bg-[#0a0a0a] border border-[#222222] rounded-3xl relative overflow-hidden group hover:border-[#444444] transition-colors">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#ffffff] opacity-[0.02] blur-3xl rounded-full pointer-events-none group-hover:bg-[#22c55e] transition-colors duration-500" />
          <h3 className="text-[10px] text-[#86868b] font-semibold uppercase tracking-[0.2em] mb-4 flex items-center justify-between">
            Life-Time Earnings
            <Activity className="w-4 h-4" />
          </h3>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-[800] text-[#ffffff] font-mono tracking-tighter">
              {isConnected ? providerStats.totalEarned.toFixed(2) : "0.00"}
            </span>
            <span className="text-sm text-[#86868b] font-bold">USDC</span>
          </div>
        </div>

        {/* Metric 2 */}
        <div className="p-6 bg-[#0a0a0a] border border-[#222222] rounded-3xl group hover:border-[#444444] transition-colors relative overflow-hidden flex flex-col justify-between">
          <h3 className="text-[10px] text-[#86868b] font-semibold uppercase tracking-[0.2em] mb-4 flex items-center justify-between">
            Unclaimed Balance
            <Database className="w-4 h-4" />
          </h3>
          <div className="flex items-end justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-[800] text-[#ffffff] font-mono tracking-tighter group-hover:text-[#22c55e] transition-colors">
                {isConnected ? providerStats.receivable.toFixed(2) : "0.00"}
              </span>
              <span className="text-xs text-[#86868b] font-bold">USDC</span>
            </div>
            {isConnected && (
              <button 
                 onClick={() => router.push("/dashboard/admin")}
                 className="text-[10px] uppercase tracking-widest font-bold px-3 py-1.5 border border-[#222222] text-[#ffffff] hover:bg-[#ffffff] hover:text-[#000000] transition-all rounded-lg"
              >
                Claim
              </button>
            )}
          </div>
        </div>

        {/* Metric 3 */}
        <div className="p-6 bg-[#0a0a0a] border border-[#222222] rounded-3xl group hover:border-[#444444] transition-colors flex flex-col justify-between">
          <h3 className="text-[10px] text-[#86868b] font-semibold uppercase tracking-[0.2em] mb-4 flex items-center justify-between">
            Total API Calls
            <Zap className="w-4 h-4" />
          </h3>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-[800] text-[#ffffff] font-mono tracking-tighter">
              {isConnected ? providerStats.totalApiCalls.toLocaleString() : "0"}
            </span>
          </div>
        </div>

        {/* Metric 4 */}
        <div className="p-6 bg-[#0a0a0a] border border-[#222222] rounded-3xl group hover:border-[#444444] transition-colors flex flex-col justify-between">
          <h3 className="text-[10px] text-[#86868b] font-semibold uppercase tracking-[0.2em] mb-4 flex items-center justify-between">
            Active Nodes
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
                Online
              </span>
            ) : (
              <span className="text-[10px] uppercase font-bold tracking-widest text-[#86868b] bg-[#222222]/50 px-2 py-1 rounded-md">Offline</span>
            )}
          </div>
        </div>
      </div>

      {/* QUICK ACTIONS ROW */}
      <section className="space-y-6 pt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl md:text-2xl font-bold text-[#ffffff] tracking-tight flex items-center">
            <TerminalSquare className="w-6 h-6 mr-3 text-[#86868b]" />
            Deployment Pipeline
          </h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Step 1 */}
          <div className="bg-[#050505] border border-[#222222] p-8 rounded-[2rem] group flex flex-col hover:border-[#444444] transition-colors">
            <div className="flex items-center justify-between mb-8">
              <span className="text-xl font-mono font-[800] text-[#333333] group-hover:text-[#ffffff] transition-colors">01</span>
              <Key className="w-6 h-6 text-[#86868b]" />
            </div>
            <h3 className="text-xl font-bold text-[#ffffff] mb-3">Issue Keys</h3>
            <p className="text-[#86868b] mb-8 font-medium leading-relaxed flex-1 text-sm">
              Create cryptographically secure HMAC credentials bound to your node identity.
            </p>
            <button 
              onClick={() => {
                if(!isConnected) { toast.error("Connect terminal to manage keys"); return; }
                router.push("/dashboard/secrets");
              }}
              className="w-full py-4 text-sm font-bold border border-[#222222] text-[#ffffff] hover:bg-[#ffffff] hover:text-[#000000] transition-all bg-[#0a0a0a] flex items-center justify-center gap-2 rounded-2xl"
            >
              Manage Secrets <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Step 2 */}
          <div className="bg-[#050505] border border-[#222222] p-8 rounded-[2rem] group flex flex-col hover:border-[#444444] transition-colors">
            <div className="flex items-center justify-between mb-8">
              <span className="text-xl font-mono font-[800] text-[#333333] group-hover:text-[#ffffff] transition-colors">02</span>
              <Shield className="w-6 h-6 text-[#86868b]" />
            </div>
            <h3 className="text-xl font-bold text-[#ffffff] mb-3">Secure Scope</h3>
            <p className="text-[#86868b] mb-8 font-medium leading-relaxed text-sm">
              Wrap local endpoints with Synapse SDK to reject unsigned network traffic.
            </p>
            <div className="bg-[#000000] border border-[#222222] p-4 text-[11px] rounded-2xl font-mono overflow-hidden flex-1 flex flex-col justify-center">
              <div><span className="text-[#86868b]">from</span> synapse <span className="text-[#86868b]">import</span> Gateway</div>
              <div className="mt-2 text-[#ffffff]">
                gw = Gateway(<br/>
                &nbsp;&nbsp;sec=<span className="text-[#22c55e]">&apos;sk_live_...&apos;</span><br/>
                )<br/>
                gw.listen()
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="bg-[#050505] border border-[#222222] p-8 rounded-[2rem] group flex flex-col hover:border-[#444444] transition-colors">
            <div className="flex items-center justify-between mb-8">
              <span className="text-xl font-mono font-[800] text-[#333333] group-hover:text-[#ffffff] transition-colors">03</span>
              <Server className="w-6 h-6 text-[#86868b]" />
            </div>
            <h3 className="text-xl font-bold text-[#ffffff] mb-3">Publish API</h3>
            <p className="text-[#86868b] mb-8 font-medium leading-relaxed flex-1 text-sm">
              Broadcast manifest parameters and models to the decentralized directory.
            </p>
            <button 
              onClick={handlePublishClick}
              className="w-full py-4 text-sm font-bold border border-[#222222] text-[#ffffff] hover:bg-[#ffffff] hover:text-[#000000] transition-all bg-[#0a0a0a] flex items-center justify-center gap-2 rounded-2xl"
            >
              Deploy <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Step 4 */}
          <div className="bg-[#0a0a0a] border border-[#222222] p-8 rounded-[2rem] group flex flex-col relative overflow-hidden transition-all hover:border-[#22c55e]/50">
            <div className="absolute inset-0 bg-[#22c55e]/[0.02] group-hover:bg-[#22c55e]/10 transition-colors duration-500"></div>
            <div className="relative flex flex-col h-full">
              <div className="flex items-center justify-between mb-8">
                <span className="text-xl font-mono font-[800] text-[#22c55e]">04</span>
                <Activity className="w-6 h-6 text-[#22c55e]" />
              </div>
              <h3 className="text-xl font-bold text-[#ffffff] mb-3">Vault Output</h3>
              <p className="text-[#86868b] mb-8 font-medium leading-relaxed flex-1 text-sm group-hover:text-[#e5e5ea] transition-colors">
                Accumulate micro-charges per API call. Instantly pull USDC from the Vault.
              </p>
              <button 
                onClick={() => {
                  if(!isConnected) { toast.error("Connect wallet first"); return; }
                  router.push("/dashboard/admin");
                }}
                className="w-full py-4 text-sm font-bold border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e] hover:text-[#000000] transition-all bg-[#000000] rounded-2xl shadow-[0_0_20px_rgba(34,197,94,0.1)]"
              >
                Go to Ledger
              </button>
            </div>
          </div>
        </div>
      </section>

      {isConnected && (
        <>
          {/* ACTIVE SERVICES TABLE */}
          <section className="space-y-6 pt-10">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-xl md:text-2xl font-bold text-[#ffffff] tracking-tight flex items-center">
                <Server className="w-6 h-6 mr-3 text-[#86868b]" />
                Registered Network Nodes
              </h2>
            </div>
            
            <div className="overflow-x-auto rounded-[2rem] border border-[#222222] bg-[#0a0a0a]">
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[#222222] text-[10px] text-[#86868b] uppercase tracking-[0.2em] font-semibold bg-[#050505]">
                    <th className="py-6 px-8">Service Endpoint</th>
                    <th className="py-6 px-8">Model Matrix</th>
                    <th className="py-6 px-8">Pricing Bound</th>
                    <th className="py-6 px-8 text-center">Instance State</th>
                    <th className="py-6 px-8 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#151515]">
                  <tr className="hover:bg-[#111111] transition-colors group">
                    <td className="py-5 px-8">
                      <div className="font-bold text-[#ffffff] text-sm tracking-wide">DeepSeek-Chat</div>
                      <div className="text-xs text-[#86868b] font-mono mt-1 flex items-center gap-1">
                        http://localhost:8000/v1/chat
                      </div>
                    </td>
                    <td className="py-5 px-8">
                      <span className="font-mono text-xs text-[#86868b] bg-[#222222] px-2 py-1 rounded">get_deepseek_chat</span>
                    </td>
                    <td className="py-5 px-8">
                      <div className="text-[#ffffff] font-mono text-sm tracking-tight">0.05 <span className="text-[#86868b] text-[10px] font-sans ml-1">USDC / CALL</span></div>
                      <div className="text-[#86868b] text-[10px] mt-1 font-mono tracking-wider">MAX: 50 QPS</div>
                    </td>
                    <td className="py-5 px-8 text-center">
                      <span className="inline-flex items-center justify-center px-3 py-1.5 rounded-full text-[10px] uppercase font-bold tracking-widest bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] mr-2"></span>
                        {" "}
                        Online
                      </span>
                    </td>
                    <td className="py-5 px-8 text-right">
                      <Link href="/dashboard/services" className="text-xs font-bold text-[#ffffff] transition-colors py-2 px-4 rounded-xl border border-[#444444] bg-[#222222] hover:bg-[#ffffff] hover:text-[#000000]">
                        Manage
                      </Link>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* INCOME PIPELINE */}
          <section className="space-y-6 pt-8">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-xl md:text-2xl font-bold text-[#ffffff] tracking-tight flex items-center">
                <Database className="w-6 h-6 mr-3 text-[#86868b]" />
                Settlement Pipeline
              </h2>
            </div>
            
            <div className="overflow-x-auto rounded-[2rem] border border-[#222222] bg-[#0a0a0a]">
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[#222222] text-[10px] text-[#86868b] uppercase tracking-[0.2em] font-semibold bg-[#050505]">
                    <th className="py-6 px-8">Operation Trace</th>
                    <th className="py-6 px-8">Routing Mux</th>
                    <th className="py-6 px-8 text-right">Gross Output</th>
                    <th className="py-6 px-8 text-right">Vault Net</th>
                    <th className="py-6 px-8 text-center">Transaction Phase</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#151515]">
                  <tr className="hover:bg-[#111111] transition-colors group">
                    <td className="py-5 px-8 text-sm text-[#444444] font-mono group-hover:text-[#86868b] transition-colors">
                      job_9f8x...3j2a
                    </td>
                    <td className="py-5 px-8 text-sm font-bold text-[#ffffff] tracking-wide">
                      DeepSeek-Chat
                    </td>
                    <td className="py-5 px-8 text-sm text-[#86868b] font-mono tracking-tight text-right">
                      0.0500 <span className="text-[10px] font-sans opacity-50">USDC</span>
                    </td>
                    <td className="py-5 px-8 text-sm text-[#22c55e] font-mono tracking-tight font-bold text-right">
                      +0.0490 <span className="text-[10px] border border-[#22c55e]/30 px-1 rounded ml-1 bg-[#22c55e]/10">-2%</span>
                    </td>
                    <td className="py-5 px-8 text-center">
                      <span className="inline-flex items-center justify-center px-3 py-1.5 rounded-full text-[10px] uppercase font-bold tracking-widest text-yellow-500 bg-yellow-500/10 border border-yellow-500/20">
                        Local Pending
                      </span>
                    </td>
                  </tr>
                  <tr className="hover:bg-[#111111] transition-colors group">
                    <td className="py-5 px-8 text-sm text-[#444444] font-mono group-hover:text-[#86868b] transition-colors">
                      tx_0xa1...b89c
                    </td>
                    <td className="py-5 px-8 text-sm font-bold text-[#ffffff] tracking-wide">
                      Stable-Dif-XL
                    </td>
                    <td className="py-5 px-8 text-sm text-[#86868b] font-mono tracking-tight text-right">
                      0.2500 <span className="text-[10px] font-sans opacity-50">USDC</span>
                    </td>
                    <td className="py-5 px-8 text-sm text-[#22c55e] font-mono tracking-tight font-bold text-right">
                      +0.2450 <span className="text-[10px] border border-[#22c55e]/30 px-1 rounded ml-1 bg-[#22c55e]/10">-2%</span>
                    </td>
                    <td className="py-5 px-8 text-center">
                      <span className="inline-flex items-center justify-center px-3 py-1.5 rounded-full text-[10px] uppercase font-bold tracking-widest bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20">
                        Vault Settled
                      </span>
                    </td>
                  </tr>
                  {(!isSessionAuthenticated) && (
                    <tr>
                       <td colSpan={5} className="py-12 text-center">
                          <span className="text-sm text-[#86868b]">Authenticate wallet session to view full stream</span>
                       </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <RoleWarningModal
        isOpen={isRoleWarningOpen}
        onDisconnect={() => {
          disconnect();
          setIsRoleWarningOpen(false);
        }}
        targetRole="Buyer"
      />
    </div>
  );
}
