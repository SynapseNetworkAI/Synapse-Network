import React from "react";
import { Wallet, UserPlus, Search, Zap, PlusCircle, Server, DollarSign, ArrowRight, CreditCard } from "lucide-react";
import Link from "next/link";

export default function WorkflowSection() {
  const consumerSteps = [
    {
      icon: <Wallet className="w-4 h-4 text-blue-400" />,
      title: "Deposit USDC",
      description: "Fund your vault on the Synapse smart contract to enable agent spending.",
      link: "/dashboard/billing",
      linkText: "Open Treasury"
    },
    {
      icon: <UserPlus className="w-4 h-4 text-blue-400" />,
      title: "Create Agent",
      description: "Provision a runtime identity for your autonomous agent to act on your behalf.",
      link: "/dashboard/agents",
      linkText: "Manage Agents"
    },
    {
      icon: <Search className="w-4 h-4 text-blue-400" />,
      title: "Service Discovery",
      description: "Find the best API services and service definitions in the network through discovery.",
      link: "/dashboard/discovery",
      linkText: "Explore Services"
    },
    {
      icon: <Zap className="w-4 h-4 text-blue-400" />,
      title: "Attach Runtime Credentials",
      description: "Issue the credential that your agent runtime will actually use before discovery, quote, and paid invocation.",
      link: "/dashboard/credentials",
      linkText: "Open Agent Credentials"
    }
  ];

  const providerSteps = [
    {
      icon: <PlusCircle className="w-4 h-4 text-emerald-400" />,
      title: "Create Service",
      description: "Define your API service, service definition, pricing, and runtime routing in the Provider workspace.",
      link: "/provider/services/deploy",
      linkText: "Publish API Service"
    },
    {
      icon: <Server className="w-4 h-4 text-emerald-400" />,
      title: "Serve Agents",
      description: "Receive high-frequency calls from autonomous agents through the gateway.",
      link: "/provider/health",
      linkText: "Monitor Health"
    },
    {
      icon: <DollarSign className="w-4 h-4 text-emerald-400" />,
      title: "Earn USDC",
      description: "Accumulate earnings in your provider wallet for every successful invocation.",
      link: "/provider/usage",
      linkText: "View Revenue"
    },
    {
      icon: <CreditCard className="w-4 h-4 text-emerald-400" />,
      title: "Withdraw",
      description: "Gas-less withdrawals of your revenue back to your main wallet.",
      link: "/provider/settlements",
      linkText: "Open Settlements"
    }
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
      {/* Consumer Path */}
      <div className="space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <UserPlus className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">Consumer Path</h3>
            <p className="text-xs text-gray-500">Build for agents, let agents pay.</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {consumerSteps.map((step, idx) => (
            <div key={step.title} className="group p-5 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-blue-500/30 transition-all">
              <div className="flex items-center justify-between mb-4">
                <div className="p-2 rounded-lg bg-white/[0.03] border border-white/5 group-hover:bg-blue-500/10 group-hover:border-blue-500/20 transition-colors">
                  {step.icon}
                </div>
                <span className="text-[10px] font-mono text-gray-600 group-hover:text-blue-400/60 transition-colors">0{idx + 1}</span>
              </div>
              <h4 className="text-sm font-bold text-white mb-2">{step.title}</h4>
              <p className="text-xs text-gray-500 leading-relaxed mb-4">{step.description}</p>
              <Link href={step.link} className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors uppercase tracking-widest">
                {step.linkText}
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* Provider Path */}
      <div className="space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <Server className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">Provider Path</h3>
            <p className="text-xs text-gray-500">Monetize your APIs for the agentic economy.</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {providerSteps.map((step, idx) => (
            <div key={step.title} className="group p-5 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-emerald-500/30 transition-all">
              <div className="flex items-center justify-between mb-4">
                <div className="p-2 rounded-lg bg-white/[0.03] border border-white/5 group-hover:bg-emerald-500/10 group-hover:border-emerald-500/20 transition-colors">
                  {step.icon}
                </div>
                <span className="text-[10px] font-mono text-gray-600 group-hover:text-emerald-400/60 transition-colors">0{idx + 1}</span>
              </div>
              <h4 className="text-sm font-bold text-white mb-2">{step.title}</h4>
              <p className="text-xs text-gray-500 leading-relaxed mb-4">{step.description}</p>
              <Link href={step.link} className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 hover:text-emerald-300 transition-colors uppercase tracking-widest">
                {step.linkText}
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
