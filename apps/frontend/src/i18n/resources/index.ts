import type { AppLanguage } from "@/i18n/config";
import type { I18nMessages } from "@/i18n/schema";
import en from "@/i18n/resources/en";
import zh from "@/i18n/resources/zh";

export const I18N_RESOURCES: Record<AppLanguage, I18nMessages> = {
  en,
  zh,
};
