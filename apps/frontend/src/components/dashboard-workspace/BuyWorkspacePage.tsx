"use client";

import Link from "next/link";
import { useAccount, useReadContract } from "wagmi";
import { ethers } from "ethers";
import { ArrowRight, ShieldCheck, CreditCard, Activity } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import contractConfig from "@/contract-config.json";
import MockUSDCABI from "@/MockUSDCABI.json";

export default function BuyPage() {
  const { t } = useLanguage();
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
        <h1 className="text-3xl font-bold text-white">{t("buyPage.title")}</h1>
        <p className="mt-2 text-gray-400">
          {t("buyPage.description")}
        </p>
      </div>

      {/* Global Section: Fund & Balances */}
      <section className="p-6 space-y-4 transition border border-gray-800 shadow-lg rounded-xl bg-black/40 shadow-yellow-500/5 hover:border-gray-700">
        <div className="flex items-center justify-between pb-4 border-b border-gray-800">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/10">
                <CreditCard className="w-6 h-6 text-yellow-500" />
              </div>
              <h2 className="text-xl font-bold tracking-wide text-white">{t("buyPage.step1Title")}</h2>
            </div>
            <Link href="/dashboard/billing" className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-black transition-colors bg-yellow-500 rounded-lg hover:bg-yellow-400">
              {t("buyPage.step1Action")} <ArrowRight className="w-4 h-4" />
            </Link>
        </div>

        <div className="flex items-center justify-between pt-2">
            <div>
              <p className="text-sm font-medium tracking-widest text-gray-400 uppercase">{t("buyPage.ownerWalletLabel")}</p>
              <p className="mt-1 font-mono text-lg text-gray-200">
                {userAddress ? `${userAddress.slice(0, 8)}...${userAddress.slice(-6)}` : t("buyPage.ownerWalletDisconnected")}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium tracking-widest text-gray-400 uppercase">{t("buyPage.poolBalanceLabel")}</p>
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
            <h2 className="text-xl font-bold tracking-wide text-white">{t("buyPage.step2Title")}</h2>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/credentials" className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-green-400 transition border rounded-lg border-green-400/30 bg-green-500/10 hover:bg-green-500/20">
              {t("buyPage.step2Action")} <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
        
        <div className="mt-4">
          <p className="text-sm leading-relaxed text-gray-400">
            {t("buyPage.step2Description")}
          </p>
          <div className="mt-6 flex flex-col gap-2.5">
            <Link href="/dashboard/discovery" className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2.5 text-sm font-semibold text-gray-300 bg-gray-800 rounded-lg hover:bg-gray-700 hover:text-white transition-colors border border-transparent hover:border-gray-600">
              {t("buyPage.step2DiscoveryAction")} <ArrowRight className="w-4 h-4 ml-2" />
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
                <h2 className="text-xl font-bold tracking-wide text-white">{t("buyPage.step3Title")}</h2>
            </div>
            <Link href="/dashboard/billing" className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white transition bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700">
                {t("buyPage.step3Action")} <ArrowRight className="w-4 h-4" />
            </Link>
        </div>
        <p className="max-w-4xl mt-2 text-sm leading-relaxed text-gray-400">
          {t("buyPage.step3Description")}
        </p>
      </section>
    </div>
  );
}