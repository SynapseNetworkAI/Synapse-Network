"use client";

import { useLanguage } from "@/components/i18n/LanguageProvider";

type LanguageSwitcherProps = {
  className?: string;
};

export default function LanguageSwitcher({ className }: LanguageSwitcherProps) {
  const { lang, setLang, supportedLanguages } = useLanguage();

  return (
    <select
      value={lang}
      onChange={(event) => setLang(event.target.value as typeof lang)}
      className={className || "bg-transparent border border-[#3a3a3a] text-xs text-gray-200 rounded-md px-2 py-1 focus:outline-none focus:border-white"}
      aria-label="Language"
    >
      {supportedLanguages.map((item) => (
        <option key={item.code} value={item.code} className="bg-black">
          {item.label}
        </option>
      ))}
    </select>
  );
}
