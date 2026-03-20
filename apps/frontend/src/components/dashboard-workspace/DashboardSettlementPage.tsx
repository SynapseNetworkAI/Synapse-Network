"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import SettlementSummaryCards from "@/components/dashboard/settlement/SettlementSummaryCards";
import SettlementTable from "@/components/dashboard/settlement/SettlementTable";
import StatusFilter from "@/components/dashboard/shared/StatusFilter";
import {
  DEDUCTION_STATUS_OPTIONS,
  type DeductionStatusFilter,
} from "@/components/dashboard/shared/deductionStatus";
import { useSettlementData } from "@/hooks/useSettlementData";

export default function SettlementPage() {
  const { loading, walletUsdc, providerRows, totals } = useSettlementData();
  const [statusFilter, setStatusFilter] = useState<DeductionStatusFilter>("all");

  const filteredRows = useMemo(() => {
    if (statusFilter === "all") return providerRows;
    return providerRows.filter((row) => row.status === statusFilter);
  }, [providerRows, statusFilter]);

  return (
    <div className="p-8 mx-auto space-y-6 max-w-6xl">
      <div>
        <h1 className="text-3xl font-bold text-white">Reconciliation Preview</h1>
        <p className="mt-2 text-gray-400">Owner-facing preview of provider payout exposure and refundable wallet state before the finance pipeline is fully unified.</p>
        <p className="mt-1 text-xs text-gray-500">This compatibility page exists for reconciliation review. Canonical owner surfaces are Treasury, Invocations, and Risk & Audit.</p>
      </div>

      <StatusFilter
        id="settlement-status"
        options={DEDUCTION_STATUS_OPTIONS}
        value={statusFilter}
        onChange={setStatusFilter}
      />

      <SettlementSummaryCards
        providerReceivable={totals.provider_receivable}
        providerGross={totals.provider_gross}
        platformFee={totals.platform_fee}
        walletUsdc={walletUsdc}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
          <h2 className="text-lg font-semibold text-white">Provider Payout Exposure</h2>
          <p className="mt-2 text-sm text-gray-400">Preview the provider-side payable amount and the source events before payout execution is handled in the dedicated Provider workspace.</p>
          <button type="button" className="px-4 py-2 mt-4 text-sm font-semibold text-black bg-yellow-500 rounded-lg opacity-70 cursor-not-allowed">
            Provider payout executes in Provider Settlements
          </button>
        </div>

        <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
          <h2 className="text-lg font-semibold text-white">Owner Refund Exposure</h2>
          <p className="mt-2 text-sm text-gray-400">Review the owner-side refundable snapshot before the refund workflow is fully surfaced in treasury operations.</p>
          <button type="button" className="px-4 py-2 mt-4 text-sm font-semibold text-white border border-gray-700 rounded-lg opacity-70 cursor-not-allowed">
            Refund workflow stays treasury-controlled
          </button>
        </div>
      </div>

      <SettlementTable loading={loading} rows={filteredRows} />

      <div className="flex gap-2 mt-4">
        <Link href="/dashboard" className="inline-flex px-4 py-2 text-sm font-semibold text-white border border-gray-700 rounded-lg hover:bg-gray-900">去 Overview</Link>
        <Link href="/dashboard/billing" className="inline-flex px-4 py-2 text-sm font-semibold text-black bg-green-500 rounded-lg hover:bg-green-400">Open Owner Treasury</Link>
        <Link href="/dashboard/audit" className="inline-flex px-4 py-2 text-sm font-semibold text-white border border-gray-700 rounded-lg hover:bg-gray-900">Open Audit</Link>
      </div>
    </div>
  );
}
