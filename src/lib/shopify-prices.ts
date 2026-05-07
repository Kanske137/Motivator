// Fetches real, customer-facing prices from Shopify Storefront API using
// `@inContext(country: …)`. This is the only way to guarantee the editor
// displays the same amount the customer will pay in checkout — Shopify does
// the FX + rounding internally per market.
import { supabase } from "@/integrations/supabase/client";

export interface ShopifyMoney {
  amount: number;
  currencyCode: string;
}

const PRODUCT_PRICES_QUERY = /* GraphQL */ `
  query ProductPrices($handle: String!, $country: CountryCode!) @inContext(country: $country) {
    productByHandle(handle: $handle) {
      variants(first: 100) {
        edges {
          node {
            id
            selectedOptions { name value }
            price { amount currencyCode }
          }
        }
      }
    }
  }
`;

interface VariantNode {
  id: string;
  selectedOptions: Array<{ name: string; value: string }>;
  price: { amount: string; currencyCode: string };
}

interface CacheEntry {
  ts: number;
  variants: VariantNode[];
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<VariantNode[] | null>>();

function key(handle: string, country: string) {
  return `${handle}|${country.toUpperCase()}`;
}

export function clearShopifyPriceCache() {
  cache.clear();
  inflight.clear();
}

async function fetchVariants(handle: string, country: string): Promise<VariantNode[] | null> {
  const k = key(handle, country);
  const cached = cache.get(k);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.variants;
  const existing = inflight.get(k);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke("shopify-storefront", {
        body: {
          query: PRODUCT_PRICES_QUERY,
          variables: { handle, country: country.toUpperCase() },
        },
      });
      if (error) {
        console.warn("[shopify-prices] proxy error", error.message);
        return null;
      }
      const product = (data as any)?.data?.productByHandle;
      if (!product) {
        console.info(
          `[shopify-prices] no Shopify product for handle="${handle}" (country=${country}). ` +
          `Live prices will fall back to internal SEK pricing.`,
        );
      }
      const variants = product?.variants?.edges?.map((e: any) => e.node) ?? [];
      cache.set(k, { ts: Date.now(), variants });
      return variants as VariantNode[];
    } catch (e) {
      console.warn("[shopify-prices] failed", e);
      return null;
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, promise);
  return promise;
}

function normalize(s: string) {
  return s
    .toLowerCase()
    // Strip diacritics so "valnöt" matches "valnot", "hängare" matches "hangare".
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Drop common variant-name prefixes the merchant might add in Shopify.
    .replace(/^h(a|ä)ngare\s+(i\s+)?/i, "")
    .replace(/^ram\s+(i\s+)?/i, "")
    .replace(/^ramad\s+/i, "")
    // Unify "x", "X" and the real multiplication sign "×" so size strings match.
    .replace(/[×x]/g, "x")
    .replace(/\s*cm\s*$/i, "")
    .replace(/\s+/g, "")
    .trim();
}

function findVariant(
  variants: VariantNode[],
  size: string,
  variantName: string,
): VariantNode | null {
  const sizeN = normalize(size);
  const variantN = normalize(variantName);
  for (const v of variants) {
    const opts = v.selectedOptions ?? [];
    const sizeMatch = opts.some((o) => normalize(o.value) === sizeN);
    const variantMatch = opts.some((o) => normalize(o.value) === variantN);
    if (sizeMatch && variantMatch) return v;
  }
  return null;
}

/** Get price for a single (size, variant) in the customer's market. */
export async function getShopifyPrice(
  handle: string,
  country: string,
  size: string,
  variantName: string,
): Promise<ShopifyMoney | null> {
  const variants = await fetchVariants(handle, country);
  if (!variants) return null;
  const v = findVariant(variants, size, variantName);
  if (!v) return null;
  return { amount: parseFloat(v.price.amount), currencyCode: v.price.currencyCode };
}

/** Get prices for many (size, variant) pairs in one call. Map keys = "size|variant". */
export async function getShopifyPrices(
  handle: string,
  country: string,
  combos: Array<{ size: string; variant: string }>,
): Promise<Map<string, ShopifyMoney>> {
  const variants = await fetchVariants(handle, country);
  const out = new Map<string, ShopifyMoney>();
  if (!variants) return out;
  for (const c of combos) {
    const v = findVariant(variants, c.size, c.variant);
    if (v) {
      out.set(`${c.size}|${c.variant}`, {
        amount: parseFloat(v.price.amount),
        currencyCode: v.price.currencyCode,
      });
    }
  }
  return out;
}
