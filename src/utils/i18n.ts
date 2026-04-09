import type { Locale } from "../types";

export function tx(locale: Locale, zh: string, en: string): string {
  return locale === "zh" ? zh : en;
}
