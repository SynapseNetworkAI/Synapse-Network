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
        label: item.label,
      }))}
      leadingIcon={<Globe2 className="h-4 w-4 text-white/52" />}
      triggerClassName={
        className ||
        "inline-flex h-8 min-w-[118px] items-center justify-between gap-3 whitespace-nowrap rounded-md border border-[#3a3a3a] bg-transparent px-2 py-1 text-xs text-gray-200"
      }
      aria-label="Language"
    />
  );
}
