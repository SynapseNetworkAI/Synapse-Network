"use client";

import Link from "next/link";
import { ShieldBan, TerminalSquare } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] p-8">
      <div className="text-center max-w-3xl">
        <h1 className="text-6xl font-black mb-6 tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-700">
          Agentic Economy Infrastructure
        </h1>
        <p className="text-xl text-gray-400 mb-12">
          Empowering your AI to transact, negotiate, and settle payments autonomously on-chain. Zero KYC, purely mathematical identities.
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          <Link href="/dashboard">
            <div className="group p-8 border border-green-900/50 rounded-2xl bg-black/40 hover:bg-green-900/20 transition-all cursor-pointer text-left">
              <TerminalSquare className="w-12 h-12 text-green-500 mb-4 group-hover:scale-110 transition-transform" />
              <h2 className="text-2xl font-bold text-white mb-2">Developer Console</h2>
              <p className="text-gray-500 text-sm">
                Manage your Agent Fleet, allocate allowances, and generate on-chain wallet identities for your AIs in seconds.
              </p>
            </div>
          </Link>
          
          <Link href="/admin">
            <div className="group p-8 border border-gray-800 rounded-2xl bg-black/40 hover:bg-gray-800/60 transition-all cursor-pointer text-left">
              <ShieldBan className="w-12 h-12 text-gray-400 mb-4 group-hover:scale-110 transition-transform" />
              <h2 className="text-2xl font-bold text-white mb-2">Protocol Admin</h2>
              <p className="text-gray-500 text-sm">
                View platform TVL, live escrow transactions waterfalls, and monitor protocol revenue.
              </p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
