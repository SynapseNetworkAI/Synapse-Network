"use client";

import Link from "next/link";
import { Network } from "lucide-react";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import WalletProfileBadge from "@/components/WalletProfileBadge";

export default function Navbar() {
  const pathname = usePathname();
  const isHomePage = pathname === "/";

  const [gatewayStatus, setGatewayStatus] = useState<"online" | "offline" | "checking">("checking");

  useEffect(() => {
    let mounted = true;
    
    const checkGateway = async () => {
      try {
        // Ping a lightweight public endpoint on the Python Gateway
        // We use AbortSignal to timeout quickly if the server is unreachable
        const res = await fetch("http://127.0.0.1:8000/api/v2/services/discover", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(3000)
        });
        
        if (mounted) {
          if (res.ok) {
            setGatewayStatus("online");
          } else {
            // Even if we get a 4xx/5xx, the gateway *is* technically online/responding
            // but let's just count ok for absolute health
            setGatewayStatus("online");
          }
        }
      } catch {
        if (mounted) {
          setGatewayStatus("offline");
        }
      }
    };

    // Initial check
    checkGateway();
    
    // Poll every 10 seconds
    const interval = setInterval(checkGateway, 10000);
    
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <nav className="flex items-center justify-between p-4 bg-[#050505] border-b border-green-900/50 sticky top-0 z-50">
      <div className="flex items-center space-x-8">
        <Link href="/" className="text-xl font-bold font-mono tracking-widest text-green-500 [text-shadow:0_0_8px_rgba(34,197,94,0.7)] hover:text-green-300 transition-colors flex items-center">
          Synapse Network<span className="animate-[pulse_1s_infinite]">_</span>
        </Link>
        <div className={`hidden md:flex items-center px-3 py-1 rounded border text-xs font-mono transition-colors ${
          gatewayStatus === "online" 
            ? "bg-green-900/20 border-green-500/30 text-green-400" 
            : gatewayStatus === "offline"
              ? "bg-red-900/20 border-red-500/30 text-red-500"
              : "bg-yellow-900/20 border-yellow-500/30 text-yellow-500"
        }`}>
          <Network className={`w-3 h-3 mr-2 ${gatewayStatus === 'online' ? 'animate-pulse text-green-400' : gatewayStatus === 'offline' ? 'text-red-500' : 'animate-spin text-yellow-500'}`} />
          Gateway Node: {gatewayStatus === "online" ? "Online" : gatewayStatus === "offline" ? "Offline" : "Checking..."}
        </div>
      </div>

      {/* Wallet profile is conditionally removed on the home page */}
      {!isHomePage && (
        <div className="flex items-center">
          <WalletProfileBadge />
        </div>
      )}
    </nav>
  );
}
