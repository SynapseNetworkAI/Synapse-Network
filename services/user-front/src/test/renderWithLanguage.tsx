import { render, type RenderOptions } from "@testing-library/react";
import { createElement, type ReactElement } from "react";

import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY, type AppLanguage } from "@/i18n/config";

export function renderWithLanguage(
  ui: ReactElement,
  language: AppLanguage,
  options?: Omit<RenderOptions, "wrapper">
) {
  globalThis.localStorage.setItem(I18N_STORAGE_KEY, language);
  return render(createElement(LanguageProvider, null, ui), options);
}
