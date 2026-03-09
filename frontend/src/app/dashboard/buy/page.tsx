"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { ethers } from "ethers";
import { listAgents } from "@/utils/agentApi";
import { agentStore } from "@/utils/agentStore";
import { Bot, Plus, ArrowRight, ShieldCheck, CreditCard, Activity } from "lucide-react";
import contractConfig from "@/contract-config.json";
import MockUSDCABI from "@/MockUSDCABI.json";

export default function BuyPage() {
  const { address: userAddress } = useAccount();
  const [buyerAgents, setBuyerAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Read USDC balance
  const { data: balanceData } = useReadContract({
    address: contractConfig.MockUSDC as `0x${string}`,
    abi: MockUSDCABI,
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: {
         enabled: !!userAddress
    }
  });

  const loadAgents = useCallback(async () => {
    if (!userAddress) {
      setLoading(false);
      return;
    }
    
    // Fallback/merging logic to include agents saved in localStorage 
    // that haven't sync'd up or use custom role spellings
    const localAgents = agentStore.getAgentsByOwner(userAddress);
    
    try {
      const serverAgents = await listAgents(userAddress);
      
      const merged = serverAgents.map((sa: any) => {
        const local = localAgents.find(la => la.address.toLowerCase() === String(sa.address).toLowerCase());
        return { ...sa, privateKey: local ? local.privateKey : "" };
      });
      
      const missingLocalAgents = localAgents.filter(la => 
        !merged.find(ma => String(ma.address).toLowerCase() === la.address.toLowerCase())
      );
      
      const allAgents = [...merged, ...missingLocalAgents];

      const buyers = allAgents.filter((a: any) => {
        const r = String(a.role || "").toLowerCase();
        return r.includes("buyer") || r.includes("hybrid");
      }).sort((a: any, b: any) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      
      setBuyerAgents(buyers);
    } catch (err) {
      console.error("Failed to sync buyer agents", err);
      // Fallback to purely local
      const buyers = localAgents.filter((a: any) => {
        const r = String(a.role || "").toLowerCase();
        return r.includes("buyer") || r.includes("hybrid");
      }).sort((a: any, b: any) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      
      setBuyerAgents(buyers);
    } finally {
      setLoading(false);
    }
  }, [userAddress]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const displayBalance = balanceData 
    ? Number.parseFloat(ethers.formatUnits(balanceData as bigint, 18)).toFixed(2)
    : "0.00";

  return (
    <div className="max-w-6xl p-8 mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Buy Workspace</h1>
        <p className="mt-2 text-gray-400">
          面向调用方：总钱包充值担保，针对智能体独立签发凭据，调用卖家服务共享消费流水。
        </p>
      </div>

      {/* Global Section: Fund & Balances */}
      <section className="p-6 space-y-4 transition border border-gray-800 shadow-lg rounded-xl bg-black/40 shadow-yellow-500/5 hover:border-gray-700">
        <div className="flex items-center justify-between pb-4 border-b border-gray-800">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/10">
                <CreditCard className="w-6 h-6 text-yellow-500" />
              </div>
              <h2 className="text-xl font-bold tracking-wide text-white">Step 1 · 充值担保 (全局资金池)</h2>
            </div>
            <Link href="/dashboard/router" className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-black transition-colors bg-yellow-500 rounded-lg hover:bg-yellow-400">
                去充值配置 <ArrowRight className="w-4 h-4" />
            </Link>
        </div>

        <div className="flex items-center justify-between pt-2">
            <div>
              <p className="text-sm font-medium tracking-widest text-gray-400 uppercase">全局钱包地址 (Owner)</p>
              <p className="mt-1 font-mono text-lg text-gray-200">
                {userAddress ? `${userAddress.slice(0, 8)}...${userAddress.slice(-6)}` : "未连接钱包"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium tracking-widest text-gray-400 uppercase">可用资金池余额 (USDC)</p>
              <p className="mt-1 font-mono text-4xl font-bold tracking-tight text-yellow-500">
                {userAddress ? displayBalance : "--"}
              </p>
            </div>
        </div>
      </section>

      {/* Local Section: Agents & Credentials */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10">
              <ShieldCheck className="w-6 h-6 text-green-500" />
            </div>
            <h2 className="text-xl font-bold tracking-wide text-white">Step 2 · 智能体与凭据 (执行单元)</h2>
          </div>
          <Link href="/dashboard/agents" className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-300 transition border border-gray-700 rounded-lg hover:bg-gray-800">
            <Plus className="w-4 h-4" /> 创建新的 Buyer Agent
          </Link>
        </div>
        
        <div className="inline-block p-3 mb-6 text-sm text-gray-400 border rounded-lg bg-gray-900/30 border-gray-800/50">
          当前共挂载了 <strong className="mx-1 text-base text-white">{buyerAgents.length}</strong> 个 Buyer Agent。每个 Agent 享有独立的鉴权凭据，但共享总钱包资金池。
        </div>

        {loading ? (
          <div className="p-12 text-center border border-gray-800 rounded-xl bg-[#0f1115] text-gray-500 animate-pulse flex flex-col items-center">
            <Bot className="w-8 h-8 mb-3 opacity-20" />
            <p>加载智能体中...</p>
          </div>
        ) : buyerAgents.length === 0 ? (
          <div className="p-12 text-center border border-dashed border-gray-700/50 rounded-xl bg-[#0f1115] hover:bg-gray-900/50 transition">
            <Bot className="w-12 h-12 mx-auto mb-4 text-gray-600" />
            <p className="mb-2 text-base font-medium text-gray-300">您当前钱包下暂未创建买方智能体 (Buyer Agent)</p>
            <p className="mb-6 text-sm text-gray-500">创建独立 Agent 获取专有调用凭证，以请求卖家 API。</p>
            <Link href="/dashboard/agents" className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-green-500 border border-green-500/30 bg-green-500/5 rounded-lg hover:bg-green-500/20 transition">
              前往创建专属 Agent <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {buyerAgents.map((agent: any) => (
              <div key={agent.id} className="group flex flex-col p-5 border border-gray-800 rounded-xl bg-[#0f1115] hover:border-green-500/50 hover:shadow-lg hover:shadow-green-500/5 transition-all">
                <div className="flex items-start justify-between mb-5">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-green-500/10 rounded-xl group-hover:bg-green-500/20 transition">
                        <Bot className="w-6 h-6 text-green-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white text-lg truncate max-w-[140px] leading-tight">{agent.name}</h3>
                        <p className="font-mono text-xs text-gray-500 mt-1 flex items-center gap-1.5 opacity-80">
                          <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500"></span>
                          {agent.address.slice(0, 8)}...{agent.address.slice(-6)}
                        </p>
                      </div>
                    </div>
                </div>
                
                <div className="flex flex-col gap-2.5 mt-auto pt-5 border-t border-gray-800/60">
                  <Link href={`/dashboard/credentials?agentId=${agent.id}`} className="w-full inline-flex items-center justify-center px-4 py-2.5 text-sm font-semibold text-green-400 bg-green-400/10 border border-green-400/20 rounded-lg hover:bg-green-400/20 hover:text-green-300 transition-colors">
                    配置调用凭据 (Credential)
                  </Link>
                  <Link href={`/dashboard/discover?agentId=${agent.id}`} className="w-full inline-flex items-center justify-center px-4 py-2.5 text-sm font-semibold text-gray-300 bg-gray-800 rounded-lg hover:bg-gray-700 hover:text-white transition-colors border border-transparent hover:border-gray-600">
                    发现并调用 API
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Billing Section */}
      <section className="p-6 mt-8 space-y-4 transition border border-gray-800 rounded-xl bg-black/40 hover:border-gray-700">
        <div className="flex items-center justify-between pb-4 border-b border-gray-800">
            <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <Activity className="w-6 h-6 text-blue-500" />
                </div>
                <h2 className="text-xl font-bold tracking-wide text-white">Step 3 · 消费对账 (全局统一结算)</h2>
            </div>
            <Link href="/dashboard/billing" className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white transition bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700">
                打开对账单 <ArrowRight className="w-4 h-4" />
            </Link>
        </div>
        <p className="max-w-4xl mt-2 text-sm leading-relaxed text-gray-400">
          所有执行单元 (子 Agent) 产生的 API 调用与扣费账单，最终都会汇聚在 Owner 总钱包下统一展现与核销。在结算中心你可以查看、导出完整的聚合交易流水。
        </p>
      </section>
    </div>
  );
}
