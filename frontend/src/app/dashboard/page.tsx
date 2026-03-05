"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Bot, Key, Activity, Wallet, ArrowUpRight, ArrowDownRight, ActivitySquare, RefreshCw, HandCoins } from "lucide-react";
import { agentStore, AgentIdentity } from "@/utils/agentStore";

export default function Dashboard() {
  const [agents, setAgents] = useState<AgentIdentity[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    setAgents(agentStore.getAgents());
  }, []);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 800);
  };

  // Mock global stats for Dashboard Phase 10
  const activeAgentsCount = agents.length;
  const mockTotalBalance = "14052.50";
  const mock24hRevenue = "+$342.10";
  const mock24hExpense = "-$12.40";
  const mockNetProfit = "+$329.70";

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-gray-800 pb-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center">
            <Bot className="mr-3 text-green-400" />
            Master Fleet Control
          </h1>
          <p className="text-gray-400 mt-2">Manage your autonomous AI entities and aggregate financial flows</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={handleRefresh}
            className="p-2 border border-gray-700 bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors text-gray-300"
            title="Refresh Fleet Status"
          >
            <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin text-green-400' : ''}`} />
          </button>
          <Link href="/dashboard/agents/create">
            <button className="bg-green-500 hover:bg-green-600 text-black font-bold py-2 px-6 rounded-lg flex items-center transition-colors">
              <Plus className="mr-2 h-5 w-5" />
              Deploy Agent
            </button>
          </Link>
        </div>
      </div>

      {/* Global Overview Module */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-black border border-gray-800 p-6 rounded-xl relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-400 font-medium text-sm">Aggregated Balance</h3>
            <Wallet className="text-green-500 w-5 h-5" />
          </div>
          <div className="text-3xl font-bold text-white mb-1"><span className="text-green-500">$</span>{agents.length > 0 ? mockTotalBalance : "0.00"}</div>
          <p className="text-xs text-gray-500">Master + {agents.length} Sub-Wallets</p>
        </div>

        <div className="bg-black border border-gray-800 p-6 rounded-xl relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-400 font-medium text-sm">24h Revenue</h3>
            <ArrowUpRight className="text-emerald-400 w-5 h-5" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 mb-1">{agents.length > 0 ? mock24hRevenue : "$0.00"}</div>
          <p className="text-xs text-gray-500">From AI services</p>
        </div>

        <div className="bg-black border border-gray-800 p-6 rounded-xl relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-400 font-medium text-sm">24h Expense / Gas</h3>
            <ArrowDownRight className="text-red-400 w-5 h-5" />
          </div>
          <div className="text-2xl font-bold text-red-400 mb-1">{agents.length > 0 ? mock24hExpense : "$0.00"}</div>
          <p className="text-xs text-gray-500">On-chain transaction costs</p>
        </div>

        <div className="bg-black border border-gray-800 p-6 rounded-xl relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-400 font-medium text-sm">Net Profit (24h)</h3>
            <ActivitySquare className="text-blue-400 w-5 h-5" />
          </div>
          <div className="text-2xl font-bold text-blue-400 mb-1">{agents.length > 0 ? mockNetProfit : "$0.00"}</div>
          <p className="text-xs text-gray-500">Auto-calculated</p>
        </div>
      </div>

      <div className="mb-4">
        <h2 className="text-xl font-bold text-white border-l-4 border-green-500 pl-3">Active Agent Fleet</h2>
      </div>

      {/* Fleet Table / Cards Module */}
      {agents.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-gray-800 rounded-xl bg-gray-900/20">
          <Bot className="mx-auto h-12 w-12 text-gray-600 mb-4" />
          <h3 className="text-xl font-medium text-gray-300">No Agents Deployed</h3>
          <p className="mt-2 text-gray-500">Create your first AI agent to start processing autonomous transactions.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map(agent => (
            <div key={agent.id} className="border border-gray-800 bg-black p-6 rounded-xl relative overflow-hidden group hover:border-green-900/50 transition-all">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-gray-800 to-gray-700 group-hover:from-green-500 group-hover:to-emerald-800 transition-all"></div>
              
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="bg-gray-900 p-2 rounded-lg border border-gray-800">
                    <Bot className="w-6 h-6 text-green-400" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-green-400 leading-tight">{agent.name}</h3>
                    <span className="text-xs text-gray-500 font-mono tracking-wide">{agent.role}</span>
                  </div>
                </div>
                <div className="flex items-center text-xs px-2 py-1 bg-green-500/10 text-green-400 rounded-full border border-green-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 mr-1.5 animate-pulse"></span>
                  Active
                </div>
              </div>
              
              <div className="space-y-4 mb-6">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Sub-Wallet Address</label>
                  <div className="font-mono text-sm text-gray-300 truncate bg-gray-900/50 px-3 py-2 rounded mt-1 border border-gray-800/50 select-all">
                    {agent.address}
                  </div>
                </div>
                
                <div className="flex justify-between items-center bg-gray-900/40 p-3 rounded-lg border border-gray-800/50">
                  <span className="text-sm text-gray-400">Balance</span>
                  <div className="flex items-center gap-1 font-mono">
                    <span className="text-green-500">$</span>
                    <span className="text-gray-200">120.50</span>
                    <span className="text-xs text-gray-500 ml-1">USDC</span>
                  </div>
                </div>
              </div>
              
              <div className="flex gap-2">
                <button 
                  onClick={() => alert(`Mock: Funding agent with 10 USDC from Master Wallet...`)}
                  className="flex-1 bg-gray-900 hover:bg-gray-800 text-green-400 py-2 rounded-lg text-sm font-medium transition-colors border border-green-900/30 hover:border-green-500/50 flex items-center justify-center">
                  <HandCoins className="w-4 h-4 mr-1.5" />
                  Fund
                </button>
                
                <button 
                  onClick={() => alert(`Mock: Sweeping all USDC from ${agent.name} back to Master.`)}
                  className="flex-1 bg-gray-900 hover:bg-gray-800 text-blue-400 py-2 rounded-lg text-sm font-medium transition-colors border border-blue-900/30 hover:border-blue-500/50 flex items-center justify-center">
                  <ArrowUpRight className="w-4 h-4 mr-1.5" />
                  Sweep
                </button>

                <Link href={`/dashboard/agents/${agent.id}`} className="flex-1 flex" title="Agent Analytics & Details">
                  <button className="w-full h-full bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors border border-gray-700 flex items-center justify-center p-2">
                    <Activity className="w-4 h-4" />
                  </button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}