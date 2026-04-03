"use client";

import {
  Zap, Radio, Package, ArrowRight,
  Terminal, Layers, Shield, Activity, Database, Webhook,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { StatusBadge } from "./components/StatusBadge";
import { useActiveSection } from "./use-active-section";

export default function DocsOverviewPage() {
  const router = useRouter();
  const { t, tList } = useLanguage();
  useActiveSection(["introduction", "architecture"], "introduction");
  const quickCardTags = tList("docsPage.overviewQuickCardTags");
  const quickCardTitles = tList("docsPage.overviewQuickCardTitles");
  const quickCardDescriptions = tList("docsPage.overviewQuickCardDescriptions");
  const quickStartCards = [
    { icon: Zap, tag: quickCardTags[0], title: quickCardTitles[0], desc: quickCardDescriptions[0], href: "/docs/getting-started", color: "#7ff7be" },
    { icon: Radio, tag: quickCardTags[1], title: quickCardTitles[1], desc: quickCardDescriptions[1], href: "/docs/getting-started/provider", color: "#6eb6f6" },
    { icon: Package, tag: quickCardTags[2], title: quickCardTitles[2], desc: quickCardDescriptions[2], href: "/docs/sdk", color: "#f9c74f" },
  ];
  const productTitles = tList("docsPage.overviewProductTitles");
  const productDescriptions = tList("docsPage.overviewProductDescriptions");
  const products = [
    { icon: Terminal, title: productTitles[0], desc: productDescriptions[0], status: "GA", href: "/docs/api-reference" },
    { icon: Layers, title: productTitles[1], desc: productDescriptions[1], status: "GA", href: "/docs/concepts#service-registry" },
    { icon: Shield, title: productTitles[2], desc: productDescriptions[2], status: "GA", href: "/docs/concepts#credentials" },
    { icon: Activity, title: productTitles[3], desc: productDescriptions[3], status: "GA", href: "/docs/concepts" },
    { icon: Database, title: productTitles[4], desc: productDescriptions[4], status: "GA", href: "/docs/getting-started/consumer#step-deposit" },
    { icon: Webhook, title: productTitles[5], desc: productDescriptions[5], status: "SOON", href: "#" },
  ];
  const architectureLabels = tList("docsPage.overviewArchitectureLabels");
  const architectureDescriptions = tList("docsPage.overviewArchitectureDescriptions");

  return (
    <div className="space-y-20">

      {/* Hero */}
      <section id="introduction" data-testid="docs-hero" className="space-y-6">
        <div className="flex items-center gap-3">
          <StatusBadge status="BETA" />
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
            {t("docsPage.overviewEyebrow")}
          </span>
        </div>

        <h1 className="x-page-title text-white" style={{ maxWidth: 600 }}>
          {t("docsPage.overviewTitle")}
        </h1>

        <p className="x-body-copy max-w-[560px]">
          {t("docsPage.overviewDescription")}
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            data-testid="cta-quickstart"
            onClick={() => router.push("/docs/getting-started")}
            className="x-button-primary inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-[14px]"
          >
            {t("docsPage.overviewQuickStart")} <ArrowRight size={15} />
          </button>
          <button
            onClick={() => router.push("/docs/api-reference")}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-[14px] text-white border border-white/10 hover:border-white/20 hover:bg-white/[0.04] transition-colors"
          >
            {t("docsPage.overviewApiReference")}
          </button>
        </div>

        <div className="mt-2 p-5 rounded-2xl border border-white/[0.06] bg-[#0a0b0d] font-mono text-[12px] text-[#71767b] leading-relaxed">
          {t("docsPage.overviewFlowLine")} <span className="text-[#7ff7be]">✓</span>
          <br />
          <span className="text-[#3a3f45]">
            {t("docsPage.overviewFlowSubline")}
          </span>
        </div>
      </section>

      {/* Quick Start Cards */}
      <section>
        <div className="flex items-center gap-3 mb-6">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">{t("docsPage.overviewGetStartedLabel")}</span>
          <div className="flex-1 h-px bg-white/[0.045]" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="quickstart-cards">
          {quickStartCards.map((card) => (
            <button
              key={card.title}
              onClick={() => router.push(card.href)}
              className="x-tile-flat x-tile-flat-hover text-left p-5 rounded-2xl block"
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center mb-4"
                style={{ background: `${card.color}18`, boxShadow: `inset 0 0 0 1px ${card.color}28` }}
              >
                <card.icon size={17} style={{ color: card.color }} />
              </div>
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="x-card-title text-white">{card.title}</span>
                <span
                  className="text-[10px] font-semibold shrink-0 px-2 py-0.5 rounded border"
                  style={{ color: card.color, borderColor: `${card.color}28`, background: `${card.color}10` }}
                >
                  {card.tag}
                </span>
              </div>
              <p className="text-[13px] text-[#71767b] leading-relaxed">{card.desc}</p>
              <div className="mt-4 flex items-center gap-1 text-[12px] font-medium" style={{ color: card.color }}>
                <span>{t("docsPage.overviewReadGuide")}</span>
                <ArrowRight size={12} />
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Architecture */}
      <section id="architecture" className="space-y-4">
        <h2 className="x-section-title text-white">{t("docsPage.overviewArchitectureTitle")}</h2>
        <p className="x-body-copy">
          {t("docsPage.overviewArchitectureDescription")}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          {[
            { num: "01", label: architectureLabels[0], desc: architectureDescriptions[0], href: "/docs/contracts" },
            { num: "02", label: architectureLabels[1], desc: architectureDescriptions[1], href: "/docs/concepts" },
            { num: "03", label: architectureLabels[2], desc: architectureDescriptions[2], href: "/docs/getting-started/provider#step-withdraw" },
          ].map((step) => (
            <button
              key={step.num}
              onClick={() => router.push(step.href)}
              className="x-panel-muted x-tile-flat-hover text-left rounded-2xl p-5 block w-full"
            >
              <div className="text-[10px] font-semibold tracking-widest text-[#7ff7be] mb-3">{step.num}</div>
              <div className="x-card-title text-white mb-2">{step.label}</div>
              <p className="text-[13px] text-[#71767b] leading-relaxed">{step.desc}</p>
              <div className="mt-4 flex items-center gap-1 text-[12px] font-medium text-[#7ff7be]/70">
                <span>{t("docsPage.overviewLearnMore")}</span>
                <ArrowRight size={12} />
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Platform Products */}
      <section>
        <div className="flex items-center gap-3 mb-6">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">{t("docsPage.overviewPlatformProductsLabel")}</span>
          <div className="flex-1 h-px bg-white/[0.045]" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="products-grid">
          {products.map((p) => (
            <button
              key={p.title}
              onClick={() => p.href !== "#" && router.push(p.href)}
              disabled={p.href === "#"}
              className="x-tile-flat text-left p-5 rounded-2xl disabled:opacity-50 disabled:cursor-not-allowed enabled:x-tile-flat-hover"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.04] border border-white/[0.06]">
                  <p.icon size={15} className="text-[#71767b]" />
                </div>
                <StatusBadge status={p.status} />
              </div>
              <div className="x-card-title text-white mb-1.5">{p.title}</div>
              <p className="text-[13px] text-[#71767b] leading-relaxed">{p.desc}</p>
            </button>
          ))}
        </div>
      </section>

      <div className="h-16" />
    </div>
  );
}
