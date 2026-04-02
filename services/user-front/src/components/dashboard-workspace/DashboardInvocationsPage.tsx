"use client";

import dynamic from "next/dynamic";
import { History } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";

const DashboardInvocationsContent = dynamic(
  () => import("@/components/dashboard-workspace/DashboardInvocationsContent"),
  {
    ssr: false,
    loading: () => <InvocationsLoadingShell />,
  }
);

function InvocationsLoadingShell() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="h-[42px] w-full max-w-[420px] animate-pulse rounded-xl bg-white/[0.06]" />
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="h-[42px] w-full min-w-[280px] animate-pulse rounded-xl bg-white/[0.06]" />
          <div className="h-[42px] w-[168px] animate-pulse rounded-xl bg-white/[0.06]" />
          <div className="h-[42px] w-[96px] animate-pulse rounded-xl bg-white/[0.06]" />
          <div className="h-[42px] w-[96px] animate-pulse rounded-xl bg-white/[0.04]" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-5"
          >
            <div className="h-3 w-24 animate-pulse rounded-full bg-white/[0.08]" />
            <div className="mt-4 h-9 w-16 animate-pulse rounded-full bg-white/[0.1]" />
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#222222] bg-[#0a0a0a]">
        <div className="grid grid-cols-5 gap-4 border-b border-[#222222] bg-[#050505] px-6 py-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-3 animate-pulse rounded-full bg-white/[0.08]" />
          ))}
        </div>
        <div className="space-y-3 px-6 py-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="grid grid-cols-5 gap-4">
              {Array.from({ length: 5 }).map((__, cellIndex) => (
                <div
                  key={cellIndex}
                  className="h-5 animate-pulse rounded-full bg-white/[0.05]"
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function InvocationsPage() {
  const { t } = useLanguage();

  return (
    <div className="mx-auto min-h-screen max-w-7xl space-y-6 bg-[#000000] p-6 text-white md:p-10">
      <div className="flex flex-col justify-between gap-4 border-b border-[#222222] pb-5 md:flex-row md:items-center">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-[800] tracking-tight text-white md:text-4xl">
            <History className="h-8 w-8 text-[#22c55e]" />
            {t("invocationsPage.title")}
          </h1>
          <p className="mt-2 text-sm text-[#86868b]">
            {t("invocationsPage.description")}
          </p>
        </div>
      </div>

      <DashboardInvocationsContent />
    </div>
  );
}
