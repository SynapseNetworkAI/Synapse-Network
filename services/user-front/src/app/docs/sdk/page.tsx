"use client";

import { ArrowRight, Boxes, FileCode2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { StatusBadge } from "../components/StatusBadge";
import { useActiveSection } from "../use-active-section";
import { useDocsPageNav } from "../use-docs-page-nav";

const PAGE_SECTIONS = ["sdk-overview", "sdk-compare"];

export default function SdkPage() {
  const router = useRouter();
  const { t, tList } = useLanguage();
  useActiveSection(PAGE_SECTIONS, "sdk-overview");
  useDocsPageNav([
    { id: "sdk-overview", label: tList("docsPage.sidebarItemLabels")[24] ?? "SDK Overview" },
    { id: "sdk-compare", label: t("docsPage.sdkCompareTitle") },
  ]);

  const cardTitles = tList("docsPage.sdkHubCardTitles");
  const cardDescriptions = tList("docsPage.sdkHubCardDescriptions");
  const cardBullets = tList("docsPage.sdkHubCardBullets");
  const compareRows = tList("docsPage.sdkCompareRows");
  const compareTs = tList("docsPage.sdkCompareTypeScript");
  const comparePy = tList("docsPage.sdkComparePython");

  const cards = [
    {
      title: cardTitles[0] ?? "TypeScript SDK",
      description: cardDescriptions[0] ?? "",
      bulletText: cardBullets[0] ?? "",
      href: "/docs/sdk/typescript",
      accent: "#6eb6f6",
      icon: FileCode2,
      status: "GA" as const,
    },
    {
      title: cardTitles[1] ?? "Python SDK",
      description: cardDescriptions[1] ?? "",
      bulletText: cardBullets[1] ?? "",
      href: "/docs/sdk/python",
      accent: "#7ff7be",
      icon: Boxes,
      status: "GA" as const,
    },
  ];

  return (
    <div className="space-y-16">
      <section id="sdk-overview" className="space-y-5 border-b border-white/[0.06] pb-8">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
            {t("docsPage.sdkEyebrow")}
          </span>
          <StatusBadge status="GA" />
        </div>
        <h1 className="x-page-title text-white">{t("docsPage.sdkTitle")}</h1>
        <p className="x-body-copy max-w-[640px]">{t("docsPage.sdkDescription")}</p>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {cards.map((card) => (
          <button
            key={card.title}
            type="button"
            onClick={() => router.push(card.href)}
            className="x-tile-flat x-tile-flat-hover rounded-2xl p-6 text-left"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-xl border"
                style={{
                  borderColor: `${card.accent}2f`,
                  background: `${card.accent}14`,
                }}
              >
                <card.icon size={18} style={{ color: card.accent }} />
              </div>
              <StatusBadge status={card.status} />
            </div>
            <h2 className="x-section-title text-white">{card.title}</h2>
            <p className="mt-2 text-[14px] leading-7 text-[#8b98a5]">{card.description}</p>
            <div className="mt-5 rounded-xl border border-white/[0.06] bg-[#0a0b0d] px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a]">
                {t("docsPage.sdkHubCapabilityLabel")}
              </div>
              <p className="mt-2 text-[13px] leading-6 text-[#c8d0d8]">{card.bulletText}</p>
            </div>
            <div className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: card.accent }}>
              {t("docsPage.sdkHubOpenCta")}
              <ArrowRight size={14} />
            </div>
          </button>
        ))}
      </section>

      <section id="sdk-compare" className="space-y-5">
        <div className="space-y-2">
          <h2 className="x-section-title text-white">{t("docsPage.sdkCompareTitle")}</h2>
          <p className="x-body-copy max-w-[680px]">{t("docsPage.sdkCompareDescription")}</p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0b0d]">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a]">
                  {t("docsPage.sdkCompareCapability")}
                </th>
                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a]">
                  {t("docsPage.sdkTsTitle")}
                </th>
                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a]">
                  {t("docsPage.sdkPyTitle")}
                </th>
              </tr>
            </thead>
            <tbody>
              {compareRows.map((row, index) => (
                <tr key={row} className="border-b border-white/[0.04] last:border-b-0">
                  <td className="px-4 py-3 text-[13px] text-white">{row}</td>
                  <td className="px-4 py-3 text-[13px] text-[#8b98a5]">{compareTs[index] ?? ""}</td>
                  <td className="px-4 py-3 text-[13px] text-[#8b98a5]">{comparePy[index] ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="h-16" />
    </div>
  );
}
