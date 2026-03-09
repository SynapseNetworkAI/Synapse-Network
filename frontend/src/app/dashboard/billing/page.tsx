"use client";

import Link from "next/link";
import BillingSummaryCards from "@/components/dashboard/billing/BillingSummaryCards";
import BillingTable from "@/components/dashboard/billing/BillingTable";
import { useBillingData } from "@/hooks/useBillingData";

export default function BillingPage() {
  const { rows, loading, summary } = useBillingData();

  return (
    <div className="max-w-6xl p-8 mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Billing</h1>
        <p className="mt-2 text-gray-400">基于链上 ServicePaid 事件的实时账单（含 amount / platform_fee / seller_net）。</p>
      </div>

      <BillingSummaryCards
        totalSpend={summary.totalSpend}
        totalIncome={summary.totalIncome}
        totalPlatformFee={summary.totalPlatformFee}
      />

      <BillingTable loading={loading} rows={rows} />

      <div className="flex gap-2">
        <Link href="/dashboard" className="inline-flex px-4 py-2 text-sm font-semibold text-white border border-gray-700 rounded-lg hover:bg-gray-900">去 Overview</Link>
        <Link href="/dashboard/credentials" className="inline-flex px-4 py-2 text-sm font-semibold text-black bg-green-500 rounded-lg hover:bg-green-400">去凭据审计</Link>
      </div>
    </div>
  );
}
