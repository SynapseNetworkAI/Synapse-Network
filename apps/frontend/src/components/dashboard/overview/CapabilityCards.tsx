import React from "react";
import { Shield, Key, Zap, Landmark } from "lucide-react";

export default function CapabilityCards() {
  const capabilities = [
    {
      icon: <Landmark className="w-4 h-4 text-amber-400" />,
      title: "Smart Vaults",
      description: "On-chain USDC deposits are converted into off-chain spendable balances for high-frequency agent interactions."
    },
    {
      icon: <Key className="w-4 h-4 text-blue-400" />,
      title: "Agent Credentials",
      description: "Issue secure credentials with granular budget policies and rate limits for autonomous agent identities."
    },
    {
      icon: <Zap className="w-4 h-4 text-emerald-400" />,
      title: "Atomic Settlement",
      description: "Our gateway handles real-time fee deduction and request routing with automatic rollback on failure."
    },
    {
      icon: <Shield className="w-4 h-4 text-purple-400" />,
      title: "Unified Ledger",
      description: "Transparent auditing and settlement for both consumers and providers with gas-less withdrawal options."
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {capabilities.map((cap, idx) => (
        <div key={idx} className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all group">
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 w-fit mb-4 group-hover:border-white/10 transition-colors">
            {cap.icon}
          </div>
          <h3 className="text-sm font-bold text-white mb-2">{cap.title}</h3>
          <p className="text-xs text-gray-500 leading-relaxed">
            {cap.description}
          </p>
        </div>
      ))}
    </div>
  );
}
