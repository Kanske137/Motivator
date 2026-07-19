// Fetches real, customer-facing prices from Shopify Storefront API using
// `@inContext(country: …)`. This is the only way to guarantee the editor
// displays the same amount the customer will pay in checkout — Shopify does
// the FX + rounding internally per market.
import { supabase } from "@/integrations/supabase/client";

export interface ShopifyMoney {
  amount: number;
  currencyCode: string;
}

// Shopify @inContext lokaliserar BÅDE pris och option-värden ("Utförande"→"Design",
// "Ingen"→"None" osv) — en marknad med engelsk översättning returnerar engelska
// option-värden även om vi ber om language:SV. För att kunna matcha varianter mot
// våra svenska källvärden hämtar vi DEM via en icke-kontextuell query, och priserna
// separat via @inContext. Variant-id är detsamma i båda — vi joinar på id.
// Shopify @inContext lokaliserar BÅDE pris och option-värden ("Utförande"→"Design",
// "Ingen"→"None" osv) — och kan bara appliceras på top-level query, inte på fält.
// Vi gör därför TVÅ separata queries: en utan kontext för källspråkets options
// (matchning), en med @inContext för priser. Variant-id är detsamma → join på id.
// Paginated: a consolidated product (poster+canvas+… under one Shopify product)
// can have hundreds of variants, so a single first:100 would silently truncate
// availability + prices. We page in 250s until pageInfo says done.
const SOURCE_QUERY = /* GraphQL */ `
  query ProductSource($handle: String!, $after: String) {
    productByHandle(handle: $handle) {
      variants(first: 250, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges { node { id selectedOptions { name value } } }
      }
    }
  }
`;

const CONTEXTUAL_QUERY = /* GraphQL */ `
  query ProductPrices($handle: String!, $country: CountryCode!, $after: String)
  @inContext(country: $country) {
    productByHandle(handle: $handle) {
      variants(first: 250, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges { node { id price { amount currencyCode } } }
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

function key(handle: string, country: string, shop: string | null) {
  return `${handle}|${country.toUpperCase()}|${shop ?? ""}`;
}

export function clearShopifyPriceCache() {
  cache.clear();
  inflight.clear();
}

async function fetchVariants(
  handle: string,
  country: string,
  shop: string | null,
): Promise<VariantNode[] | null> {
  const k = key(handle, country, shop);
  const cached = cache.get(k);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.variants;
  const existing = inflight.get(k);
  if (existing) return existing;

  // Page one storefront query to the end, returning every variant edge.
  const pageAll = async (query: string, extraVars: Record<string, unknown>): Promise<any[] | null> => {
    const edges: any[] = [];
    let after: string | null = null;
    // Safety bound: 250/page × 20 = 5000 variants, far above any real product.
    for (let page = 0; page < 20; page++) {
      const res = await supabase.functions.invoke("shopify-storefront", {
        body: { query, variables: { handle, ...extraVars, after }, shop },
      });
      if (res.error) {
        console.warn("[shopify-prices] proxy error", res.error?.message);
        return null;
      }
      const product = (res.data as any)?.data?.productByHandle;
      if (!product) return []; // no such product for this handle
      const v = product.variants;
      for (const e of v?.edges ?? []) edges.push(e);
      if (!v?.pageInfo?.hasNextPage) break;
      after = v.pageInfo.endCursor;
    }
    return edges;
  };

  const promise = (async () => {
    try {
      const [sourceEdges, contextEdges] = await Promise.all([
        pageAll(SOURCE_QUERY, {}),
        pageAll(CONTEXTUAL_QUERY, { country: country.toUpperCase() }),
      ]);
      if (sourceEdges === null || contextEdges === null) return null;
      if (sourceEdges.length === 0 || contextEdges.length === 0) {
        console.info(
          `[shopify-prices] no Shopify product for handle="${handle}" (country=${country}). ` +
          `Live prices will fall back to internal pricing.`,
        );
        cache.set(k, { ts: Date.now(), variants: [] });
        return [] as VariantNode[];
      }
      const priceById = new Map<string, { amount: string; currencyCode: string }>();
      for (const e of contextEdges) {
        if (e?.node?.id && e.node.price) priceById.set(e.node.id, e.node.price);
      }
      const variants: VariantNode[] = [];
      for (const e of sourceEdges) {
        const node = e?.node;
        const price = node?.id ? priceById.get(node.id) : null;
        if (node && price) {
          variants.push({ id: node.id, selectedOptions: node.selectedOptions ?? [], price });
        }
      }
      cache.set(k, { ts: Date.now(), variants });
      return variants;
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
    // Drop common ram-prefix the merchant might add in Shopify, but NEVER
    // strip "Hängare" — hängar-varianterna har egna priser i Shopify och måste
    // matchas distinkt från ram-varianterna med samma färg (Ek/Valnöt/...).
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
  shop: string | null,
): Promise<ShopifyMoney | null> {
  const variants = await fetchVariants(handle, country, shop);
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
  shop: string | null,
): Promise<Map<string, ShopifyMoney>> {
  const variants = await fetchVariants(handle, country, shop);
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
