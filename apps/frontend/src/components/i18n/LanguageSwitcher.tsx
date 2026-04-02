"use client";

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
        label: item.label,
      }))}
      triggerClassName={
        className ||
        "inline-flex h-8 min-w-[118px] items-center justify-between gap-3 rounded-md border border-[#3a3a3a] bg-transparent px-2 py-1 text-xs text-gray-200"
      }
      aria-label="Language"
    />
  );
}
