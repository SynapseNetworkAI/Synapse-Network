"use client";

import TreasuryPanel from "@/components/dashboard/billing/TreasuryPanel";
import FundsLedgerTable from "@/components/dashboard/billing/FundsLedgerTable";
import { useFundsData } from "@/hooks/useFundsData";
import WalletProfileBadge from "@/components/WalletProfileBadge";
import AuthMask from "@/components/AuthMask";

export default function BillingPage() {
  const { records, loading, vaultBalance, walletBalance, refetch } = useFundsData();

  return (
    <div className="max-w-6xl p-8 mx-auto space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-gray-800">
        <div>
          <h1 className="text-3xl font-bold text-white">Billing & Funds</h1>
          <p className="mt-2 text-gray-400">宏观资金大盘：统一管理 Deposit (充值), Withdraw (提现) 与 Refund (退款)。</p>
          <p className="mt-1 text-xs text-gray-500">（高频 API 消费日志请前往 Usage 页面查看，此处仅展示账户资金进出。）</p>
        </div>
        <WalletProfileBadge />
      </div>

      <AuthMask>
        <div className="space-y-8">
          <TreasuryPanel 
            vaultBalance={vaultBalance} 
            walletBalance={walletBalance} 
            onRefresh={refetch} 
          />
          <FundsLedgerTable loading={loading} records={records} />
        </div>
      </AuthMask>
    </div>
  );
}
