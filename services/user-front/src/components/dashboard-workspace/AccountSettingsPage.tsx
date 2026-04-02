"use client";

import { useAccount } from "wagmi";
import { Globe2, ShieldCheck, Wallet } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";

export default function AccountSettingsPage() {
  const { t } = useLanguage();
  const { address, isConnected } = useAccount();

  return (
    <div className="mx-auto w-full max-w-[1040px] px-8 py-10">
      <div className="border-b border-white/8 pb-9">
        <h1 className="text-[43px] font-semibold tracking-[-0.04em] text-white">{t("accountSettingsPage.title")}</h1>
        <p className="mt-3 max-w-[760px] text-[18px] text-[#8b98b4]">{t("accountSettingsPage.description")}</p>
      </div>

      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        <section className="rounded-[22px] border border-white/8 bg-[#111214] px-6 py-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03] text-[#7ff7be]">
              <Wallet className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-white">{t("accountSettingsPage.identityTitle")}</h2>
              <p className="mt-1 text-[13px] text-white/42">{t("accountSettingsPage.connectedWallet")}</p>
            </div>
          </div>
          <p className="mt-5 text-[14px] leading-6 text-white/58">{t("accountSettingsPage.identityDescription")}</p>
          <div className="mt-5 rounded-[18px] border border-white/8 bg-black/20 px-4 py-3 text-[14px] font-medium text-white/88">
            {isConnected && address ? `${address.slice(0, 6)}...${address.slice(-4)}` : t("accountSettingsPage.notConnected")}
          </div>
        </section>

        <section className="rounded-[22px] border border-white/8 bg-[#111214] px-6 py-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03] text-[#7fb5ff]">
              <Globe2 className="h-5 w-5" />
            </span>
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-white">{t("accountSettingsPage.preferenceTitle")}</h2>
          </div>
          <p className="mt-5 text-[14px] leading-6 text-white/58">{t("accountSettingsPage.preferenceDescription")}</p>
        </section>

        <section className="rounded-[22px] border border-white/8 bg-[#111214] px-6 py-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03] text-[#f6c25b]">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-white">{t("accountSettingsPage.securityTitle")}</h2>
          </div>
          <p className="mt-5 text-[14px] leading-6 text-white/58">{t("accountSettingsPage.securityDescription")}</p>
        </section>
      </div>
    </div>
  );
}
