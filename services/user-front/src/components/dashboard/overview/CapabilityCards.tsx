import React from "react";
import { Shield, Key, Zap, Landmark } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";

export default function CapabilityCards() {
  const { t } = useLanguage();

  const capabilities = [
    {
      icon: <Landmark className="w-4 h-4 text-amber-400" />,
      title: t("overviewPage.capabilitySmartVaultsTitle"),
      description: t("overviewPage.capabilitySmartVaultsDescription")
    },
    {
      icon: <Key className="w-4 h-4 text-blue-400" />,
      title: t("overviewPage.capabilityAgentCredentialsTitle"),
      description: t("overviewPage.capabilityAgentCredentialsDescription")
    },
    {
      icon: <Zap className="w-4 h-4 text-emerald-400" />,
      title: t("overviewPage.capabilityAtomicSettlementTitle"),
      description: t("overviewPage.capabilityAtomicSettlementDescription")
    },
    {
      icon: <Shield className="w-4 h-4 text-purple-400" />,
      title: t("overviewPage.capabilityUnifiedLedgerTitle"),
      description: t("overviewPage.capabilityUnifiedLedgerDescription")
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {capabilities.map((cap) => (
        <div key={cap.title} className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all group">
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 w-fit mb-4 group-hover:border-white/10 transition-colors">
            {cap.icon}
          </div>
          <h3 className="text-sm font-bold text-white mb-2">{cap.title}</h3>
          <p className="text-xs text-gray-500 leading-relaxed">
            {cap.description}
          </p>
        </div>
      ))}
    </div>
  );
}
