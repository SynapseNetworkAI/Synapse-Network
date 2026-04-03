"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_LANGUAGE,
  I18N_STORAGE_KEY,
  isSupportedLanguage,
  SUPPORTED_LANGUAGES,
  type AppLanguage,
} from "@/i18n/config";
import { translate, translateList } from "@/i18n/translate";

type LanguageContextValue = {
  lang: AppLanguage;
  setLang: (nextLang: AppLanguage) => void;
  t: (key: string, vars?: Record<string, string | number>, fallbackText?: string) => string;
  tList: (key: string) => string[];
  supportedLanguages: Array<{ code: AppLanguage; label: string }>;
};

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<AppLanguage>(() => {
    if (typeof window === "undefined") return DEFAULT_LANGUAGE;
    const stored = window.localStorage.getItem(I18N_STORAGE_KEY);
    if (isSupportedLanguage(stored)) {
      return stored;
    }

    const browserLang = window.navigator.language?.toLowerCase();
    if (browserLang?.startsWith("zh")) {
      return "zh";
    }

    return DEFAULT_LANGUAGE;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onStorage = (event: StorageEvent) => {
      if (event.key !== I18N_STORAGE_KEY) return;
      if (isSupportedLanguage(event.newValue)) {
        setLangState(event.newValue);
      }
    };

    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(I18N_STORAGE_KEY, lang);
    }
  }, [lang]);

  const value = useMemo<LanguageContextValue>(() => ({
    lang,
    setLang: (nextLang: AppLanguage) => setLangState(nextLang),
    t: (key, vars, fallbackText) => translate(lang, key, vars, fallbackText),
    tList: (key) => translateList(lang, key),
    supportedLanguages: SUPPORTED_LANGUAGES,
  }), [lang]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return context;
}
