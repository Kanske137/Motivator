// Centralized price formatter. SEK is our internal source of truth (pricing.ts);
// we convert with Shopify's own multi-currency rate so what the editor shows
// matches what the storefront shows the same customer in their currency.
import type { ShopContext } from "@/stores/shopContextStore";

// Currencies that customarily display without decimals on Shopify storefronts.
// Everything else gets the locale-default (typically 2 decimals).
const ZERO_DECIMAL_CURRENCIES = new Set(["SEK", "NOK", "DKK", "ISK", "JPY", "HUF"]);

/**
 * Format a SEK amount into the customer's currency + locale.
 * Mirrors Shopify's own conversion: amount * rate, rounded to currency norms.
 */
export function formatPrice(sekAmount: number, ctx: ShopContext): string {
  // Säkerhetsnät: om kunden har en annan valuta än SEK men temat inte skickade
  // en växelkurs (rate=1) skulle vi annars visa SEK-talet med fel symbol
  // (t.ex. "199 €"). Visa då i SEK istället tills Shopify-priser hinner laddas.
  const safeCurrency = ctx.currency !== "SEK" && (!ctx.rate || ctx.rate === 1) ? "SEK" : ctx.currency;
  const safeLocale = safeCurrency === "SEK" ? "sv" : ctx.locale;
  const decimals = ZERO_DECIMAL_CURRENCIES.has(safeCurrency) ? 0 : 2;
  const converted = safeCurrency === "SEK" ? sekAmount : sekAmount * (ctx.rate || 1);
  try {
    return new Intl.NumberFormat(safeLocale, {
      style: "currency",
      currency: safeCurrency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(converted);
  } catch {
    // Fallback if locale/currency code is unsupported by the runtime.
    return `${converted.toFixed(decimals)} ${safeCurrency}`;
  }
}

/**
 * Format a price difference (e.g. "+99 kr", "−50 €") shown next to size/frame
 * options. Sign-prefixed; uses the customer's currency.
 */
export function formatPriceDelta(sekDiff: number, ctx: ShopContext): string {
  if (Math.abs(sekDiff * (ctx.rate || 1)) < 0.005) {
    // Treat near-zero as zero to avoid "+0,00 kr" noise.
    const zero = formatPrice(0, ctx);
    return `+${zero}`;
  }
  const abs = formatPrice(Math.abs(sekDiff), ctx);
  return sekDiff > 0 ? `+${abs}` : `−${abs}`;
}

/**
 * Format an arbitrary money amount (already in the target currency, e.g. from
 * Shopify's cart response). Used in CartDrawer where we don't convert.
 */
export function formatMoney(amount: number, currency: string, locale: string): string {
  const decimals = ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount);
  } catch {
    return `${amount.toFixed(decimals)} ${currency}`;
  }
}

/**
 * Format a delta between two amounts already in the same currency
 * (e.g. both from Shopify). Sign-prefixed.
 */
export function formatMoneyDelta(diff: number, currency: string, locale: string): string {
  if (Math.abs(diff) < 0.005) {
    return `+${formatMoney(0, currency, locale)}`;
  }
  const abs = formatMoney(Math.abs(diff), currency, locale);
  return diff > 0 ? `+${abs}` : `−${abs}`;
}
