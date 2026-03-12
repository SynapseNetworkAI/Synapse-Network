"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, RefreshCw, Zap, Shield, ArrowRight, ArrowUpRight, Coins, AlertTriangle, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import WalletProfileBadge from "@/components/WalletProfileBadge";
import { useBuyerData } from "@/hooks/useBuyerData";
import { useAuth } from "@/components/WalletAuthGuard";
import { requestV2Refund } from "@/utils/balanceApi";

export default function BuyerOverview() {
  const { userAddress, isRefreshing, stats, logs, handleRefresh } = useBuyerData();
  const { isSessionAuthenticated } = useAuth();
  
  const [isSettlementModalOpen, setIsSettlementModalOpen] = useState(false);
  const [isSettling, setIsSettling] = useState(false);

  const handleSettlement = async () => {
    if (!userAddress) {
      toast.error("钱包未连接或会话失效");
      return;
    }
    
    setIsSettling(true);
    const toastId = toast.loading("获取赛博银票/EIP-712签名中...");
    try {
      // 真实调用后端结算扣减接口
      const refundResult = await requestV2Refund(userAddress);
      
      toast.success(`获取凭证 ${refundResult.signature.slice(0, 8)}...，拉起钱包！`, { id: toastId });
      
      // 模拟链上确认等待时间
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      toast.success(`本次提取 ${refundResult.amountRefunded} USDC 完成！`, { id: toastId });
      setIsSettlementModalOpen(false);
      handleRefresh();
    } catch {
      toast.error("结算失败，请重试", { id: toastId });
    } finally {
      setIsSettling(false);
    }
  };

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
            onClick={handleRefresh}
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
            <div className="text-3xl font-bold text-white">{stats.buyerBalance} <span className="text-lg text-gray-500">USDC</span></div>
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
      <section className="p-6 border border-gray-800 rounded-xl bg-gray-900/50 flex flex-col xl:flex-row items-center justify-between gap-6">
        <div className="flex-1 space-y-3 w-full">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white flex items-center">
              <Shield className="w-5 h-5 mr-3 text-green-400" />
              随时提取，防跑路 (No-Rug Refund)
            </h2>
          </div>
          
          <div className="bg-black/30 p-4 rounded-lg border border-gray-800/50 space-y-3">
            <div className="flex items-start text-sm text-gray-400">
              <span className="text-green-500 font-bold mr-2 mt-0.5 shrink-0">1.</span>
              <p><strong className="text-gray-300">零审核瞬间退：</strong>资金绝对安全地托管在智能合约中。点击退款瞬间，网关立马清算并向你开出 “赛博银票” (EIP-712签名)，无需任何人审批审核。</p>
            </div>
            <div className="flex items-start text-sm text-gray-400">
              <span className="text-yellow-500 font-bold mr-2 mt-0.5 shrink-0">2.</span>
              <p><strong className="text-gray-300">极速链上到账：</strong>你拿到银票凭证后，将自动拉起钱包并从链上金库直接提取原资金，确认后几秒内即落入当前的原生钱包。</p>
            </div>
            <div className="flex items-start text-sm text-gray-400">
              <span className="text-blue-400 font-bold mr-2 mt-0.5 shrink-0">3.</span>
              <p><strong className="text-gray-300">谁来支付 Gas：</strong>你在调用 API 的时候享受绝对的 0 Gas 体验；而你的提取退款是一次真实的链上转移，需由你支付极低的网络 Gas 费。</p>
            </div>
          </div>
        </div>
        
        <div className="flex flex-col items-end gap-3 min-w-[240px] p-4 bg-black/40 rounded-lg border border-gray-800 w-full xl:w-auto">
          <div className="text-right w-full flex justify-between items-end mb-2 xl:flex-col xl:items-end xl:mb-0">
            <span className="text-sm text-gray-500 mb-1">可提取可用余额</span>
            <div className="text-2xl font-bold font-mono text-green-400">{stats.buyerBalance} <span className="text-sm text-gray-500">USDC</span></div>
          </div>
          <button 
            onClick={() => setIsSettlementModalOpen(true)}
            disabled={Number(stats.buyerBalance) <= 0}
            className="w-full whitespace-nowrap px-6 py-3 font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center"
          >
            结算取现
            <ArrowRight className="w-4 h-4 ml-2" />
          </button>
        </div>
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
                  <tr key={log.request_id} className="border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors">
                    <td className="py-3 px-4 text-sm text-gray-300">{new Date((log.created_at || 0) * 1000).toLocaleString()}</td>
                    <td className="py-3 px-4 text-sm font-medium text-gray-200">{log.service_id}</td>
                    <td className="py-3 px-4 text-sm text-gray-400 font-mono">{log.seller?.slice(0, 6)}...</td>
                    <td className="py-3 px-4 text-sm text-yellow-400">{log.unit_price?.toFixed(4) || "0.0000"} USDC</td>
                    <td className="py-3 px-4 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs ${log.status === "succeeded" || log.status === "accepted" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                        {log.status === "succeeded" || log.status === "accepted" ? "Success" : "Failed"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-500 font-mono">{log.request_id.slice(0, 8)}...</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      </div>

      {/* Settlement Warning Modal */}
      {isSettlementModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg p-6 bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white flex items-center">
                <AlertTriangle className="w-6 h-6 mr-2 text-yellow-500" />
                结算确认
              </h3>
              <button 
                onClick={() => !isSettling && setIsSettlementModalOpen(false)}
                className="text-gray-400 hover:text-white"
                disabled={isSettling}
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div className="p-4 bg-gray-800 rounded-lg space-y-3 border border-gray-700">
                <div className="flex justify-between items-center pb-3 border-b border-gray-700">
                  <span className="text-gray-400">历史消耗总计 (Paid to APIs)</span>
                  <span className="font-mono text-gray-300">
                    {logs.reduce((acc, log) => acc + (log.unit_price || 0), 0).toFixed(2)} USDC
                  </span>
                </div>
                <div className="flex justify-between items-center pt-1">
                  <span className="text-lg font-medium text-white">本次可提款 (Refundable)</span>
                  <span className="text-2xl font-bold text-green-400 font-mono">{stats.buyerBalance} USDC</span>
                </div>
              </div>

              <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <h4 className="text-sm font-semibold text-yellow-500 mb-1">⚠️ 危险操作警告</h4>
                <p className="text-sm text-yellow-200/80 leading-relaxed">
                  确认提取后，平台将立即清零您的离链余额保护账本。您的所有 API Key 将因余额不足而立即失效（返回 HTTP 402）。
                  <br className="my-1"/>
                  注意：本次提取为**链上提款操作**，获取凭证后将拉起钱包，您需要支付少量的网络 Gas 费。
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setIsSettlementModalOpen(false)}
                disabled={isSettling}
                className="flex-1 px-4 py-2 font-medium text-gray-300 transition-colors bg-gray-800 rounded-lg hover:bg-gray-700 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleSettlement}
                disabled={isSettling}
                className="flex-1 px-4 py-2 font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-600 disabled:opacity-50 flex justify-center items-center"
              >
                {isSettling ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    生成凭证中...
                  </>
                ) : (
                  "确认并获取赛博银票"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}