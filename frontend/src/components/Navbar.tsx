"use client";

import Link from "next/link";

import { Network } from "lucide-react";

export default function Navbar() {
  return (
    <nav className="flex items-center justify-between p-4 bg-[#050505] border-b border-green-900/50 sticky top-0 z-50">
      <div className="flex items-center space-x-8">
        <Link href="/" className="text-xl font-bold font-mono tracking-widest text-green-500 [text-shadow:0_0_8px_rgba(34,197,94,0.7)] hover:text-green-300 transition-colors flex items-center">
          A2A-PAY<span className="animate-[pulse_1s_infinite]">_</span>
        </Link>
        <div className="hidden md:flex items-center px-3 py-1 rounded bg-green-900/20 border border-green-500/30 text-green-400 text-xs font-mono">
          <Network className="w-3 h-3 mr-2 animate-pulse" />
          Gateway Node: Online
        </div>
      </div>
      
    </nav>
  );
}