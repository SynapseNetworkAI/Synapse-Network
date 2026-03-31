"use client";

import Link from "next/link";
import TreasuryPanel from "@/components/dashboard/billing/TreasuryPanel";
import FundsLedgerTable from "@/components/dashboard/billing/FundsLedgerTable";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useFundsData } from "@/hooks/useFundsData";

export default function OwnerBillingPage() {
  const { t } = useLanguage();
  const { records, loading, vaultBalance, walletBalance, refetch } = useFundsData();

  return (
    <div className="max-w-6xl p-8 mx-auto space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-gray-800">
        <div>
          <h1 className="text-3xl font-bold text-white">{t("billingPage.title")}</h1>
          <p className="mt-2 text-gray-400">
            {t("billingPage.description")}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {t("billingPage.note")}
          </p>
        </div>
        <Link
          href="/dashboard/billing/credits"
          className="inline-flex items-center gap-2 rounded-lg border border-blue-400/20 bg-blue-500/10 px-4 py-2 text-xs font-bold text-blue-300 transition hover:bg-blue-500/20"
        >
          {t("billingPage.openCredits")}
        </Link>
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
