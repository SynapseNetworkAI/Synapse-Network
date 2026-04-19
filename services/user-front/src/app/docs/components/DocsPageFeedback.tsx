"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import FeedbackDrawer, { type FeedbackSeed } from "@/components/feedback/FeedbackDrawer";

export default function DocsPageFeedback() {
  const pathname = usePathname();
  const { t, lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const [sentiment, setSentiment] = useState<FeedbackSeed["sentiment"]>("report_issue");

  const route = typeof window !== "undefined" ? `${pathname ?? ""}${window.location.hash}` : pathname ?? "";
  const seed = useMemo<FeedbackSeed>(
    () => ({
      source: "docs",
      sentiment,
      category: "docs_issue",
      route,
      pageTitle: typeof document !== "undefined" ? document.title : "",
      language: lang,
      context: {
        surface: "docs_page_feedback",
      },
    }),
    [lang, route, sentiment]
  );

  const openWithSentiment = (next: FeedbackSeed["sentiment"]) => {
    setSentiment(next);
    setOpen(true);
  };

  return (
    <section className="mt-12 rounded-[28px] border border-[#1f2328] bg-[#050505] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]" data-testid="docs-page-feedback">
      <p className="text-sm font-semibold text-[#e7e9ea]">{t("feedback.docsHelpfulTitle")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => openWithSentiment("helpful")}
          className="rounded-full border border-[#7ff7be]/25 bg-[#7ff7be]/10 px-4 py-2 text-sm font-semibold text-[#dfffee] transition hover:border-[#7ff7be]/45"
        >
          {t("feedback.helpful")}
        </button>
        <button
          type="button"
          onClick={() => openWithSentiment("not_helpful")}
          className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white/70 transition hover:border-white/20 hover:text-white"
        >
          {t("feedback.notHelpful")}
        </button>
        <button
          type="button"
          onClick={() => openWithSentiment("report_issue")}
          className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white/70 transition hover:border-white/20 hover:text-white"
        >
          {t("feedback.reportIssue")}
        </button>
      </div>
      <FeedbackDrawer open={open} onClose={() => setOpen(false)} seed={seed} />
    </section>
  );
}
