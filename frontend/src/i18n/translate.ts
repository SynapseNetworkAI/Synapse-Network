import { DEFAULT_LANGUAGE, type AppLanguage } from "@/i18n/config";
import { I18N_RESOURCES } from "@/i18n/resources";

function readByPath(source: unknown, key: string): unknown {
  if (!key) return source;
  return key.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, source);
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, token: string) => {
    const value = vars[token];
    return value === undefined ? "" : String(value);
  });
}

export function translate(
  lang: AppLanguage,
  key: string,
  vars?: Record<string, string | number>,
  fallbackText?: string,
): string {
  const primary = readByPath(I18N_RESOURCES[lang], key);
  if (typeof primary === "string") {
    return interpolate(primary, vars);
  }

  const fallback = readByPath(I18N_RESOURCES[DEFAULT_LANGUAGE], key);
  if (typeof fallback === "string") {
    return interpolate(fallback, vars);
  }

  return fallbackText || key;
}

export function translateList(lang: AppLanguage, key: string): string[] {
  const primary = readByPath(I18N_RESOURCES[lang], key);
  if (Array.isArray(primary) && primary.every((item) => typeof item === "string")) {
    return primary as string[];
  }

  const fallback = readByPath(I18N_RESOURCES[DEFAULT_LANGUAGE], key);
  if (Array.isArray(fallback) && fallback.every((item) => typeof item === "string")) {
    return fallback as string[];
  }

  return [];
}
