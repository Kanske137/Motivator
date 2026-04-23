// Resolves a Shopify variant ID for a product handle + size/variant selection
// via the Storefront API (proxied through the `shopify-storefront` edge fn).
// Used in the editor to ensure "Add to cart" pushes a REAL variant ID rather
// than a synthetic placeholder string. Caches by (handle,size,variant).
import { supabase } from "@/integrations/supabase/client";

interface ProductOptionInput {
  name: string;
  value: string;
}

interface VariantNode {
  id: string;
  selectedOptions: ProductOptionInput[];
}

interface ProductByHandleResponse {
  data?: {
    productByHandle: {
      variants: { edges: Array<{ node: VariantNode }> };
    } | null;
  };
}

const PRODUCT_VARIANTS_QUERY = /* GraphQL */ `
  query ProductVariants($handle: String!) {
    productByHandle(handle: $handle) {
      variants(first: 100) {
        edges {
          node {
            id
            selectedOptions { name value }
          }
        }
      }
    }
  }
`;

const cache = new Map<string, { id: string | null; ts: number }>();
const TTL_MS = 5 * 60 * 1000;

function cacheKey(handle: string, size: string, variant: string) {
  return `${handle}|${size}|${variant}`;
}

/**
 * Find a variant whose selectedOptions match BOTH size and variant value
 * (variant = frame name for posters / depth for canvas). Matching is case-
 * insensitive and tolerates whitespace + the trailing " cm" Shopify often
 * uses (e.g. "30x40" vs "30x40 cm").
 */
function findMatchingVariant(
  variants: VariantNode[],
  size: string,
  variant: string,
): string | null {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/\s*cm\s*$/i, "").replace(/\s+/g, "").trim();

  const sizeN = normalize(size);
  const variantN = normalize(variant);

  for (const v of variants) {
    const opts = v.selectedOptions ?? [];
    const sizeMatch = opts.some((o) => normalize(o.value) === sizeN);
    const variantMatch = opts.some((o) => normalize(o.value) === variantN);
    if (sizeMatch && variantMatch) return v.id;
  }
  return null;
}

/** Resolve a real Shopify variant ID. Returns null if not found / unavailable. */
export async function resolveShopifyVariantId(
  handle: string,
  size: string,
  variant: string,
): Promise<string | null> {
  const key = cacheKey(handle, size, variant);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.id;

  try {
    const { data, error } = await supabase.functions.invoke("shopify-storefront", {
      body: {
        query: PRODUCT_VARIANTS_QUERY,
        variables: { handle },
      },
    });
    if (error) {
      console.warn("[variant-resolver] proxy error", error.message);
      cache.set(key, { id: null, ts: Date.now() });
      return null;
    }

    const payload = data as ProductByHandleResponse;
    const variants = payload?.data?.productByHandle?.variants?.edges?.map((e) => e.node) ?? [];
    if (variants.length === 0) {
      cache.set(key, { id: null, ts: Date.now() });
      return null;
    }

    const id = findMatchingVariant(variants, size, variant);
    cache.set(key, { id, ts: Date.now() });
    return id;
  } catch (e) {
    console.warn("[variant-resolver] failed", e);
    return null;
  }
}
