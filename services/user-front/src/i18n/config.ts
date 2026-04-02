export type AppLanguage = "en" | "zh";

export const I18N_STORAGE_KEY = "synapse_lang";
export const DEFAULT_LANGUAGE: AppLanguage = "en";

export const SUPPORTED_LANGUAGES: Array<{ code: AppLanguage; label: string }> = [
  { code: "en", label: "EN" },
  { code: "zh", label: "ZH" },
];

export function isSupportedLanguage(value: unknown): value is AppLanguage {
  return value === "en" || value === "zh";
}
