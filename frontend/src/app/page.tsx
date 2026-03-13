"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setAppRole, getAppRole, clearAppRole } from "@/utils/roleStore";
import { ArrowRight, ShieldCheck, Zap, ReceiptText } from "lucide-react";
import { useAccount, useDisconnect } from "wagmi";
import { getWalletRole, bindWalletRole } from "@/utils/serviceApi";
import RoleWarningModal from "@/components/RoleWarningModal";
import Link from "next/link";

export default function Home() {
  const router = useRouter();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();

  const [isWarningOpen, setIsWarningOpen] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<{ role: 'CONSUMER' | 'PROVIDER' | 'ADMIN', path: string, targetRoleStr: "Buyer" | "Seller" } | null>(null);

  const handleEnterRole = async (role: 'CONSUMER' | 'PROVIDER' | 'ADMIN', path: string) => {
    if (role === 'ADMIN') {
      executeRoute(role, path);
      return;
    }
    
    if (!address) {
      executeRoute(role, path);
      return;
    }

    try {
      const backendRole = await getWalletRole(address);
      if (backendRole && backendRole !== role) {
          setPendingRoute({ role, path, targetRoleStr: role === 'CONSUMER' ? "Buyer" : "Seller" });
          setIsWarningOpen(true);
          return;
      }

      const cachedRole = getAppRole(address);
      if (cachedRole && cachedRole !== role && cachedRole !== 'ADMIN') {
        setPendingRoute({ role, path, targetRoleStr: role === 'CONSUMER' ? "Buyer" : "Seller" });
        setIsWarningOpen(true);
        return;
      }

      if (!backendRole) {
          const bound = await bindWalletRole(address, role);
          if (!bound) {
            setPendingRoute({ role, path, targetRoleStr: role === 'CONSUMER' ? "Buyer" : "Seller" });
            setIsWarningOpen(true);
            return;
          }
      }
    } catch (e) {
      console.warn("Failed to check exact role status on entry:", e);
    }

    executeRoute(role, path);
  };

  const executeRoute = (role: 'CONSUMER' | 'PROVIDER' | 'ADMIN', path: string) => {
    setAppRole(role, address);
    router.push(path);
  };

  const handleDisconnectWarning = () => {
    if (address) {
      clearAppRole(address);
    }
    disconnect();
    setIsWarningOpen(false);
  };

  return (
    <div className="min-h-[calc(100vh-73px)] flex flex-col justify-between items-center w-full">
      <RoleWarningModal
        isOpen={isWarningOpen}
        onDisconnect={handleDisconnectWarning}
        targetRole={pendingRoute?.targetRoleStr || "Seller"}
      />
      
      <main className="flex-grow flex flex-col items-center justify-center px-6 md:px-8 py-20 w-full max-w-7xl mx-auto">
        <div className="max-w-4xl text-center space-y-8 mb-20 flex flex-col items-center">
          <p className="uppercase tracking-[0.3em] font-medium text-xs text-green-400">Synapse Network</p>
          <h1 className="text-4xl md:text-6xl font-black leading-tight bg-clip-text text-transparent bg-gradient-to-b from-white to-gray-400">
            Synapse：链接硅基生命的<br/> API 结算中枢。
          </h1>
          <p className="text-lg md:text-xl text-gray-400 leading-relaxed max-w-2xl mx-auto">
            我们是面向 AI Agent 的支付与结算基础设施：让买家 Agent 可以安全调用他人 API，让卖家 API 可以按调用自动收款。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-6 mt-10 w-full">
            <button 
              onClick={() => handleEnterRole('CONSUMER', '/dashboard/buyer')}
              className="min-w-[180px] h-14 inline-flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 text-black px-8 rounded-full font-bold text-base transition-all hover:scale-105 shadow-[0_0_20px_rgba(34,197,94,0.3)]"
            >
              买家接入 (Consumer)
              <ArrowRight className="w-5 h-5 ml-1" />
            </button>
            
            <button 
              onClick={() => handleEnterRole('PROVIDER', '/dashboard/sell')}
              className="min-w-[180px] h-14 inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-8 rounded-full font-bold text-base transition-all hover:scale-105 shadow-[0_0_20px_rgba(37,99,235,0.2)]"
            >
              卖家接入 (Provider)
              <ArrowRight className="w-5 h-5 ml-1" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full mx-auto">
          <div className="bg-black/60 border border-gray-800/80 p-8 rounded-2xl hover:border-gray-700 transition-colors">
            <ShieldCheck className="w-8 h-8 text-green-400 mb-5" />
            <h2 className="text-xl font-bold text-gray-200 mb-3">资金安全</h2>
            <p className="text-gray-500 text-sm leading-relaxed">
              买家先充值到智能合约 Vault，资金有链上担保，不依赖单点托管账户。
            </p>
          </div>
          <div className="bg-black/60 border border-gray-800/80 p-8 rounded-2xl hover:border-gray-700 transition-colors">
            <Zap className="w-8 h-8 text-yellow-400 mb-5" />
            <h2 className="text-xl font-bold text-gray-200 mb-3">高频低延迟</h2>
            <p className="text-gray-500 text-sm leading-relaxed">
              调用走平台 Gateway 离链原子扣费，不必逐笔上链，适配 Agent 高频调用场景。
            </p>
          </div>
          <div className="bg-black/60 border border-gray-800/80 p-8 rounded-2xl hover:border-gray-700 transition-colors">
            <ReceiptText className="w-8 h-8 text-blue-400 mb-5" />
            <h2 className="text-xl font-bold text-gray-200 mb-3">费用透明</h2>
            <p className="text-gray-500 text-sm leading-relaxed">
              每笔调用都展示扣费拆分：平台费、卖家净收入、剩余余额，账单可审计可对账。
            </p>
          </div>
        </div>
      </main>

      <footer className="w-full border-t border-gray-800/60 bg-[#050505] py-12 mt-10">
        <div className="max-w-6xl mx-auto px-6 md:px-8 grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="md:col-span-1 space-y-4">
            <Link href="/" className="text-xl font-bold font-mono tracking-widest text-white flex items-center">
              Synapse<span className="text-green-500">_</span>
            </Link>
            <p className="text-xs text-gray-600">
              © 2026 Synapse Network, Inc. <br/>
              Building the Agent Economy.
            </p>
          </div>
          
          <div>
            <h4 className="text-white font-semibold mb-4">Product</h4>
            <ul className="space-y-3 text-sm text-gray-500">
              <li><Link href="/dashboard/discover" className="hover:text-green-400 transition-colors">Discover APIs</Link></li>
              <li><button onClick={() => handleEnterRole('CONSUMER', '/dashboard/buyer')} className="hover:text-green-400 transition-colors">For Buyers</button></li>
              <li><button onClick={() => handleEnterRole('PROVIDER', '/dashboard/sell')} className="hover:text-green-400 transition-colors">For Providers</button></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">Developers</h4>
            <ul className="space-y-3 text-sm text-gray-500">
              <li><a href="#" className="hover:text-green-400 transition-colors">Documentation</a></li>
              <li><a href="#" className="hover:text-green-400 transition-colors">API Reference</a></li>
              <li><a href="#" className="hover:text-green-400 transition-colors">Python SDK</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">Connect</h4>
            <ul className="space-y-3 text-sm text-gray-500">
              <li><a href="#" className="hover:text-green-400 transition-colors">Discord</a></li>
              <li><a href="#" className="hover:text-green-400 transition-colors">X (Twitter)</a></li>
              <li><a href="#" className="hover:text-green-400 transition-colors">GitHub</a></li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
