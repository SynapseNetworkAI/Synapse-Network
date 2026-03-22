import React from "react";
import { Wallet, UserPlus, Search, Zap, PlusCircle, Server, DollarSign, ArrowRight, CreditCard } from "lucide-react";
import Link from "next/link";
import { useLanguage } from "@/components/i18n/LanguageProvider";

export default function WorkflowSection() {
  const { t } = useLanguage();

  const consumerSteps = [
    {
      icon: <Wallet className="w-4 h-4 text-blue-400" />,
      title: t("overviewPage.consumerDepositTitle"),
      description: t("overviewPage.consumerDepositDescription"),
      link: "/dashboard/billing",
      linkText: t("overviewPage.consumerDepositLink")
    },
    {
      icon: <UserPlus className="w-4 h-4 text-blue-400" />,
      title: t("overviewPage.consumerCreateAgentTitle"),
      description: t("overviewPage.consumerCreateAgentDescription"),
      link: "/dashboard/agents/workspace",
      linkText: t("overviewPage.consumerCreateAgentLink")
    },
    {
      icon: <Search className="w-4 h-4 text-blue-400" />,
      title: t("overviewPage.consumerDiscoveryTitle"),
      description: t("overviewPage.consumerDiscoveryDescription"),
      link: "/dashboard/discovery",
      linkText: t("overviewPage.consumerDiscoveryLink")
    },
    {
      icon: <Zap className="w-4 h-4 text-blue-400" />,
      title: t("overviewPage.consumerCredentialTitle"),
      description: t("overviewPage.consumerCredentialDescription"),
      link: "/dashboard/credentials",
      linkText: t("overviewPage.consumerCredentialLink")
    }
  ];

  const providerSteps = [
    {
      icon: <PlusCircle className="w-4 h-4 text-emerald-400" />,
      title: t("overviewPage.providerCreateServiceTitle"),
      description: t("overviewPage.providerCreateServiceDescription"),
      link: "/provider/services/deploy",
      linkText: t("overviewPage.providerCreateServiceLink")
    },
    {
      icon: <Server className="w-4 h-4 text-emerald-400" />,
      title: t("overviewPage.providerServeAgentsTitle"),
      description: t("overviewPage.providerServeAgentsDescription"),
      link: "/provider/health",
      linkText: t("overviewPage.providerServeAgentsLink")
    },
    {
      icon: <DollarSign className="w-4 h-4 text-emerald-400" />,
      title: t("overviewPage.providerEarnTitle"),
      description: t("overviewPage.providerEarnDescription"),
      link: "/provider/usage",
      linkText: t("overviewPage.providerEarnLink")
    },
    {
      icon: <CreditCard className="w-4 h-4 text-emerald-400" />,
      title: t("overviewPage.providerWithdrawTitle"),
      description: t("overviewPage.providerWithdrawDescription"),
      link: "/provider/settlements",
      linkText: t("overviewPage.providerWithdrawLink")
    }
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
      {/* Consumer Path */}
      <div className="space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <UserPlus className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">{t("overviewPage.consumerPathTitle")}</h3>
            <p className="text-xs text-gray-500">{t("overviewPage.consumerPathDescription")}</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {consumerSteps.map((step, idx) => (
            <div key={step.title} className="group p-5 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-blue-500/30 transition-all">
              <div className="flex items-center justify-between mb-4">
                <div className="p-2 rounded-lg bg-white/[0.03] border border-white/5 group-hover:bg-blue-500/10 group-hover:border-blue-500/20 transition-colors">
                  {step.icon}
                </div>
                <span className="text-[10px] font-mono text-gray-600 group-hover:text-blue-400/60 transition-colors">0{idx + 1}</span>
              </div>
              <h4 className="text-sm font-bold text-white mb-2">{step.title}</h4>
              <p className="text-xs text-gray-500 leading-relaxed mb-4">{step.description}</p>
              <Link href={step.link} className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors uppercase tracking-widest">
                {step.linkText}
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* Provider Path */}
      <div className="space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <Server className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">{t("overviewPage.providerPathTitle")}</h3>
            <p className="text-xs text-gray-500">{t("overviewPage.providerPathDescription")}</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {providerSteps.map((step, idx) => (
            <div key={step.title} className="group p-5 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-emerald-500/30 transition-all">
              <div className="flex items-center justify-between mb-4">
                <div className="p-2 rounded-lg bg-white/[0.03] border border-white/5 group-hover:bg-emerald-500/10 group-hover:border-emerald-500/20 transition-colors">
                  {step.icon}
                </div>
                <span className="text-[10px] font-mono text-gray-600 group-hover:text-emerald-400/60 transition-colors">0{idx + 1}</span>
              </div>
              <h4 className="text-sm font-bold text-white mb-2">{step.title}</h4>
              <p className="text-xs text-gray-500 leading-relaxed mb-4">{step.description}</p>
              <Link href={step.link} className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 hover:text-emerald-300 transition-colors uppercase tracking-widest">
                {step.linkText}
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
