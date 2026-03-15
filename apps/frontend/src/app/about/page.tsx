"use client";

import { useLanguage } from "@/components/i18n/LanguageProvider";

export default function AboutPage() {
  const { t } = useLanguage();

  return (
    <main className="min-h-screen bg-black text-white px-6 py-20">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold tracking-tight">{t("aboutPage.title")}</h1>
        <p className="mt-4 text-[#86868b] leading-relaxed">
          {t("aboutPage.description")}
        </p>
      </div>
    </main>
  );
}
