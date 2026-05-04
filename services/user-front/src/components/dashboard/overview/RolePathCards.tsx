import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";

export default function RolePathCards() {
  const { t, tList } = useLanguage();
  const ownerSteps = tList("overviewPage.rolePathOwnerSteps");
  const providerSteps = tList("overviewPage.rolePathProviderSteps");

  return (
    <div className="grid grid-cols-1 gap-4 mt-6 lg:grid-cols-2">
      <div className="p-4 border border-gray-800 rounded-lg bg-gray-950/60">
        <h3 className="text-sm font-bold text-white">
          {t("overviewPage.rolePathOwnerTitle")}
        </h3>
        <ol className="mt-3 space-y-2 text-xs text-gray-300 list-decimal list-inside h-24">
          {ownerSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2 mt-2">
          <Link
            href="/dashboard/agents"
            className="flex items-center px-4 py-2.5 text-xs font-bold text-black bg-blue-500 rounded-lg hover:bg-blue-400 transition-colors"
          >
            {t("overviewPage.rolePathOwnerCta")}
            <ArrowRight className="w-4 h-4 ml-1" />
          </Link>
        </div>
      </div>

      <div className="p-4 border border-gray-800 rounded-lg bg-gray-950/60">
        <h3 className="text-sm font-bold text-white">
          {t("overviewPage.rolePathProviderTitle")}
        </h3>
        <ol className="mt-3 space-y-2 text-xs text-gray-300 list-decimal list-inside h-24">
          {providerSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2 mt-2">
          <Link
            href="/provider/console"
            className="flex items-center px-4 py-2.5 text-xs font-bold text-black bg-green-500 rounded-lg hover:bg-green-400 transition-colors"
          >
            {t("overviewPage.rolePathProviderCta")}
            <ArrowRight className="w-4 h-4 ml-1" />
          </Link>
        </div>
      </div>
    </div>
  );
}
