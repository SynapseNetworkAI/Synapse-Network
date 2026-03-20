"use client";

import Link from "next/link";
import { useAccount, useReadContract } from "wagmi";
import { ethers } from "ethers";
import { ArrowRight, ShieldCheck, CreditCard, Activity } from "lucide-react";
import contractConfig from "@/contract-config.json";
import MockUSDCABI from "@/MockUSDCABI.json";

export default function BuyPage() {
  const { address: userAddress } = useAccount();
  

  // Read USDC balance
  const { data: balanceData } = useReadContract({
    address: contractConfig.MockUSDC as `0x${string}`,
    abi: MockUSDCABI,
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: {
         enabled: !!userAddress
    }
  });

  const displayBalance = balanceData 
    ? Number.parseFloat(ethers.formatUnits(balanceData as bigint, 18)).toFixed(2)
    : "0.00";

  return (
    <div className="max-w-6xl p-8 mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Buy Workspace</h1>
        <p className="mt-2 text-gray-400">
          面向调用方：总钱包充值担保，签发 API Key 凭据，调用卖家服务共享全局消费流水。
        </p>
      </div>

      {/* Global Section: Fund & Balances */}
      <section className="p-6 space-y-4 transition border border-gray-800 shadow-lg rounded-xl bg-black/40 shadow-yellow-500/5 hover:border-gray-700">
        <div className="flex items-center justify-between pb-4 border-b border-gray-800">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/10">
                <CreditCard className="w-6 h-6 text-yellow-500" />
              </div>
              <h2 className="text-xl font-bold tracking-wide text-white">Step 1 · 充值担保 (全局资金池)</h2>
            </div>
            <Link href="/dashboard/billing" className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-black transition-colors bg-yellow-500 rounded-lg hover:bg-yellow-400">
              打开 Owner Treasury <ArrowRight className="w-4 h-4" />
            </Link>
        </div>

        <div className="flex items-center justify-between pt-2">
            <div>
              <p className="text-sm font-medium tracking-widest text-gray-400 uppercase">全局钱包地址 (Owner)</p>
              <p className="mt-1 font-mono text-lg text-gray-200">
                {userAddress ? `${userAddress.slice(0, 8)}...${userAddress.slice(-6)}` : "未连接钱包"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium tracking-widest text-gray-400 uppercase">可用资金池余额 (USDC)</p>
              <p className="mt-1 font-mono text-4xl font-bold tracking-tight text-yellow-500">
                {userAddress ? displayBalance : "--"}
              </p>
            </div>
        </div>
      </section>

      {/* Local Section: Credentials */}
      <section className="p-6 space-y-4 transition border border-gray-800 rounded-xl bg-[#0f1115] hover:border-green-500/50 hover:shadow-lg hover:shadow-green-500/5">
        <div className="flex items-center justify-between pb-4 border-b border-gray-800/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10">
              <ShieldCheck className="w-6 h-6 text-green-500" />
            </div>
            <h2 className="text-xl font-bold tracking-wide text-white">Step 2 · 凭据管理 (API Keys)</h2>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/credentials" className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-green-400 transition border rounded-lg border-green-400/30 bg-green-500/10 hover:bg-green-500/20">
              管理 API Keys <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
        
        <div className="mt-4">
          <p className="text-sm leading-relaxed text-gray-400">
            API Key 就是基础设施中执行调用的唯一凭证，代表你发起对目标服务的访问。所有该钱包下持有的 API Key 创建的消费将会自动汇总在当前资金池中。
          </p>
          <div className="mt-6 flex flex-col gap-2.5">
            <Link href="/dashboard/discovery" className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2.5 text-sm font-semibold text-gray-300 bg-gray-800 rounded-lg hover:bg-gray-700 hover:text-white transition-colors border border-transparent hover:border-gray-600">
              发现并调用 API <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </div>
        </div>
      </section>

      {/* Billing Section */}
      <section className="p-6 mt-8 space-y-4 transition border border-gray-800 rounded-xl bg-black/40 hover:border-gray-700">
        <div className="flex items-center justify-between pb-4 border-b border-gray-800">
            <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <Activity className="w-6 h-6 text-blue-500" />
                </div>
                <h2 className="text-xl font-bold tracking-wide text-white">Step 3 · 费用核对 (Owner Treasury)</h2>
            </div>
            <Link href="/dashboard/billing" className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white transition bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700">
                打开资金账本 <ArrowRight className="w-4 h-4" />
            </Link>
        </div>
        <p className="max-w-4xl mt-2 text-sm leading-relaxed text-gray-400">
          所有执行单元使用的 API Key 调用产生的扣费账单，最终都会汇聚在 Owner 总钱包下统一展现与核销。在 Owner Treasury 里你可以查看、导出完整的聚合交易流水。
        </p>
      </section>
    </div>
  );
}