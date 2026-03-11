"use client";

import Link from "next/link";
import { Bot, RefreshCw, Zap, Shield, ArrowRight, ArrowUpRight, ArrowDownToLine, Coins } from "lucide-react";
import toast from "react-hot-toast";
import WalletProfileBadge from "@/components/WalletProfileBadge";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useAuth } from "@/components/WalletAuthGuard";

export default function BuyerOverview() {
  const { handleRefresh: hookRefresh, isRefreshing } = useDashboardData();
  const { isSessionAuthenticated } = useAuth();

  // Mock data for buyer specific metrics
  const stats = isSessionAuthenticated ? {
    todaySpend: "12.45",
    todayCalls: 1245,
    blockedCalls: 2
  } : {
    todaySpend: "0.00",
    todayCalls: 0,
    blockedCalls: 0
  };

  const logs = isSessionAuthenticated ? [
    { id: "REQ-001", time: "2026-03-11 10:23:45", service: "OpenAI GPT-4 Wrapper", endpoint: "POST /api/v1/query", cost: "0.01", status: "Success" },
    { id: "REQ-002", time: "2026-03-11 10:24:12", service: "Data Scraper Agent", endpoint: "GET /api/v1/scrape", cost: "0.05", status: "Success" },
    { id: "REQ-003", time: "2026-03-11 10:25:01", service: "Stable Diffusion Gen", endpoint: "POST /api/v1/image", cost: "0.00", status: "Failed" },
  ] : [];

  return (
    <div className="p-8 mx-auto space-y-8 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-gray-800">
        <div>
          <h1 className="flex items-center text-3xl font-bold text-white">
            <Bot className="mr-3 text-blue-400" />
            Buyer Console
          </h1>
          <p className="mt-2 text-gray-400">Manage your API Keys, track spending, and review your API call logs.</p>
        </div>
        <div className="flex gap-4">
          <WalletProfileBadge />
          <button
            onClick={hookRefresh}
            className="p-2 text-gray-300 transition-colors bg-gray-900 border border-gray-700 rounded-lg hover:bg-gray-800"
          >
            <RefreshCw className={`w-5 h-5 ${isRefreshing ? "animate-spin text-blue-400" : ""}`} />
          </button>
        </div>
      </div>

      {/* Hero Section */}
      <section className="p-6 border border-gray-800 rounded-xl bg-black/40">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-white mb-2">What is Synapse?</h2>
          <p className="text-gray-400 leading-relaxed max-w-3xl">
            Synapse Network 致力于为 AI Agent 之间的交互提供无缝、低延迟的加密支付基础设施。这里是买家的专属控制台。
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="p-4 rounded-lg bg-gray-900/50 border border-gray-800">
            <Zap className="w-6 h-6 text-blue-400 mb-2" />
            <h3 className="font-semibold text-gray-200 mb-1">API 聚合与发现</h3>
            <p className="text-sm text-gray-500">快速发现全网优质的 Agent 接口服务。</p>
          </div>
          <div className="p-4 rounded-lg bg-gray-900/50 border border-gray-800">
            <Coins className="w-6 h-6 text-yellow-400 mb-2" />
            <h3 className="font-semibold text-gray-200 mb-1">按需付费 (Pay-As-You-Go)</h3>
            <p className="text-sm text-gray-500">抛弃高昂的包月订阅，依据实际 API 调用次数精确计费（USDC 等稳定币）。</p>
          </div>
          <div className="p-4 rounded-lg bg-gray-900/50 border border-gray-800">
            <Shield className="w-6 h-6 text-green-400 mb-2" />
            <h3 className="font-semibold text-gray-200 mb-1">极速 0 Gas</h3>
            <p className="text-sm text-gray-500">采用“链上充值 + 离链网关秒扣”架构，零 Gas 且亚毫秒级延迟。</p>
          </div>
        </div>
        <div className="flex justify-end border-t border-gray-800 pt-5">
          <Link href="/dashboard/console" className="flex items-center px-6 py-3 font-bold text-black transition-colors bg-blue-500 rounded-lg hover:bg-blue-600">
            如何接入 / 获取 API Key
            <ArrowRight className="w-5 h-5 ml-2" />
          </Link>
        </div>
      </section>

      <div className="space-y-8">
        {/* Data Dashboard */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="p-6 bg-gray-900 border border-gray-800 rounded-xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-blue-900/20 opacity-0 group-hover:opacity-100 transition-opacity" />
          <h3 className="text-gray-400 text-sm font-medium mb-2">Account Balance</h3>
          <div className="flex flex-col gap-2">
            <div className="text-3xl font-bold text-white"><span className="text-lg text-gray-500">USDC</span></div>
            <Link href="/dashboard/console" className="text-blue-400 hover:text-blue-300 flex items-center text-sm font-medium w-fit">
              Deposit <ArrowUpRight className="w-4 h-4 ml-1" />
            </Link>
          </div>
        </div>
        
        <div className="p-6 bg-gray-900 border border-gray-800 rounded-xl">
          <h3 className="text-gray-400 text-sm font-medium mb-2">Today&apos;s Spend</h3>
          <div className="text-3xl font-bold text-white">{stats.todaySpend} <span className="text-lg text-gray-500">USDC</span></div>
        </div>

        <div className="p-6 bg-gray-900 border border-gray-800 rounded-xl">
          <h3 className="text-gray-400 text-sm font-medium mb-2">Today&apos;s API Calls</h3>
          <div className="text-3xl font-bold text-white">{stats.todayCalls}</div>
        </div>

        <div className="p-6 bg-gray-900 border border-gray-800 rounded-xl">
          <h3 className="text-gray-400 text-sm font-medium mb-2">Blocked / Failed</h3>
          <div className="text-3xl font-bold text-red-400">{stats.blockedCalls}</div>
        </div>
      </div>

      {/* Refunds & Settlement */}
      <section className="p-6 border border-gray-800 rounded-xl bg-gray-900/50 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex-1">
          <h2 className="text-xl font-bold text-white mb-2 flex items-center">
            <ArrowDownToLine className="w-5 h-5 mr-2 text-green-400" />
            资金与退款说明 (Refunds & Settlement)
          </h2>
          <p className="text-gray-400 text-sm leading-relaxed max-w-4xl">
            如果您不需要继续调用接口，可随时向平台发起退款请求。平台将清算离链账本，并为您开出一张“赛博银票 (EIP-712 签名)”。您可以凭借这张银票，在链上金库一键提取剩余资金至原生钱包。
          </p>
        </div>
        <button 
          onClick={() => toast.success("Mock: Generating EIP-712 Refund Signature...")}
          className="whitespace-nowrap px-6 py-3 font-bold text-green-400 transition-colors border border-green-500/50 rounded-lg hover:bg-green-500/10"
        >
          申请退款提取 (Claim Refund)
        </button>
      </section>

      {/* Logs Table */}
      <section className="p-6 border border-gray-800 rounded-xl bg-black/40">
        <h2 className="text-xl font-bold text-white mb-4">调用日志 (Activity & Call Logs)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-800 text-sm text-gray-400">
                <th className="py-3 px-4 font-medium">Timestamp</th>
                <th className="py-3 px-4 font-medium">Service Name</th>
                <th className="py-3 px-4 font-medium">Endpoint</th>
                <th className="py-3 px-4 font-medium">Cost</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium">Request ID</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-gray-500">
                    {!isSessionAuthenticated ? "暂无数据，请连接钱包并登录后查看您的日志" : "当前没有任何调用记录"}
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors">
                    <td className="py-3 px-4 text-sm text-gray-300">{log.time}</td>
                    <td className="py-3 px-4 text-sm font-medium text-gray-200">{log.service}</td>
                    <td className="py-3 px-4 text-sm text-gray-400 font-mono">{log.endpoint}</td>
                    <td className="py-3 px-4 text-sm text-yellow-400">{log.cost} USDC</td>
                    <td className="py-3 px-4 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs ${log.status === "Success" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-500 font-mono">{log.id}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      </div>
    </div>
  );
}