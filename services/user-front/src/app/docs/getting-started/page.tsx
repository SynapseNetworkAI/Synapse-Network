"use client";

import { ArrowRight, Zap, Radio } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useActiveSection } from "../use-active-section";

export default function GettingStartedOverviewPage() {
  const router = useRouter();
  const { t, tList } = useLanguage();
  useActiveSection(["gs-overview"], "gs-overview");
  const consumerSteps = tList("docsPage.gettingStartedConsumerSteps");
  const providerSteps = tList("docsPage.gettingStartedProviderSteps");
  const dims = tList("docsPage.gettingStartedDifferenceDims");
  const consumerDiffs = tList("docsPage.gettingStartedDifferenceConsumer");
  const providerDiffs = tList("docsPage.gettingStartedDifferenceProvider");

  return (
    <div className="space-y-16">

      {/* Page header */}
      <div className="space-y-3 border-b border-white/[0.06] pb-8">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
          {t("docsPage.gettingStartedEyebrow")}
        </span>
        <h1 className="x-page-title text-white">{t("docsPage.gettingStartedTitle")}</h1>
        <p className="x-body-copy max-w-[560px]">
          {t("docsPage.gettingStartedDescription")}
        </p>
      </div>

      {/* Role cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Consumer card */}
        <div
          className="rounded-2xl border p-6 space-y-5 flex flex-col"
          style={{ border: "1px solid #7ff7be20", background: "#7ff7be06" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "#7ff7be18", boxShadow: "inset 0 0 0 1px #7ff7be28" }}
            >
              <Zap size={18} style={{ color: "#7ff7be" }} />
            </div>
            <div>
              <div className="text-[10px] font-semibold tracking-widest text-[#7ff7be] uppercase mb-0.5">
                {t("docsPage.consumerEyebrow")}
              </div>
              <div className="x-card-title text-white">{t("docsPage.gettingStartedConsumerTitle")}</div>
            </div>
          </div>

          <p className="text-[13px] text-[#71767b] leading-relaxed">
            {t("docsPage.gettingStartedConsumerDescription")}
          </p>

          <div
            className="rounded-xl p-4 space-y-2"
            style={{ background: "#7ff7be08", border: "1px solid #7ff7be14" }}
          >
            <div className="text-[10px] font-semibold tracking-widest text-[#7ff7be] uppercase mb-2">
              {t("docsPage.gettingStartedSixSteps")}
            </div>
            {consumerSteps.map((s, i) => (
              <div key={s} className="flex items-center gap-2 text-[12px] text-[#71767b]">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                  style={{ background: "#7ff7be12", color: "#7ff7be", border: "1px solid #7ff7be28" }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                {s}
              </div>
            ))}
          </div>

          <div className="mt-auto pt-2">
            <button
              onClick={() => router.push("/docs/getting-started/consumer")}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-[14px] transition-colors"
              style={{
                background: "#7ff7be18",
                border: "1px solid #7ff7be30",
                color: "#7ff7be",
              }}
            >
              {t("docsPage.gettingStartedConsumerCta")} <ArrowRight size={15} />
            </button>
          </div>
        </div>

        {/* Provider card */}
        <div
          className="rounded-2xl border p-6 space-y-5 flex flex-col"
          style={{ border: "1px solid #6eb6f620", background: "#6eb6f606" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "#6eb6f618", boxShadow: "inset 0 0 0 1px #6eb6f628" }}
            >
              <Radio size={18} style={{ color: "#6eb6f6" }} />
            </div>
            <div>
              <div className="text-[10px] font-semibold tracking-widest text-[#6eb6f6] uppercase mb-0.5">
                {t("docsPage.providerEyebrow")}
              </div>
              <div className="x-card-title text-white">{t("docsPage.gettingStartedProviderTitle")}</div>
            </div>
          </div>

          <p className="text-[13px] text-[#71767b] leading-relaxed">
            {t("docsPage.gettingStartedProviderDescription")}
          </p>

          <div
            className="rounded-xl p-4 space-y-2"
            style={{ background: "#6eb6f608", border: "1px solid #6eb6f614" }}
          >
            <div className="text-[10px] font-semibold tracking-widest text-[#6eb6f6] uppercase mb-2">
              {t("docsPage.gettingStartedSixSteps")}
            </div>
            {providerSteps.map((s, i) => (
              <div key={s} className="flex items-center gap-2 text-[12px] text-[#71767b]">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                  style={{ background: "#6eb6f612", color: "#6eb6f6", border: "1px solid #6eb6f628" }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                {s}
              </div>
            ))}
          </div>

          <div className="mt-auto pt-2">
            <button
              onClick={() => router.push("/docs/getting-started/provider")}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-[14px] transition-colors"
              style={{
                background: "#6eb6f618",
                border: "1px solid #6eb6f630",
                color: "#6eb6f6",
              }}
            >
              {t("docsPage.gettingStartedProviderCta")} <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Difference note */}
      <div className="x-panel-muted rounded-2xl p-6 space-y-3">
        <h3 className="text-[15px] font-semibold text-white">{t("docsPage.gettingStartedDifferenceTitle")}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
          {dims.map((dim, index) => (
            <div key={dim} className="space-y-2">
              <div className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase">{dim}</div>
              <div className="flex items-start gap-2 text-[12px]">
                <span className="text-[#7ff7be] shrink-0 font-mono">C</span>
                <span className="text-[#71767b]">{consumerDiffs[index] ?? ""}</span>
              </div>
              <div className="flex items-start gap-2 text-[12px]">
                <span className="text-[#6eb6f6] shrink-0 font-mono">P</span>
                <span className="text-[#71767b]">{providerDiffs[index] ?? ""}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="h-8" />
    </div>
  );
}
