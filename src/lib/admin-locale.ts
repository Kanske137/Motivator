// Admin-side language selection. The customer editor picks its locale from the
// Shopify theme (useShopContextBootstrap); the admin/back-office is the merchant's
// own workspace, so it gets its own language choice. Default is English.
//
// The choice is cached in localStorage (instant, no flash) AND persisted
// per-installation in the DB (shopify_app_installations.admin_locale) via the
// session-token-guarded `admin-settings` edge function — so it follows the
// merchant across devices/browsers and staff. localStorage is the fast cache;
// the DB is the cross-device source of truth, reconciled on admin bootstrap.
import i18n from "@/i18n";
import { invokeAdmin } from "@/lib/admin-api";

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

/** Apply + persist the admin locale. Switches the live UI immediately, caches to
 *  localStorage, and writes through to the DB (best-effort — the write is skipped
 *  gracefully when there's no App Bridge session, e.g. local dev). */
export function setAdminLocale(locale: AdminLocale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore persistence failure — still switch the live language below */
  }
  void i18n.changeLanguage(locale);
  void persistServerAdminLocale(locale);
}

/** Write the locale to the DB via the guarded edge function. Best-effort: no-ops
 *  when there's no Shopify session token (non-embedded contexts) or on error. */
async function persistServerAdminLocale(locale: AdminLocale): Promise<void> {
  try {
    await invokeAdmin("locale-set", { locale }, "admin-settings");
  } catch {
    /* not embedded / offline — localStorage still holds the choice */
  }
}

/** Reconcile the live language with the DB (cross-device source of truth). Called
 *  after the instant localStorage apply. No-ops without a session token. */
async function syncAdminLocaleFromServer(): Promise<void> {
  try {
    const res = await invokeAdmin<{ ok: true; locale: string | null }>(
      "locale-get",
      {},
      "admin-settings",
    );
    const loc = res.locale;
    if (loc && isAdminLocale(loc)) {
      try {
        localStorage.setItem(STORAGE_KEY, loc);
      } catch {
        /* ignore cache write failure */
      }
      void i18n.changeLanguage(loc);
    }
  } catch {
    /* not embedded / offline — keep the localStorage/default language */
  }
}

/** Call once on admin bootstrap: apply the cached language instantly (no flash),
 *  then reconcile with the DB in the background. */
export function applyStoredAdminLocale(): void {
  void i18n.changeLanguage(getStoredAdminLocale());
  void syncAdminLocaleFromServer();
}
