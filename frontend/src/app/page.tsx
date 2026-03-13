"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setAppRole } from "@/utils/roleStore";
import { ShieldCheck, Zap, ReceiptText } from "lucide-react";
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

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-white selection:text-black">
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

      <main className="flex flex-col items-center justify-center px-6 pt-32 pb-24 md:pt-48 md:pb-32 mx-auto max-w-7xl">
        {/* Hero Section */}
        <div className="text-center w-full flex flex-col items-center">
          <h1 className="text-5xl lg:text-[7.5rem] font-[800] tracking-tighter text-white whitespace-nowrap leading-none mb-4">
            Synapse Network
          </h1>
          <p className="mt-6 text-xl md:text-3xl text-[#86868b] font-medium tracking-tight whitespace-nowrap">
            链接硅基生命的 API 结算中枢
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-6 mt-16 md:mt-24">
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

        {/* Feature Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-32 w-full max-w-6xl mx-auto">
          {/* Card 1 */}
          <div className="bg-[#1d1d1f]/50 border border-[#424245]/50 rounded-[2rem] p-8 md:p-10 backdrop-blur-xl hover:bg-[#1d1d1f] hover:border-[#86868b]/50 transition-all duration-300">
            <ShieldCheck className="w-10 h-10 text-white mb-6" />
            <h3 className="text-2xl font-semibold mb-4 text-white tracking-tight">资金安全</h3>
            <p className="text-[#86868b] leading-relaxed text-base md:text-lg">
              买家先充值到智能合约 Vault，资金有链上担保，不依赖单点托管账户。
            </p>
          </div>

          {/* Card 2 */}
          <div className="bg-[#1d1d1f]/50 border border-[#424245]/50 rounded-[2rem] p-8 md:p-10 backdrop-blur-xl hover:bg-[#1d1d1f] hover:border-[#86868b]/50 transition-all duration-300">
            <Zap className="w-10 h-10 text-white mb-6" />
            <h3 className="text-2xl font-semibold mb-4 text-white tracking-tight">高频低延迟</h3>
            <p className="text-[#86868b] leading-relaxed text-base md:text-lg">
              调用走平台 Gateway 离链原子扣费，不必逐笔上链，适配 Agent 高频调用场景。
            </p>
          </div>

          {/* Card 3 */}
          <div className="bg-[#1d1d1f]/50 border border-[#424245]/50 rounded-[2rem] p-8 md:p-10 backdrop-blur-xl hover:bg-[#1d1d1f] hover:border-[#86868b]/50 transition-all duration-300">
            <ReceiptText className="w-10 h-10 text-white mb-6" />
            <h3 className="text-2xl font-semibold mb-4 text-white tracking-tight">费用透明</h3>
            <p className="text-[#86868b] leading-relaxed text-base md:text-lg">
              每笔调用都展示扣费拆分：平台费、卖家净收入、剩余余额，账单可审计可对账。
            </p>
          </div>
        </div>

        {/* Explicit Explanation Text Moved Below Cards */}
        <div className="mx-auto max-w-4xl mt-24 text-center pb-12">
          <p className="text-lg md:text-2xl text-[#86868b] leading-relaxed tracking-wide font-medium">
            我们是面向 AI Agent 的支付与结算基础设施：<br className="hidden md:block"/>让买家 Agent 可以安全调用他人 API，让卖家 API 可以按调用自动收款。
          </p>
        </div>
      </main>
    </div>
  );
}
