// Reads the Shopify theme's locale/currency/rate/country once at app mount via
// URL query-params, then keeps listening for `SHOP_CONTEXT` postMessages so
// the customer can change language/currency on the parent page without a reload.
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { normalizeLocale, useShopContextStore } from "@/stores/shopContextStore";

export function useShopContextBootstrap() {
  const setContext = useShopContextStore((s) => s.setContext);
  const { i18n } = useTranslation();

  useEffect(() => {
    // 1) URL query-params (set by the theme snippet on iframe src).
    const params = new URLSearchParams(window.location.search);
    const queryLocale = params.get("locale");
    const queryCurrency = params.get("currency");
    const queryRate = parseFloat(params.get("rate") ?? "");
    const queryCountry = params.get("country");

    // Fallback to navigator.language outside the iframe.
    const fallbackLocale = window.self === window.top ? navigator.language : null;

    const initialLocale = normalizeLocale(queryLocale ?? fallbackLocale);
    const initialCurrency = queryCurrency || "SEK";
    const initialRate = Number.isFinite(queryRate) && queryRate > 0 ? queryRate : 1;

    setContext({
      locale: initialLocale,
      currency: initialCurrency,
      rate: initialRate,
      country: queryCountry || "SE",
    });
    void i18n.changeLanguage(initialLocale);

    // 2) Live updates from the parent theme.
    const onMessage = (e: MessageEvent) => {
      const d = e.data;
      if (!d || typeof d !== "object" || d.type !== "SHOP_CONTEXT") return;
      const next = {
        locale: normalizeLocale(d.locale),
        currency: typeof d.currency === "string" ? d.currency : "SEK",
        rate: typeof d.rate === "number" && d.rate > 0 ? d.rate : 1,
        country: typeof d.country === "string" ? d.country : null,
      };
      setContext(next);
      void i18n.changeLanguage(next.locale);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [setContext, i18n]);
}
