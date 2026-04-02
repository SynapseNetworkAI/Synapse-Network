"use client";

import { Globe2 } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import XSelect from "@/components/xui/XSelect";

type LanguageSwitcherProps = {
  className?: string;
};

export default function LanguageSwitcher({ className }: Readonly<LanguageSwitcherProps>) {
  const { lang, setLang, supportedLanguages } = useLanguage();

  return (
    <XSelect
      value={lang}
      onChange={(value) => setLang(value as typeof lang)}
      options={supportedLanguages.map((item) => ({
        value: item.code,
        label: item.code === "en" ? "English" : item.label,
      }))}
      leadingIcon={<Globe2 className="h-[15px] w-[15px] text-[#71767b]" />}
      triggerClassName={
        className ||
        "inline-flex h-[36px] min-w-[121px] items-center justify-between whitespace-nowrap rounded-full border border-[#2f3336] bg-[#16181c] px-[14px] pr-[11px] text-[15px] font-normal leading-none text-[#e7e9ea]"
      }
      contentClassName="flex min-w-0 flex-1 items-center gap-[9px] overflow-hidden whitespace-nowrap leading-none"
      chevronClassName="ml-[8px] h-[14px] w-[14px] self-center text-[#71767b]"
      aria-label="Language"
    />
  );
}
