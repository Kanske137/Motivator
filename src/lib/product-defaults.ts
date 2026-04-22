// Standard variant catalog per product type. Used by ProductOptionsSection
// so the admin always sees a sane list of sizes/frames/depths even when the
// underlying ProductConfig only contains data for one of the types.
//
// NOTE: These names must eventually map to Gelato SKUs in `gelato_sku_map`
// before the template can be published. Validation enforces this elsewhere.

export const DEFAULT_PRODUCT_VARIANTS = {
  poster: {
    sizes: ["13x18", "21x30", "30x40", "50x70", "70x100"] as string[],
    frames: ["Ingen", "Vit", "Svart", "Ek", "Valnöt"] as string[],
  },
  canvas: {
    sizes: ["30x40", "50x70", "60x90", "70x100"] as string[],
    depths: ["2cm", "4cm"] as string[],
  },
} as const;

export type DefaultProductKind = keyof typeof DEFAULT_PRODUCT_VARIANTS;

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
