// Backward-compat shim. The single source of truth for available variants is
// now `gelato-catalog.ts` (derived from gelato-sku-map.json).
import {
  getPosterSizes,
  getPosterFrames,
  getCanvasSizes,
  getCanvasDepths,
  getAluminumSizes,
  getAluminumMaterials,
  getAcrylicSizes,
  getAcrylicFinishes,
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
  aluminum: {
    get sizes() {
      return getAluminumSizes();
    },
    get materials() {
      return getAluminumMaterials();
    },
  },
  acrylic: {
    get sizes() {
      return getAcrylicSizes();
    },
    get finishes() {
      return getAcrylicFinishes();
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
