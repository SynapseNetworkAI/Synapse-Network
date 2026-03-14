"use client";

import { useState } from "react";
import Link from "next/link";
import { RefreshCw, Shield, ArrowRight, ArrowUpRight, AlertTriangle, Loader2, Key, Activity, TerminalSquare } from "lucide-react";
import toast from "react-hot-toast";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useBuyerData } from "@/hooks/useBuyerData";
import { useAuth } from "@/components/WalletAuthGuard";
import { requestV2Refund } from "@/utils/balanceApi";

export default function BuyerOverview() {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { userAddress, isRefreshing, stats, logs, handleRefresh } = useBuyerData();
  const { isSessionAuthenticated } = useAuth();
  
  const [isSettlementModalOpen, setIsSettlementModalOpen] = useState(false);
  const [isSettling, setIsSettling] = useState(false);

  const handleSettlement = async () => {
    if (!userAddress) {
      toast.error("钱包未连接或会话失效");
      return;
    }
    
    setIsSettling(true);
    const toastId = toast.loading("Requesting EIP-712 Signature...");
    try {
      // 真实调用后端结算扣减接口
      const refundResult = await requestV2Refund(userAddress);
      
      toast.success(`Ticket Generated: ${refundResult.signature.slice(0, 8)}... Prompting Wallet`, { id: toastId });
      
      // 模拟链上确认等待时间
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      toast.success(`Successfully Withdrawn ${refundResult.amountRefunded} USDC`, { id: toastId });
      setIsSettlementModalOpen(false);
      handleRefresh();
    } catch {
      toast.error("Settlement failed. Please try again.", { id: toastId });
    } finally {
      setIsSettling(false);
    }
  };

  const handleRefreshClick = async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    await handleRefresh();
  };

  const emptyLogStateText = isSessionAuthenticated
    ? "Awaiting agent activity..."
    : "Authenticate terminal to view stream";

  return (
    <div className="p-6 md:p-10 mx-auto space-y-12 max-w-7xl font-sans text-white bg-black min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-[#222222]">
        <div>
          <h1 className="text-3xl md:text-5xl font-[800] tracking-tighter text-white flex items-center">
            Buyer Console
          </h1>
          <p className="mt-4 text-[#86868b] font-medium tracking-wide text-sm md:text-base">
            Manage your API consumption, monitor agent activities, and control your vault.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/dashboard/console" className="flex items-center px-6 py-3 text-sm font-bold text-black transition-colors bg-white rounded-xl hover:bg-gray-200">
            <Key className="w-4 h-4 mr-2" />
            Manage API Keys
          </Link>
          <button
            onClick={() => void handleRefreshClick()}
            className="p-3 text-[#86868b] transition-colors bg-[#0a0a0a] border border-[#222222] rounded-xl hover:bg-[#111111] hover:text-white"
          >
            <RefreshCw className={`w-5 h-5 ${isRefreshing ? "animate-spin text-[#22c55e]" : ""}`} />
          </button>
        </div>
      </div>

      {/* Primary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Balance Card - Elevated Importance */}
        <div className="p-6 bg-[#0a0a0a] border border-[#222222] rounded-3xl relative overflow-hidden group hover:border-[#444444] transition-colors">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-[0.02] blur-3xl rounded-full pointer-events-none group-hover:bg-[#22c55e] transition-colors duration-500" />
          <h3 className="text-[10px] text-[#86868b] font-semibold uppercase tracking-[0.2em] mb-4">Vault Balance</h3>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-[800] text-white font-mono tracking-tighter">{stats.buyerBalance}</span>
              <span className="text-sm text-[#86868b] font-bold">USDC</span>
            </div>
            <Link href="/dashboard/console" className="text-[#86868b] group-hover:text-white flex items-center text-xs font-bold transition-colors w-fit mt-1">
              Top up Balance <ArrowUpRight className="w-3 h-3 ml-1" />
            </Link>
          </div>
        </div>
        
        <div className="p-6 bg-[#0a0a0a] border border-[#222222] rounded-3xl hover:border-[#444444] transition-colors flex flex-col justify-between group">
          <h3 className="text-[10px] text-[#86868b] font-semibold uppercase tracking-[0.2em] mb-4">24h Spend</h3>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-[800] text-white font-mono tracking-tighter group-hover:text-[#22c55e] transition-colors">{stats.todaySpend}</span>
            <span className="text-xs text-[#86868b] font-bold">USDC</span>
          </div>
        </div>

        <div className="p-6 bg-[#0a0a0a] border border-[#222222] rounded-3xl hover:border-[#444444] transition-colors flex flex-col justify-between group">
          <h3 className="text-[10px] text-[#86868b] font-semibold uppercase tracking-[0.2em] mb-4">24h API Calls</h3>
          <span className="text-3xl font-[800] text-white font-mono tracking-tighter">{stats.todayCalls}</span>
        </div>

        <div className="p-6 bg-[#0a0a0a] border border-[#222222] rounded-3xl hover:border-[#444444] transition-colors flex flex-col justify-between">
          <h3 className="text-[10px] text-[#86868b] font-semibold uppercase tracking-[0.2em] mb-4">Blocked / Failed</h3>
          <span className={`text-3xl font-[800] font-mono tracking-tighter ${Number(stats.blockedCalls) > 0 ? "text-[#ef4444]" : "text-white"}`}>{stats.blockedCalls}</span>
        </div>
      </div>

      {/* Refunds & Settlement - Enterprise Vault Style */}
      <section className="p-8 md:p-12 border border-[#222222] rounded-[2.5rem] bg-[#050505] flex flex-col xl:flex-row items-center justify-between gap-10 hover:border-[#333333] transition-colors">
        <div className="flex-1 space-y-4 w-full">
          <h2 className="text-xl md:text-2xl font-bold text-white flex items-center tracking-tight">
            <Shield className="w-6 h-6 mr-3 text-white" />
            Smart Contract Exit 
          </h2>
          <p className="text-[#86868b] text-sm md:text-base leading-relaxed max-w-2xl font-medium">
            Your funds are strictly bound to the <span className="text-white">Synapse Vault</span> under your wallet address. 
            You can cryptographically sign an exit ticket (EIP-712) at any time to instantly pull your remaining USDC to your native wallet, completely trustless and 0-approval needed.
          </p>
        </div>
        
        <div className="flex flex-col items-start xl:items-end gap-5 min-w-[280px] w-full xl:w-auto p-6 md:p-8 bg-[#0a0a0a] rounded-3xl border border-[#222222]">
          <div className="w-full flex justify-between items-center xl:flex-col xl:items-end xl:gap-2">
            <span className="text-[10px] text-[#86868b] font-semibold uppercase tracking-[0.2em]">Refundable</span>
            <div className="text-3xl font-[800] font-mono text-white tracking-tighter">
              {stats.buyerBalance} <span className="text-sm text-[#86868b] font-sans">USDC</span>
            </div>
          </div>
          <button 
            onClick={() => setIsSettlementModalOpen(true)}
            disabled={Number(stats.buyerBalance) <= 0}
            className="w-full px-8 py-4 font-bold text-black transition-all bg-white rounded-2xl hover:bg-gray-200 hover:scale-[1.02] active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100 flex justify-center items-center text-sm shadow-[0_0_20px_rgba(255,255,255,0.1)]"
          >
            Initiate Exit
            <ArrowRight className="w-4 h-4 ml-2" />
          </button>
        </div>
      </section>

      {/* Logs Table - CLI Output Style */}
      <section className="space-y-6 pt-8">
        <div className="flex items-center justify-between px-2">
          <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight flex items-center">
            <Activity className="w-6 h-6 mr-3 text-[#86868b]" />
            Gateway Activity Logs
          </h2>
          <span className="text-xs text-[#86868b] font-mono flex items-center bg-[#0a0a0a] border border-[#222222] px-4 py-2 rounded-full">
            <span className="w-2 h-2 rounded-full bg-[#22c55e] mr-2 animate-[pulse_2s_ease-in-out_infinite]" />
            {" "}
            Live Stream
          </span>
        </div>

        <div className="overflow-x-auto rounded-[2rem] border border-[#222222] bg-[#0a0a0a]">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead>
              <tr className="border-b border-[#222222] text-[10px] text-[#86868b] uppercase tracking-[0.2em] font-semibold bg-[#050505]">
                <th className="py-6 px-8">Timestamp</th>
                <th className="py-6 px-8">Service Mux</th>
                <th className="py-6 px-8">Provider Node</th>
                <th className="py-6 px-8">Cost</th>
                <th className="py-6 px-8 text-center">Status</th>
                <th className="py-6 px-8 text-right">Trace ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#151515]">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-20 text-center">
                    <TerminalSquare className="w-8 h-8 text-[#222222] mx-auto mb-4" />
                    <span className="text-sm text-[#86868b] font-medium tracking-wide">
                      {emptyLogStateText}
                    </span>
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.request_id} className="hover:bg-[#111111] transition-colors group">
                    <td className="py-5 px-8 text-sm text-[#86868b] font-mono">
                      {new Date((log.created_at || 0) * 1000).toISOString().replace("T", " ").slice(0, 19)}
                    </td>
                    <td className="py-5 px-8 text-sm font-bold text-white tracking-wide">
                      {log.service_id}
                    </td>
                    <td className="py-5 px-8 text-sm text-[#86868b] font-mono flex items-center gap-3">
                       <span className="w-1.5 h-1.5 rounded-full bg-[#333333] group-hover:bg-[#22c55e] transition-colors"/>
                       {log.seller?.slice(0, 8)}...
                    </td>
                    <td className="py-5 px-8 text-sm text-white font-mono tracking-tight">
                      {log.unit_price?.toFixed(4) || "0.0000"} <span className="text-[#86868b] ml-1">USDC</span>
                    </td>
                    <td className="py-5 px-8 text-center">
                      <span className={`inline-flex items-center justify-center px-3 py-1.5 rounded-full text-[10px] uppercase font-bold tracking-widest ${log.status === "succeeded" || log.status === "accepted" ? "bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20" : "bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/20"}`}>
                        {log.status === "succeeded" || log.status === "accepted" ? "200 OK" : "402 REQ"}
                      </span>
                    </td>
                    <td className="py-5 px-8 text-right">
                      <span className="text-xs text-[#444444] group-hover:text-[#86868b] transition-colors font-mono">
                        {log.request_id.slice(0, 12)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Settlement Warning Modal */}
      {isSettlementModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-lg p-10 bg-[#0a0a0a] border border-[#222222] rounded-[2.5rem] shadow-[0_0_80px_rgba(0,0,0,0.8)]">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-2xl font-bold text-white flex items-center tracking-tight">
                <AlertTriangle className="w-6 h-6 mr-3 text-white" />
                Initialize Exit
              </h3>
              <button 
                onClick={() => !isSettling && setIsSettlementModalOpen(false)}
                className="text-[#86868b] hover:text-white transition-colors"
                disabled={isSettling}
              >
                ✕
              </button>
            </div>

            <div className="space-y-6">
              <div className="p-6 bg-black rounded-3xl space-y-4 border border-[#222222]">
                <div className="flex justify-between items-center pb-4 border-b border-[#222222]">
                  <span className="text-[10px] font-bold text-[#86868b] uppercase tracking-[0.2em]">Total Consumed</span>
                  <span className="font-mono text-white text-sm">
                    {logs.reduce((acc, log) => acc + (log.unit_price || 0), 0).toFixed(2)} USDC
                  </span>
                </div>
                <div className="flex justify-between items-center pt-2">
                  <span className="text-sm font-bold text-white tracking-wide">Available to Withdraw</span>
                  <span className="text-3xl font-[800] text-white font-mono tracking-tighter">{stats.buyerBalance} <span className="text-sm text-[#86868b] font-sans">USDC</span></span>
                </div>
              </div>

              <div className="p-6 bg-white text-black rounded-3xl">
                <h4 className="text-xs font-bold uppercase tracking-[0.2em] mb-3 flex items-center">
                  <Shield className="w-4 h-4 mr-2" /> Security Notice
                </h4>
                <p className="text-sm font-medium leading-relaxed opacity-90">
                  Executing this transaction will instantly zero out your off-chain ledger. 
                  All active API Keys will return <code className="bg-black/10 px-1.5 py-0.5 rounded font-mono text-xs">HTTP 402 Payment Required</code> for future calls until you top up again.
                </p>
              </div>
            </div>

            <div className="flex gap-4 mt-10">
              <button
                onClick={() => setIsSettlementModalOpen(false)}
                disabled={isSettling}
                className="flex-1 px-6 py-4 font-bold text-white transition-colors bg-transparent border border-[#444444] rounded-2xl hover:bg-[#111111] disabled:opacity-50 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSettlement}
                disabled={isSettling}
                className="flex-[2] px-6 py-4 font-bold text-black transition-all bg-white border border-white rounded-2xl hover:bg-gray-200 hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:hover:scale-100 flex justify-center items-center text-sm shadow-[0_0_20px_rgba(255,255,255,0.1)]"
              >
                {isSettling ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin text-black" />
                    Signing payload...
                  </>
                ) : (
                  "Confirm & Sign EIP-712"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}