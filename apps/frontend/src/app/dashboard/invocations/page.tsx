"use client";

import React from "react";
import { History, Search, Filter, ArrowUpRight, CheckCircle2, XCircle, Clock } from "lucide-react";

export default function InvocationsPage() {
  const invocations = [
    { id: "inv_1", service: "GPT-4o Text Generation", agent: "ResearchBot-01", cost: "0.015", status: "success", time: "2 mins ago", latency: "1.2s" },
    { id: "inv_2", service: "Stable Diffusion XL", agent: "CreativeAgent", cost: "0.040", status: "success", time: "15 mins ago", latency: "4.5s" },
    { id: "inv_3", service: "Web Search API", agent: "ResearchBot-01", cost: "0.005", status: "failed", time: "1 hour ago", latency: "0.8s" },
    { id: "inv_4", service: "Claude 3.5 Sonnet", agent: "CodingAssistant", cost: "0.025", status: "success", time: "3 hours ago", latency: "2.1s" },
  ];

  return (
    <div className="p-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <History className="w-6 h-6 text-blue-400" />
            Invocations
          </h1>
          <p className="text-sm text-gray-500 mt-1">Real-time logs of all agent-to-service interactions.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input 
              type="text" 
              placeholder="Search by ID or Service..." 
              className="pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50 w-64"
            />
          </div>
          <button className="p-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors">
            <Filter className="w-4 h-4 text-gray-400" />
          </button>
        </div>
      </div>

      <div className="bg-[#0a0a0c] border border-white/5 rounded-2xl overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-white/5 bg-white/[0.02]">
              <th className="px-6 py-4 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Invocation ID</th>
              <th className="px-6 py-4 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Service</th>
              <th className="px-6 py-4 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Agent</th>
              <th className="px-6 py-4 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Cost (USDC)</th>
              <th className="px-6 py-4 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-4 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Latency</th>
              <th className="px-6 py-4 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {invocations.map((inv) => (
              <tr key={inv.id} className="hover:bg-white/[0.01] transition-colors group">
                <td className="px-6 py-4">
                  <span className="text-xs font-mono text-gray-400 group-hover:text-blue-400 transition-colors">{inv.id}</span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{inv.service}</span>
                    <ArrowUpRight className="w-3 h-3 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="text-xs text-gray-400">{inv.agent}</span>
                </td>
                <td className="px-6 py-4">
                  <span className="text-sm font-mono text-emerald-400">${inv.cost}</span>
                </td>
                <td className="px-6 py-4">
                  {inv.status === "success" ? (
                    <div className="flex items-center gap-1.5 text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span className="text-[11px] font-bold uppercase tracking-wider">Success</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-red-400">
                      <XCircle className="w-3.5 h-3.5" />
                      <span className="text-[11px] font-bold uppercase tracking-wider">Failed</span>
                    </div>
                  )}
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-1.5 text-gray-500">
                    <Clock className="w-3 h-3" />
                    <span className="text-xs font-mono">{inv.latency}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="text-xs text-gray-500">{inv.time}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
