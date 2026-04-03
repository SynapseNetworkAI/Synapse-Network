"use client";

import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";

export default function DocsNotFound() {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 py-24 text-center">

      {/* Icon */}
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6"
        style={{ background: "rgba(127,247,190,0.07)", border: "1px solid rgba(127,247,190,0.14)" }}
      >
        <FileQuestion size={26} style={{ color: "#7ff7be" }} />
      </div>

      {/* Heading */}
      <h1 className="text-[28px] font-semibold text-white tracking-[-0.02em] mb-3">
        {t("docsPage.notFoundTitle")}
      </h1>

      {/* Sub-copy */}
      <p className="text-[14px] text-[#8b98a5] max-w-[320px] leading-relaxed mb-8">
        {t("docsPage.notFoundDescription")}
      </p>

      {/* Back link */}
      <Link
        href="/docs"
        className="inline-flex items-center gap-2 h-[38px] px-5 rounded-[10px] text-[13px] font-semibold text-[#0f1419] bg-white hover:bg-[#e7e9ea] transition-colors"
      >
        ← {t("docsPage.notFoundBack")}
      </Link>

    </div>
  );
}
