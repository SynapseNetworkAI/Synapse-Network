"use client";

import { useMemo, useState } from "react";
import { MessageSquare } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import FeedbackDrawer, { type FeedbackSeed } from "@/components/feedback/FeedbackDrawer";

export default function FeedbackFloatingButton() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  const seed = useMemo<FeedbackSeed>(() => {
    const query = searchParams?.toString() ?? "";
    const route = `${pathname ?? ""}${query ? `?${query}` : ""}`;
    return {
      source: "dashboard",
      sentiment: "report_issue",
      category: pathname?.includes("/billing") ? "billing_support" : pathname?.includes("/discovery") ? "provider_services" : "product_feedback",
      route,
      context: {
        query: searchParams ? Object.fromEntries(searchParams.entries()) : {},
        surface: "dashboard_feedback_floating_button",
      },
    };
  }, [pathname, searchParams]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 inline-flex h-12 items-center gap-2 rounded-full border border-[#7ff7be]/25 bg-[#07120d]/90 px-4 text-sm font-semibold text-[#dfffee] shadow-[0_18px_70px_rgba(0,0,0,0.45)] backdrop-blur transition hover:border-[#7ff7be]/45 hover:bg-[#0b1c14]"
        data-testid="feedback-floating-button"
      >
        <MessageSquare className="h-4 w-4" />
        {t("feedback.floatingButton")}
      </button>
      <FeedbackDrawer open={open} onClose={() => setOpen(false)} seed={seed} />
    </>
  );
}
