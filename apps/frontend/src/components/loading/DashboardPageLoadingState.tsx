"use client";

import { useLanguage } from "@/components/i18n/LanguageProvider";

const COPY = {
  en: {
    eyebrow: "Workspace transition",
    title: "Preparing the next control surface",
    status: "Rendering the page shell first, then streaming data into place.",
  },
  zh: {
    eyebrow: "工作台切换中",
    title: "先切页面，再把数据逐步加载进来",
    status: "界面壳体会先响应，数据随后补齐，避免侧栏点击卡住。",
  },
} as const;

type DashboardPageLoadingStateProps = {
  mode?: "page" | "overlay";
};

export default function DashboardPageLoadingState({
  mode = "page",
}: Readonly<DashboardPageLoadingStateProps>) {
  const { lang } = useLanguage();
  const copy = COPY[lang] ?? COPY.en;
  const isOverlay = mode === "overlay";

  return (
    <div
      className={
        isOverlay
          ? "pointer-events-none absolute inset-0 z-20 bg-[#050505]/92 backdrop-blur-sm"
          : "min-h-[calc(100vh-60px)] bg-[#050505]"
      }
      aria-live="polite"
      aria-busy="true"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(29,155,240,0.12),transparent_34%),linear-gradient(180deg,rgba(9,9,9,0.96)_0%,rgba(5,5,5,1)_100%)]" />

      <div className="relative mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 py-10 lg:px-10">
        <div className="max-w-[680px] animate-pulse">
          <div className="mb-4 h-4 w-40 rounded-full bg-white/[0.08]" />
          <div className="h-10 w-[min(540px,80vw)] rounded-full bg-white/[0.12]" />
          <div className="mt-5 h-5 w-[min(620px,88vw)] rounded-full bg-white/[0.07]" />
        </div>

        <div className="mt-10 flex flex-col gap-6 xl:flex-row">
          <div className="min-w-0 flex-1">
            <div className="rounded-[28px] border border-white/[0.06] bg-white/[0.025] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-[22px] border border-white/[0.05] bg-white/[0.03] p-5 animate-pulse">
                  <div className="h-3 w-20 rounded-full bg-white/[0.09]" />
                  <div className="mt-5 h-9 w-36 rounded-full bg-white/[0.14]" />
                  <div className="mt-6 h-24 rounded-[18px] bg-white/[0.05]" />
                </div>
                <div className="rounded-[22px] border border-white/[0.05] bg-white/[0.03] p-5 animate-pulse">
                  <div className="h-3 w-24 rounded-full bg-white/[0.09]" />
                  <div className="mt-5 h-9 w-28 rounded-full bg-white/[0.14]" />
                  <div className="mt-6 h-24 rounded-[18px] bg-white/[0.05]" />
                </div>
              </div>

              <div className="mt-6 rounded-[24px] border border-white/[0.05] bg-[#0b0d10] p-5 animate-pulse">
                <div className="h-3 w-28 rounded-full bg-white/[0.08]" />
                <div className="mt-4 h-4 w-[72%] rounded-full bg-white/[0.05]" />
                <div className="mt-2 h-4 w-[54%] rounded-full bg-white/[0.05]" />
                <div className="mt-6 h-32 rounded-[18px] bg-white/[0.04]" />
              </div>
            </div>
          </div>

          <div className="w-full xl:max-w-[320px]">
            <div className="rounded-[28px] border border-white/[0.06] bg-white/[0.025] p-6 animate-pulse">
              <div className="h-3 w-24 rounded-full bg-white/[0.09]" />
              <div className="mt-4 h-8 w-40 rounded-full bg-white/[0.12]" />
              <div className="mt-8 space-y-3">
                <div className="h-12 rounded-[16px] bg-white/[0.05]" />
                <div className="h-12 rounded-[16px] bg-white/[0.05]" />
                <div className="h-12 rounded-[16px] bg-white/[0.05]" />
              </div>
            </div>
          </div>
        </div>

        <div className="relative mt-10 max-w-[720px]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/48">
            {copy.eyebrow}
          </p>
          <p className="mt-3 text-[22px] font-semibold leading-[1.15] tracking-[-0.03em] text-white/92 sm:text-[28px]">
            {copy.title}
          </p>
          <p className="mt-3 max-w-[60ch] text-[14px] leading-6 text-white/56 sm:text-[15px]">
            {copy.status}
          </p>
        </div>
      </div>
    </div>
  );
}