"use client";

import Link from "next/link";
import SettlementSummaryCards from "@/components/dashboard/settlement/SettlementSummaryCards";
import SettlementTable from "@/components/dashboard/settlement/SettlementTable";
import { useSettlementData } from "@/hooks/useSettlementData";

export default function SettlementPage() {
  const { loading, walletUsdc, sellerRows, totals } = useSettlementData();

  return (
    <div className="p-8 mx-auto space-y-6 max-w-6xl">
      <div>
        <h1 className="text-3xl font-bold text-white">Settlement</h1>
        <p className="mt-2 text-gray-400">V1 实时视图：基于链上事件估算卖家可结算收益，并展示买家钱包可退余额参考。</p>
      </div>

      <SettlementSummaryCards
        sellerReceivable={totals.seller_receivable}
        sellerGross={totals.seller_gross}
        platformFee={totals.platform_fee}
        walletUsdc={walletUsdc}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
          <h2 className="text-lg font-semibold text-white">卖家提现</h2>
          <p className="mt-2 text-sm text-gray-400">待接入 EIP-712 claim。当前先展示可结算估算值与来源事件。</p>
          <button type="button" className="px-4 py-2 mt-4 text-sm font-semibold text-black bg-yellow-500 rounded-lg opacity-70 cursor-not-allowed">
            申请提现（即将接入）
          </button>
        </div>

        <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
          <h2 className="text-lg font-semibold text-white">买家退款</h2>
          <p className="mt-2 text-sm text-gray-400">待接入 refund 票据流程。当前展示钱包 USDC 余额作为可退参考快照。</p>
          <button type="button" className="px-4 py-2 mt-4 text-sm font-semibold text-white border border-gray-700 rounded-lg opacity-70 cursor-not-allowed">
            申请退款（即将接入）
          </button>
        </div>
      </div>

      <SettlementTable loading={loading} rows={sellerRows} />

      <div className="flex gap-2 mt-4">
        <Link href="/dashboard" className="inline-flex px-4 py-2 text-sm font-semibold text-white border border-gray-700 rounded-lg hover:bg-gray-900">去 Overview</Link>
        <Link href="/dashboard/router" className="inline-flex px-4 py-2 text-sm font-semibold text-black bg-green-500 rounded-lg hover:bg-green-400">去 Router</Link>
      </div>
    </div>
  );
}
