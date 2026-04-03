"use client";

import LanguageSwitcher from "@/components/i18n/LanguageSwitcher";
import { useLanguage } from "@/components/i18n/LanguageProvider";

export default function GlobalLoadingScreen() {
  const { t } = useLanguage();

  return (
    <div className="fixed inset-0 z-[120] overflow-hidden bg-[#050505] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,0.16),transparent_28%),radial-gradient(circle_at_84%_24%,rgba(36,92,255,0.26),transparent_26%),radial-gradient(circle_at_24%_18%,rgba(255,255,255,0.08),transparent_22%),linear-gradient(180deg,#090909_0%,#070707_46%,#030303_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.94)_0%,rgba(0,0,0,0.48)_28%,rgba(255,255,255,0.04)_50%,rgba(20,39,92,0.34)_100%)]" />
      <div className="x-loading-vignette absolute inset-0" />

      <div className="pointer-events-none absolute inset-0 opacity-90">
        <div className="x-loading-beam left-[12%] top-[-18%] h-[140%] w-[14vw]" />
        <div className="x-loading-beam x-loading-beam-delay-1 left-[38%] top-[-12%] h-[130%] w-[12vw]" />
        <div className="x-loading-beam x-loading-beam-delay-2 left-[56%] top-[-16%] h-[138%] w-[10vw]" />
        <div className="x-loading-beam x-loading-beam-delay-3 right-[4%] top-[-10%] h-[132%] w-[16vw]" />
      </div>

      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <LanguageSwitcher className="h-10 rounded-full border border-white/12 bg-white/[0.045] px-4 pr-4 text-xs font-semibold tracking-[0.06em] text-white/86 outline-none backdrop-blur-xl transition hover:border-white/22 hover:bg-white/[0.08] focus:border-white/28" />
      </div>

      <div className="relative flex min-h-screen items-center justify-center px-6">
        <div className="mx-auto flex w-full max-w-[900px] flex-col items-center text-center">
          <p className="x-loading-fade-up mb-6 text-[13px] font-semibold tracking-[0.12em] uppercase text-white/50">
            {t("loadingScreen.eyebrow")}
          </p>

          <h1 className="x-loading-fade-up x-loading-fade-up-delay w-full whitespace-nowrap text-center text-[clamp(1.6rem,4.2vw,3.6rem)] font-semibold leading-[1.0] tracking-[-0.04em] text-white">
            {t("loadingScreen.title")}
          </h1>

          <div className="x-loading-fade-up x-loading-fade-up-delay-2 mt-16 w-full max-w-[340px]">
            <div className="h-[6px] overflow-hidden rounded-full bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <div className="x-loading-progress h-full rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0.72)_48%,rgba(84,126,255,0.88)_100%)]" />
            </div>
            <p className="mt-4 text-[15px] text-white/62">{t("loadingScreen.status")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
