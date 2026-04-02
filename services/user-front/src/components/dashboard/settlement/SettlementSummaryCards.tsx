import { useLanguage } from "@/components/i18n/LanguageProvider";

type SettlementSummaryCardsProps = {
  providerReceivable: number;
  providerGross: number;
  platformFee: number;
  walletUsdc: number;
};

export default function SettlementSummaryCards({
  providerReceivable,
  providerGross,
  platformFee,
  walletUsdc,
}: Readonly<SettlementSummaryCardsProps>) {
  const { t } = useLanguage();

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
        <p className="text-xs text-gray-500">{t("settlementPage.summaryProviderReceivable")}</p>
        <p className="mt-2 font-mono text-2xl text-green-400">${providerReceivable.toFixed(4)}</p>
      </div>
      <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
        <p className="text-xs text-gray-500">{t("settlementPage.summaryProviderGross")}</p>
        <p className="mt-2 font-mono text-2xl text-white">${providerGross.toFixed(4)}</p>
      </div>
      <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
        <p className="text-xs text-gray-500">{t("settlementPage.summaryPlatformFee")}</p>
        <p className="mt-2 font-mono text-2xl text-yellow-300">${platformFee.toFixed(4)}</p>
      </div>
      <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
        <p className="text-xs text-gray-500">{t("settlementPage.summaryOwnerRefundable")}</p>
        <p className="mt-2 font-mono text-2xl text-yellow-300">${walletUsdc.toFixed(4)}</p>
      </div>
    </div>
  );
}
