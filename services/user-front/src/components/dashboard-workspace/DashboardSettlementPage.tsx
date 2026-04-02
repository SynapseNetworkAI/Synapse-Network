"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import SettlementSummaryCards from "@/components/dashboard/settlement/SettlementSummaryCards";
import SettlementTable from "@/components/dashboard/settlement/SettlementTable";
import StatusFilter from "@/components/dashboard/shared/StatusFilter";
import {
  DEDUCTION_STATUS_OPTIONS,
  type DeductionStatusFilter,
} from "@/components/dashboard/shared/deductionStatus";
import { useSettlementData } from "@/hooks/useSettlementData";

export default function SettlementPage() {
  const { t } = useLanguage();
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
        <p className="mt-2 text-gray-400">{t("settlementPage.description")}</p>
        <p className="mt-1 text-xs text-gray-500">{t("settlementPage.note")}</p>
      </div>

      <StatusFilter
        id="settlement-status"
        label={t("settlementPage.filterLabel")}
        options={DEDUCTION_STATUS_OPTIONS}
        value={statusFilter}
        onChange={setStatusFilter}
        getOptionLabel={(option) => {
          if (option === "accepted") return t("settlementPage.filterAccepted");
          if (option === "succeeded") return t("settlementPage.filterSucceeded");
          if (option === "refunded") return t("settlementPage.filterRefunded");
          if (option === "failed") return t("settlementPage.filterFailed");
          return t("settlementPage.filterAll");
        }}
      />

      <SettlementSummaryCards
        providerReceivable={totals.provider_receivable}
        providerGross={totals.provider_gross}
        platformFee={totals.platform_fee}
        walletUsdc={walletUsdc}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
          <h2 className="text-lg font-semibold text-white">{t("settlementPage.providerPayoutExposureTitle")}</h2>
          <p className="mt-2 text-sm text-gray-400">{t("settlementPage.providerPayoutExposureDescription")}</p>
          <button type="button" className="px-4 py-2 mt-4 text-sm font-semibold text-black bg-yellow-500 rounded-lg opacity-70 cursor-not-allowed">
            {t("settlementPage.providerPayoutExposureAction")}
          </button>
        </div>

        <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
          <h2 className="text-lg font-semibold text-white">{t("settlementPage.ownerRefundExposureTitle")}</h2>
          <p className="mt-2 text-sm text-gray-400">{t("settlementPage.ownerRefundExposureDescription")}</p>
          <button type="button" className="px-4 py-2 mt-4 text-sm font-semibold text-white border border-gray-700 rounded-lg opacity-70 cursor-not-allowed">
            {t("settlementPage.ownerRefundExposureAction")}
          </button>
        </div>
      </div>

      <SettlementTable loading={loading} rows={filteredRows} />

      <div className="flex gap-2 mt-4">
        <Link href="/dashboard" className="inline-flex px-4 py-2 text-sm font-semibold text-white border border-gray-700 rounded-lg hover:bg-gray-900">{t("settlementPage.backOverview")}</Link>
        <Link href="/dashboard/billing" className="inline-flex px-4 py-2 text-sm font-semibold text-black bg-green-500 rounded-lg hover:bg-green-400">{t("settlementPage.openOwnerTreasury")}</Link>
        <Link href="/dashboard/audit" className="inline-flex px-4 py-2 text-sm font-semibold text-white border border-gray-700 rounded-lg hover:bg-gray-900">{t("settlementPage.openAudit")}</Link>
      </div>
    </div>
  );
}
