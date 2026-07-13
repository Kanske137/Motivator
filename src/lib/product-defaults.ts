// Backward-compat shim. Available variants come from the active POD provider's
// catalog via the PodProvider abstraction (which, for Gelato, derives them from
// gelato-sku-map.json). No component imports Gelato specifics directly anymore.
import { getPodProvider } from "./pod";

export const DEFAULT_PRODUCT_VARIANTS = {
  poster: {
    get sizes() {
      return getPodProvider().getKindSizes("poster");
    },
    get frames() {
      return getPodProvider().getKindVariants("poster");
    },
  },
  canvas: {
    get sizes() {
      return getPodProvider().getKindSizes("canvas");
    },
    get depths() {
      return getPodProvider().getKindVariants("canvas");
    },
  },
  aluminum: {
    get sizes() {
      return getPodProvider().getKindSizes("aluminum");
    },
    get materials() {
      return getPodProvider().getKindVariants("aluminum");
    },
  },
  acrylic: {
    get sizes() {
      return getPodProvider().getKindSizes("acrylic");
    },
    get finishes() {
      return getPodProvider().getKindVariants("acrylic");
    },
  },
} as const;

export type DefaultProductKind = "poster" | "canvas" | "aluminum" | "acrylic";

/** Union of values from config + defaults, preserving order (config first). */
export function mergeUnique(fromConfig: string[], fromDefaults: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...fromConfig, ...fromDefaults]) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
