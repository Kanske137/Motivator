// Backward-compat shim. The single source of truth for available variants is
// now `gelato-catalog.ts` (derived from gelato-sku-map.json).
import {
  getPosterSizes,
  getPosterFrames,
  getCanvasSizes,
  getCanvasDepths,
} from "./gelato-catalog";

export const DEFAULT_PRODUCT_VARIANTS = {
  poster: {
    get sizes() {
      return getPosterSizes();
    },
    get frames() {
      return getPosterFrames();
    },
  },
  canvas: {
    get sizes() {
      return getCanvasSizes();
    },
    get depths() {
      return getCanvasDepths();
    },
  },
} as const;

export type DefaultProductKind = "poster" | "canvas";

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
