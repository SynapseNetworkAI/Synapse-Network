"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setAppRole } from "@/utils/roleStore";
import { ShieldCheck, Zap, ReceiptText, ChevronDown } from "lucide-react";
import { useAccount, useDisconnect } from "wagmi";
import { getWalletRole } from "@/utils/serviceApi";
import RoleWarningModal from "@/components/RoleWarningModal";

export default function Home() {
  const router = useRouter();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();

  const [isWarningOpen, setIsWarningOpen] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<{ role: 'CONSUMER' | 'PROVIDER' | 'ADMIN', path: string, targetRoleStr: "Buyer" | "Seller" } | null>(null);

  const handleEnterRole = async (role: 'CONSUMER' | 'PROVIDER' | 'ADMIN', path: string) => {
    if (!address) {
      setAppRole(role);
      router.push(path);
      return;
    }
    
    // Check wallet role to show warning if needed
    const walletRole = await getWalletRole(address);
    if (walletRole !== "UNKNOWN" && walletRole !== role) {
      setPendingRoute({ role, path, targetRoleStr: role === 'CONSUMER' ? "Buyer" : "Seller" });
      setIsWarningOpen(true);
      return;
    }

    setAppRole(role);
    router.push(path);
  };

  const scrollToFeatures = () => {
    document.getElementById("features")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="bg-black text-white font-sans selection:bg-white selection:text-black">
      <RoleWarningModal
        isOpen={isWarningOpen}
        onClose={() => setIsWarningOpen(false)}
        onProceed={() => {
          if (pendingRoute) {
            setAppRole(pendingRoute.role);
            router.push(pendingRoute.path);
          }
          setIsWarningOpen(false);
        }}
        onDisconnect={() => {
          disconnect();
          setIsWarningOpen(false);
        }}
        targetRole={pendingRoute?.targetRoleStr || "Buyer"}
      />

      <main>
        {/* First Screen: Hero */}
        <section className="relative h-[100svh] flex flex-col items-center justify-center px-6 mx-auto max-w-7xl">
          <div className="text-center w-full flex flex-col items-center mt-[-10svh]">
            <h1 className="text-5xl lg:text-[7.5rem] font-[800] tracking-tighter text-white whitespace-nowrap leading-none mb-4">
              Synapse Network
            </h1>
            <p className="mt-6 text-xl md:text-3xl text-[#86868b] font-medium tracking-tight whitespace-nowrap">
              链接硅基生命的 API 结算中枢
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-6 mt-16 md:mt-24 z-10">
            <button
              onClick={() => handleEnterRole('CONSUMER', '/dashboard/buyer')}
              className="px-10 py-4 bg-white text-black rounded-full font-semibold text-lg hover:bg-gray-200 transition-colors shadow-[0_0_40px_rgba(255,255,255,0.1)]"
            >
              买家接入 (Buyer)
            </button>
            <button
              onClick={() => handleEnterRole('PROVIDER', '/dashboard/sell')}
              className="px-10 py-4 bg-transparent text-white border border-[#424245] rounded-full font-semibold text-lg hover:bg-[#1d1d1f] hover:border-white transition-colors"
            >
              卖家控制台 (Provider)
            </button>
          </div>

          {/* Scroll Indicator */}
          <div 
            className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center opacity-40 hover:opacity-100 transition-opacity cursor-pointer animate-bounce"
            onClick={scrollToFeatures}
          >
            <span className="text-[10px] text-[#86868b] tracking-[0.2em] mb-2 font-medium uppercase">EXPLORE</span>
            <ChevronDown className="w-5 h-5 text-[#86868b]" />
          </div>
        </section>

        {/* Second Screen: Features */}
        <section id="features" className="min-h-[100svh] bg-black flex flex-col items-center justify-center px-6 py-24 mx-auto max-w-7xl relative">
          
          <div className="w-full max-w-6xl mx-auto mb-16 text-center">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tighter mb-6 text-white">架构级的新一代底座</h2>
          </div>

          {/* Feature Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-6xl mx-auto">
            {/* Card 1 */}
            <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2rem] p-8 md:p-10 hover:bg-[#111111] hover:border-[#444444] transition-all duration-300">
              <ShieldCheck className="w-8 h-8 text-white mb-6" />
              <h3 className="text-xl md:text-2xl font-semibold mb-4 text-white tracking-tight">资金安全</h3>
              <p className="text-[#86868b] leading-relaxed text-sm md:text-base font-medium">
                买家先充值到智能合约 Vault，资金由链上规则严格担保，彻底抛弃单点托管账户的固有风险。
              </p>
            </div>

            {/* Card 2 */}
            <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2rem] p-8 md:p-10 hover:bg-[#111111] hover:border-[#444444] transition-all duration-300">
              <Zap className="w-8 h-8 text-white mb-6" />
              <h3 className="text-xl md:text-2xl font-semibold mb-4 text-white tracking-tight">高频低延迟</h3>
              <p className="text-[#86868b] leading-relaxed text-sm md:text-base font-medium">
                所有 API 调用走平台 Gateway 离链原子扣费，无需逐笔上链，完美适配 Agent 的毫秒级高频扫货。
              </p>
            </div>

            {/* Card 3 */}
            <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2rem] p-8 md:p-10 hover:bg-[#111111] hover:border-[#444444] transition-all duration-300">
              <ReceiptText className="w-8 h-8 text-white mb-6" />
              <h3 className="text-xl md:text-2xl font-semibold mb-4 text-white tracking-tight">费用透明</h3>
              <p className="text-[#86868b] leading-relaxed text-sm md:text-base font-medium">
                每笔调用实时展示扣费拆分：平台抽成、卖家净收入、剩余余额。账单级可审计，可自动对账。
              </p>
            </div>
          </div>

          {/* Explicit Explanation Text Moved Below Cards */}
          <div className="mx-auto max-w-4xl mt-24 text-center">
            <p className="text-lg md:text-2xl text-[#86868b] leading-relaxed tracking-wide font-medium">
              我们是面向 AI Agent 的支付与结算基础设施：<br className="hidden md:block"/>让买家 Agent 可以安全调用他人 API，让卖家 API 可以按调用自动收款。
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
