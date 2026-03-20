"use client";

import TreasuryPanel from "@/components/dashboard/billing/TreasuryPanel";
import FundsLedgerTable from "@/components/dashboard/billing/FundsLedgerTable";
import { useFundsData } from "@/hooks/useFundsData";

export default function OwnerBillingPage() {
  const { records, loading, vaultBalance, walletBalance, refetch } = useFundsData();

  return (
    <div className="max-w-6xl p-8 mx-auto space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-gray-800">
        <div>
          <h1 className="text-3xl font-bold text-white">Owner Treasury</h1>
          <p className="mt-2 text-gray-400">
            Owner-scoped funds center for deposits, withdrawals, refunds, and wallet-to-vault balances.
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Provider earnings and payout operations live in Provider Settlements and Revenue Analytics, not in this owner treasury view.
          </p>
        </div>
      </div>

      <div className="space-y-8">
        <TreasuryPanel
          vaultBalance={vaultBalance}
          walletBalance={walletBalance}
          onRefresh={refetch}
        />
        <FundsLedgerTable loading={loading} records={records} />
      </div>
    </div>
  );
}