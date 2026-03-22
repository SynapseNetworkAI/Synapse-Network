import type { SettlementEvent } from "@/hooks/useSettlementData";
import StatusBadge from "@/components/dashboard/shared/StatusBadge";
import { useLanguage } from "@/components/i18n/LanguageProvider";

type SettlementTableProps = {
  loading: boolean;
  rows: SettlementEvent[];
};

export default function SettlementTable({ loading, rows }: Readonly<SettlementTableProps>) {
  const { t } = useLanguage();

  const getStatusLabel = (status: SettlementEvent["status"]) => {
    if (status === "accepted") return t("settlementPage.statusAccepted");
    if (status === "succeeded") return t("settlementPage.statusSucceeded");
    if (status === "refunded") return t("settlementPage.statusRefunded");
    return t("settlementPage.statusFailed");
  };

  let bodyContent: React.ReactNode;
  if (loading) {
    bodyContent = (
      <tr>
        <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
          {t("settlementPage.loading")}
        </td>
      </tr>
    );
  } else if (rows.length === 0) {
    bodyContent = (
      <tr>
        <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
          {t("settlementPage.empty")}
        </td>
      </tr>
    );
  } else {
    bodyContent = rows.map((row) => (
      <tr key={`${row.txHash}-${row.blockNumber}`} className="transition-colors hover:bg-gray-900/30">
        <td className="px-4 py-3 text-blue-300">{row.serviceId}</td>
        <td className="px-4 py-3">
          <StatusBadge status={row.status} label={getStatusLabel(row.status)} />
        </td>
        <td className="px-4 py-3 font-mono text-right text-white">{row.gross.toFixed(4)}</td>
        <td className="px-4 py-3 font-mono text-right text-yellow-300">{row.platform_fee.toFixed(4)}</td>
        <td className="px-4 py-3 font-mono text-right text-green-300">{row.provider_net.toFixed(4)}</td>
        <td className="px-4 py-3 font-mono text-xs text-gray-400">{`${row.txHash.slice(0, 8)}...${row.txHash.slice(-6)}`}</td>
      </tr>
    ));
  }

  return (
    <div className="overflow-hidden border border-gray-800 rounded-xl bg-black/40">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="text-xs text-gray-400 uppercase bg-gray-900 border-b border-gray-800">
            <tr>
              <th className="px-4 py-3">{t("settlementPage.tableServiceId")}</th>
              <th className="px-4 py-3">{t("settlementPage.tableStatus")}</th>
              <th className="px-4 py-3 text-right">{t("settlementPage.tableProviderGross")}</th>
              <th className="px-4 py-3 text-right">{t("settlementPage.tablePlatformFee")}</th>
              <th className="px-4 py-3 text-right">{t("settlementPage.tableProviderNet")}</th>
              <th className="px-4 py-3">{t("settlementPage.tableRequestId")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/80">{bodyContent}</tbody>
        </table>
      </div>
    </div>
  );
}
