import Link from "next/link";
import { ArrowRight, Zap, Shield } from "lucide-react";

export default function OverviewHero() {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.03] to-transparent p-8 md:p-12">
      <div className="relative z-10 max-w-3xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 mb-6">
          <Zap className="w-3 h-3 text-blue-400" />
          <span className="text-[10px] font-bold tracking-widest text-blue-400 uppercase">The Agentic Economy</span>
        </div>
        
        <h2 className="text-4xl md:text-5xl font-black leading-tight text-white tracking-tight mb-6">
          Synapse Network: <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400">Financial Layer</span> for Autonomous Agents
        </h2>
        
        <p className="text-lg text-gray-400 leading-relaxed mb-8">
          The first M2M (Machine-to-Machine) infrastructure designed for the agentic era. 
          Enable your agents to discover, invoke, and pay for services autonomously with real-time settlement.
        </p>

        <div className="flex flex-wrap gap-4">
          <Link 
            href="/dashboard/agents" 
            className="flex items-center gap-2 px-6 py-3 text-sm font-bold text-black bg-white rounded-xl hover:bg-gray-200 transition-all active:scale-95"
          >
            Start as Consumer
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link 
            href="/dashboard/console" 
            className="flex items-center gap-2 px-6 py-3 text-sm font-bold text-white bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all active:scale-95"
          >
            Become a Provider
            <Shield className="w-4 h-4 text-emerald-400" />
          </Link>
        </div>
      </div>
      
      {/* Decorative background elements */}
      <div className="absolute top-0 right-0 -mt-20 -mr-20 w-64 h-64 bg-blue-500/10 rounded-full blur-[100px]" />
      <div className="absolute bottom-0 left-0 -mb-20 -ml-20 w-64 h-64 bg-emerald-500/10 rounded-full blur-[100px]" />
    </div>
  );
}
