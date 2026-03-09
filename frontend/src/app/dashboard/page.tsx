"use client";

import Link from "next/link";
import { Bot, RefreshCw, LogOut } from "lucide-react";
import toast from "react-hot-toast";
import OverviewHero from "@/components/dashboard/overview/OverviewHero";
import CapabilityCards from "@/components/dashboard/overview/CapabilityCards";
import RolePathCards from "@/components/dashboard/overview/RolePathCards";
import FeeTransparencyPanel from "@/components/dashboard/overview/FeeTransparencyPanel";
import TreasurySection from "@/components/dashboard/overview/TreasurySection";
import AnalyticsCards from "@/components/dashboard/overview/AnalyticsCards";
import AgentTablePanel from "@/components/dashboard/overview/AgentTablePanel";
import ServiceGrid from "@/components/dashboard/overview/ServiceGrid";
import EventStreamTable from "@/components/dashboard/overview/EventStreamTable";
import { useDashboardData } from "@/hooks/useDashboardData";

export default function Dashboard() {
  const {
    userAddress,
    services,
    ownerAgents,
    isRefreshing,
    masterBalance,
    serviceBalances,
    serviceWalletTotal,
    agentUsdcBalances,
    agentEthBalances,
    agentFlowStats,
    copiedAgentId,
    paidEvents,
    providerStats,
    platformFeeRatePercent,
    copyAgentAddress,
    handleRefresh,
    handleLogout,
  } = useDashboardData();

  return (
    <div className="p-8 mx-auto space-y-8 max-w-7xl">
      <div className="flex items-center justify-between pb-4 border-b border-gray-800">
        <div>
          <h1 className="flex items-center text-3xl font-bold text-white">
            <Bot className="mr-3 text-green-400" />
            AgentPay Overview
          </h1>
          <p className="mt-2 text-gray-400">先看懂平台能力，再选择买家调用或卖家接入路径。</p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={handleRefresh}
            className="p-2 text-gray-300 transition-colors bg-gray-900 border border-gray-700 rounded-lg hover:bg-gray-800"
            title="Refresh Provider Metrics"
          >
            <RefreshCw className={`w-5 h-5 ${isRefreshing ? "animate-spin text-green-400" : ""}`} />
          </button>
          <Link href="/dashboard/services" className="flex items-center px-6 py-2 font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-600">
            Server Management
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center px-4 py-2 font-bold text-red-400 transition-colors border rounded-lg border-red-500/50 hover:bg-red-500/10"
            title="Disconnect Terminal"
          >
            <LogOut className="w-5 h-5 mr-2" />
            Logout
          </button>
        </div>
      </div>

      <section className="p-6 border border-gray-800 rounded-xl bg-black/40">
        <OverviewHero />
        <CapabilityCards />
        <RolePathCards />
        <FeeTransparencyPanel
          masterBalance={masterBalance}
          sellerNetTotal={providerStats.netEarned}
          platformFeesTotal={providerStats.totalFees}
          platformFeeRatePercent={platformFeeRatePercent}
        />
      </section>

      <TreasurySection masterBalance={masterBalance} userAddress={userAddress} />

      <AnalyticsCards
        servicesCount={services.length}
        serviceWalletTotal={serviceWalletTotal}
        totalEarned={providerStats.totalEarned}
        totalFees={providerStats.totalFees}
        paidCount24h={providerStats.paidCount24h}
      />

      <div id="service-market" />
      {services.length === 0 ? (
        <AgentTablePanel
          ownerAgents={ownerAgents}
          agentFlowStats={agentFlowStats}
          agentUsdcBalances={agentUsdcBalances}
          agentEthBalances={agentEthBalances}
          copiedAgentId={copiedAgentId}
          onCopyAddress={copyAgentAddress}
        />
      ) : (
        <ServiceGrid
          services={services}
          serviceBalances={serviceBalances}
          onFundService={() => toast.success("Mock: Funding seller wallet from provider wallet...")}
          onSweepService={(serviceName) => toast.success(`Mock: Sweeping USDC from ${serviceName} to provider wallet.`)}
        />
      )}

      <EventStreamTable paidEvents={paidEvents} />
    </div>
  );
}
