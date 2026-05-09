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

/** Maps internal product types to the Swedish "Produkttyp"-värde som
 *  konsoliderade Shopify-produkter använder. */
const PRODUCT_TYPE_LABEL: Record<string, string> = {
  posters: "Poster",
  poster: "Poster",
  canvas: "Canvas",
  aluminum: "Metallposter",
  acrylic: "Plexiglas",
};

function cacheKey(handle: string, size: string, variant: string, productType?: string) {
  return `${handle}|${size}|${variant}|${productType ?? ""}`;
}

export function clearVariantResolverCache() {
  cache.clear();
}

const normalize = (s: string) =>
  s.toLowerCase().replace(/\s*cm\s*$/i, "").replace(/\s+/g, "").trim();

/**
 * Match a variant whose selectedOptions contain BOTH size and variant
 * (frame/depth/finish), and — if productType supplied — also the
 * "Produkttyp" option (Poster/Canvas/Metallposter/Plexiglas).
 */
function findMatchingVariant(
  variants: VariantNode[],
  size: string,
  variant: string,
  productTypeLabel: string | null,
): string | null {
  const sizeN = normalize(size);
  const variantN = normalize(variant);
  const typeN = productTypeLabel ? normalize(productTypeLabel) : null;

  for (const v of variants) {
    const opts = v.selectedOptions ?? [];
    const sizeMatch = opts.some((o) => normalize(o.value) === sizeN);
    const variantMatch = opts.some((o) => normalize(o.value) === variantN);
    if (!sizeMatch || !variantMatch) continue;
    if (typeN) {
      const typeMatch = opts.some((o) => normalize(o.value) === typeN);
      if (!typeMatch) continue;
    }
    return v.id;
  }
  return null;
}

/** Resolve a real Shopify variant ID. Returns null if not found / unavailable.
 *  `productType` (intern slug: posters/canvas/aluminum/acrylic) bör skickas för
 *  konsoliderade produkter så vi matchar rätt Produkttyp-axel. */
export async function resolveShopifyVariantId(
  handle: string,
  size: string,
  variant: string,
  productType?: string,
): Promise<string | null> {
  const productTypeLabel = productType ? PRODUCT_TYPE_LABEL[productType] ?? null : null;
  const key = cacheKey(handle, size, variant, productType);
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

    let id = findMatchingVariant(variants, size, variant, productTypeLabel);
    // Fallback: legacy 2-option product utan Produkttyp-axel.
    if (!id && productTypeLabel) {
      id = findMatchingVariant(variants, size, variant, null);
    }
    cache.set(key, { id, ts: Date.now() });
    return id;
  } catch (e) {
    console.warn("[variant-resolver] failed", e);
    return null;
  }
}
