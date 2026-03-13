"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setAppRole, getAppRole, clearAppRole } from "@/utils/roleStore";
import { ArrowRight, ShieldCheck, Zap, Wallet, Bot, Store, ReceiptText, TerminalSquare } from "lucide-react";
import { useAccount, useDisconnect } from "wagmi";
import { getWalletRole, bindWalletRole } from "@/utils/serviceApi";
import RoleWarningModal from "@/components/RoleWarningModal";

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
      // 1. Check strict DB-level WalletRole registry
      const backendRole = await getWalletRole(address);
      if (backendRole && backendRole !== role) {
          setPendingRoute({ role, path, targetRoleStr: role === 'CONSUMER' ? "Buyer" : "Seller" });
          setIsWarningOpen(true);
          return;
      }

      // 2. Check local frontend session (if they logged in but haven't taken action yet)
      const cachedRole = getAppRole(address);
      if (cachedRole && cachedRole !== role && cachedRole !== 'ADMIN') {
        setPendingRoute({ role, path, targetRoleStr: role === 'CONSUMER' ? "Buyer" : "Seller" });
        setIsWarningOpen(true);
        return;
      }

      // 3. Bind explicitly in DB if they don't have a role yet
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
    <div className="mx-auto max-w-7xl px-6 md:px-8 py-10 space-y-16">
      <RoleWarningModal
        isOpen={isWarningOpen}
        onDisconnect={handleDisconnectWarning}
        targetRole={pendingRoute?.targetRoleStr || "Seller"}
      />
      <section className="max-w-4xl space-y-6">
        <p className="uppercase tracking-[0.2em] text-xs text-green-300">Synapse Network</p>
        <h1 className="text-4xl md:text-6xl font-black leading-tight bg-clip-text text-transparent bg-gradient-to-r from-green-400 to-emerald-700">
          Synapse：链接硅基生命的 API 结算中枢。
        </h1>
        <p className="text-lg text-gray-300 leading-8 max-w-3xl">
          我们是面向 AI Agent 的支付与结算基础设施：让买家 Agent 可以安全调用他人 API，让卖家 API 可以按调用自动收款。
          通过链上充值担保 + 链下网关扣费 + 链上结算提现，兼顾资金安全与高频低延迟。
        </p>
        <div className="flex flex-wrap gap-4 mt-8">
          <button 
            onClick={() => handleEnterRole('CONSUMER', '/dashboard/buyer')}
            className="min-w-[160px] inline-flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 text-black px-6 py-4 rounded-xl font-bold text-sm transition-all hover:scale-105 shadow-[0_0_15px_rgba(34,197,94,0.4)]"
          >
            买家接入 (Consumer)
            <ArrowRight className="w-4 h-4 ml-1" />
          </button>
          
          <button 
            onClick={() => handleEnterRole('PROVIDER', '/dashboard/sell')}
            className="min-w-[160px] inline-flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-400 text-black px-6 py-4 rounded-xl font-bold text-sm transition-all hover:scale-105 shadow-[0_0_15px_rgba(59,130,246,0.4)]"
          >
            卖家接入 (Provider)
            <ArrowRight className="w-4 h-4 ml-1" />
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-black/40 border border-gray-800 p-5 rounded-xl">
          <ShieldCheck className="w-6 h-6 text-green-400 mb-3" />
          <h2 className="text-lg font-bold text-white">资金安全</h2>
          <p className="text-gray-400 text-sm mt-2 leading-6">买家先充值到智能合约 Vault，资金有链上担保，不依赖单点托管账户。</p>
        </div>
        <div className="bg-black/40 border border-gray-800 p-5 rounded-xl">
          <Zap className="w-6 h-6 text-yellow-400 mb-3" />
          <h2 className="text-lg font-bold text-white">高频低延迟</h2>
          <p className="text-gray-400 text-sm mt-2 leading-6">调用走平台 Gateway 离链原子扣费，不必逐笔上链，适配 Agent 高频调用场景。</p>
        </div>
        <div className="bg-black/40 border border-gray-800 p-5 rounded-xl">
          <ReceiptText className="w-6 h-6 text-blue-400 mb-3" />
          <h2 className="text-lg font-bold text-white">费用透明</h2>
          <p className="text-gray-400 text-sm mt-2 leading-6">每笔调用都展示扣费拆分：平台费、卖家净收入、剩余余额，账单可审计可对账。</p>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-black/40 border border-gray-800 p-6 rounded-xl">
          <div className="flex items-center gap-2 mb-3">
            <Bot className="w-5 h-5 text-green-400" />
            <h3 className="text-xl font-bold text-white">买家 / 调用方：如何接入与调用</h3>
          </div>
          <ol className="list-decimal list-inside text-sm text-gray-300 space-y-2 leading-6">
            <li>选择买家身份，连接钱包并完成签名登录</li>
            <li>充值 USDC 到智能合约（Deposit 担保）</li>
            <li>签发 \`X-Agent-Credential\` 给你的 Agent</li>
            <li>调用卖家 API（通过平台网关转发）</li>
            <li>查看每笔消费、余额与扣费明细</li>
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => handleEnterRole('CONSUMER', '/dashboard/buyer')} className="bg-yellow-500 hover:bg-yellow-400 text-black px-4 py-2 rounded-lg font-bold text-xs transition-colors">快速充值</button>
              <button onClick={() => handleEnterRole('CONSUMER', '/dashboard/buyer')} className="bg-green-500 hover:bg-green-400 text-black px-4 py-2 rounded-lg font-bold text-xs transition-colors">获取 API Key</button>
          </div>
        </div>

        <div className="bg-black/40 border border-gray-800 p-6 rounded-xl">
          <div className="flex items-center gap-2 mb-3">
            <Store className="w-5 h-5 text-emerald-400" />
            <h3 className="text-xl font-bold text-white">卖家 / 服务方：如何提供接口并赚收益</h3>
          </div>
          <ol className="list-decimal list-inside text-sm text-gray-300 space-y-2 leading-6">
            <li>选择卖家身份，连接钱包并完成签名登录</li>
            <li>注册 Agent 与 Service（配置 \`endpoint + unit_price\`）</li>
            <li>平台 Gateway 接入并转发买家调用</li>
            <li>调用成功后自动分账，累计 \`seller_net\`</li>
            <li>在结算页面发起提现（链上 claim）</li>
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => handleEnterRole('PROVIDER', '/dashboard/sell')} className="bg-blue-500 hover:bg-blue-400 text-black px-4 py-2 rounded-lg font-bold text-xs transition-colors">去注册服务</button>
            <button onClick={() => handleEnterRole('PROVIDER', '/dashboard/settlement')} className="border border-gray-700 hover:bg-gray-900 text-white px-4 py-2 rounded-lg font-semibold text-xs transition-colors">查看收益看板</button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-black/40 border border-gray-800 p-5 rounded-xl">
          <Wallet className="w-5 h-5 text-yellow-400 mb-3" />
          <h4 className="text-white font-semibold">充值与担保</h4>
          <p className="text-gray-400 text-sm mt-2 leading-6">买家充值先进入智能合约金库，形成可消费额度；未确认的充值不进入可消费余额。</p>
        </div>
        <div className="bg-black/40 border border-gray-800 p-5 rounded-xl">
          <h4 className="text-white font-semibold">扣费机制</h4>
          <p className="text-gray-300 font-mono text-xs mt-2">platform_fee = unit_price × fee_rate</p>
          <p className="text-gray-300 font-mono text-xs mt-1">seller_net = unit_price - platform_fee</p>
          <p className="text-gray-400 text-sm mt-2 leading-6">调用失败按策略回滚，调用成功固化账务，保证扣费可追踪。</p>
        </div>
          <button onClick={() => handleEnterRole('CONSUMER', '/dashboard/buyer')} className="bg-black/40 border border-green-900/50 hover:bg-green-900/20 transition-colors p-5 rounded-xl block text-left">
          <TerminalSquare className="w-8 h-8 text-green-500 mb-3" />
          <h4 className="text-lg font-bold text-white">Developer Console</h4>
          <p className="text-gray-400 text-sm mt-2 leading-6">统一管理服务、凭据、调用、收益与结算，作为买卖双方的操作中枢。</p>
        </button>
      </section>
    </div>
  );
}
