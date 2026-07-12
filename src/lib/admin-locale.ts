// Admin-side language selection. The customer editor picks its locale from the
// Shopify theme (useShopContextBootstrap); the admin/back-office is the merchant's
// own workspace, so it gets its own language choice. Default is English.
//
// For now the choice is persisted in localStorage (immediate, no infra). The
// intended follow-up is a per-installation default in the DB
// (shopify_app_installations.admin_locale), written via an edge function with the
// session-token guard — see the motiv-admin-language-selector memory.
import i18n from "@/i18n";

export type AdminLocale =
  | "en" | "sv" | "de" | "no" | "da" | "fi" | "fr" | "es" | "it" | "nl" | "pl";

/** The full set of admin languages, in display order. `label` is the language's
 *  own endonym so a merchant recognizes it regardless of the current UI language. */
export const ADMIN_LOCALES: { code: AdminLocale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "sv", label: "Svenska" },
  { code: "de", label: "Deutsch" },
  { code: "no", label: "Norsk" },
  { code: "da", label: "Dansk" },
  { code: "fi", label: "Suomi" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "it", label: "Italiano" },
  { code: "nl", label: "Nederlands" },
  { code: "pl", label: "Polski" },
];

const ADMIN_LOCALE_CODES = new Set(ADMIN_LOCALES.map((l) => l.code));
const STORAGE_KEY = "motiv.admin.locale";
export const DEFAULT_ADMIN_LOCALE: AdminLocale = "en";

function isAdminLocale(v: unknown): v is AdminLocale {
  return typeof v === "string" && ADMIN_LOCALE_CODES.has(v as AdminLocale);
}

/** The stored admin locale, or the English default. */
export function getStoredAdminLocale(): AdminLocale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isAdminLocale(v)) return v;
  } catch {
    /* localStorage unavailable (SSR / privacy mode) — fall through to default */
  }
  return DEFAULT_ADMIN_LOCALE;
}

/** Apply + persist the admin locale. Switches the live UI immediately. */
export function setAdminLocale(locale: AdminLocale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore persistence failure — still switch the live language below */
  }
  void i18n.changeLanguage(locale);
}

/** Call once on admin bootstrap to apply the stored (or default) language. */
export function applyStoredAdminLocale(): void {
  void i18n.changeLanguage(getStoredAdminLocale());
}
