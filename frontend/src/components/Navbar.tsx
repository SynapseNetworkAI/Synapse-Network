"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";

export default function Navbar() {
  const pathname = usePathname();

  const getLinkClasses = (path: string) => {
    // Treat /dashboard as active only if pathname is exactly /dashboard or /dashboard/billing
    // Otherwise it would light up on all /dashboard/* routes.
    const active = pathname === path || (path === "/dashboard" && pathname === "/dashboard/billing");
    
    if (active) {
      return "relative flex items-center px-4 py-1.5 font-mono text-sm font-bold text-green-400 bg-black border border-green-500 rounded box-border shadow-[0_0_12px_rgba(34,197,94,0.4)] [text-shadow:0_0_5px_rgba(34,197,94,0.8)] transition-all duration-300 scale-105 z-10 overflow-hidden";
    }
    
    return "relative flex items-center px-4 py-1.5 font-mono text-sm font-medium text-gray-500 border border-transparent rounded hover:text-green-400 hover:border-green-500/50 hover:bg-[#051505] hover:shadow-[0_0_8px_rgba(34,197,94,0.3)] transition-all duration-300";
  };

  return (
    <nav className="flex items-center justify-between p-4 bg-[#050505] border-b border-green-900/50">
      <div className="flex items-center space-x-8">
        <Link href="/" className="text-xl font-bold font-mono tracking-widest text-green-500 [text-shadow:0_0_8px_rgba(34,197,94,0.7)] hover:text-green-300 transition-colors">
          A2A-PAY<span className="animate-[pulse_1s_infinite]">_</span>
        </Link>
        <div className="flex items-center space-x-6">
          {/* Consumer Space */}
          <div className="flex items-center space-x-4 border-r border-green-900/50 pr-6">
            <span className="text-[10px] uppercase font-mono tracking-widest text-green-700/60 font-semibold mr-2 select-none">Consumer Space</span>
            <Link href="/dashboard/console" className={getLinkClasses('/dashboard/console')}>
              <span className={`mr-2 ${pathname === '/dashboard/console' ? 'animate-[pulse_1.5s_infinite] text-green-400 font-bold' : 'hidden md:inline text-green-800'}`}>&gt;</span>
              Developer Console
            </Link>
            <Link href="/dashboard" className={getLinkClasses('/dashboard')}>
              <span className={`mr-2 ${(pathname === '/dashboard' || pathname === '/dashboard/billing') ? 'animate-[pulse_1.5s_infinite] text-green-400 font-bold' : 'hidden md:inline text-green-800'}`}>&gt;</span>
              Usage & Billing
            </Link>
          </div>

          {/* Provider Space */}
          <div className="flex items-center space-x-4">
            <span className="text-[10px] uppercase font-mono tracking-widest text-green-700/60 font-semibold mr-2 select-none">Provider Space</span>
            <Link href="/dashboard/services" className={getLinkClasses('/dashboard/services')}>
              <span className={`mr-2 ${pathname === '/dashboard/services' ? 'animate-[pulse_1.5s_infinite] text-green-400 font-bold' : 'hidden md:inline text-green-800'}`}>&gt;</span>
              Service Registry
            </Link>
            <Link href="/dashboard/settlement" className={getLinkClasses('/dashboard/settlement')}>
              <span className={`mr-2 ${pathname === '/dashboard/settlement' ? 'animate-[pulse_1.5s_infinite] text-green-400 font-bold' : 'hidden md:inline text-green-800'}`}>&gt;</span>
              Settlement
            </Link>
          </div>
        </div>
      </div>
      <div className="flex items-center space-x-4">
        <ConnectButton />
      </div>
    </nav>
  );
}
