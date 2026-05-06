// React hook around src/lib/shopify-prices.ts. Returns the current variant's
// price (in customer's market currency) plus a map of all (size,variant) →
// price for the active product, so deltas in the size/frame pickers also
// match Shopify exactly. Falls back to internal SEK pricing when Shopify
// hasn't responded yet (or fails).
import { useEffect, useMemo, useState } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { useShopContextStore } from "@/stores/shopContextStore";
import { getEffectiveSizes } from "@/lib/product-config";
import {
  getShopifyPrices,
  type ShopifyMoney,
} from "@/lib/shopify-prices";

export function useShopifyPriceMap() {
  const { config, template, productOptions } = useEditorStore();
  const country = useShopContextStore((s) => s.country) ?? "SE";
  const [map, setMap] = useState<Map<string, ShopifyMoney>>(new Map());

  // Build the (size,variant) combos to fetch from current product/template.
  // Använd getEffectiveSizes så att admin-byggda mallar (där config.sizes är
  // tom och storlekarna kommer från productOptions × pricing.ts) också får
  // riktiga Shopify-priser och därmed rätt valutasymbol.
  const combos = useMemo(() => {
    if (!config) return [] as Array<{ size: string; variant: string }>;
    const sizes = getEffectiveSizes(config, productOptions);
    const out: Array<{ size: string; variant: string }> = [];
    for (const s of sizes) {
      for (const v of s.variants ?? []) {
        out.push({ size: s.size, variant: v.name });
      }
    }
    return out;
  }, [config, productOptions]);

  useEffect(() => {
    if (!config || combos.length === 0) {
      setMap(new Map());
      return;
    }
    let cancelled = false;
    getShopifyPrices(config.shopify_handle, country, combos).then((m) => {
      if (!cancelled) setMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, [config, country, combos, productOptions, template]);

  return map;
}

/** Look up one specific (size,variant) price from a fetched map. */
export function priceFromMap(
  map: Map<string, ShopifyMoney>,
  size: string | null,
  variant: string | null,
): ShopifyMoney | null {
  if (!size || !variant) return null;
  return map.get(`${size}|${variant}`) ?? null;
}
