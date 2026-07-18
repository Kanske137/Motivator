// Product presets (Phase 3b) — merchant-facing products composed from one or
// more provider catalogs.
//
// The problem this solves: a merchant sells ONE "Poster" that can be plain,
// framed (black/white/oak/walnut) or on a hanger. But Gelato splits those across
// THREE catalogs — `posters` (flat), `mounted-framed-posters`, `hanging-posters`.
// A preset keeps it a single product with a friendly "Ram" axis whose values map
// to the right catalog + attribute filters under the hood. This formalizes what
// the hardcoded `gelato-sku-map.json` did — but as data, so it can be maintained
// and expanded (e.g. offer more paper types) instead of frozen in code.
//
// A single-catalog product (a mug) is just the trivial case: one catalog, axes =
// its own attributes (the existing "base" path already handles those). Presets
// are the curated, cross-catalog generalization.
//
// Pure (no Deno / esm.sh imports) so it is unit-testable from vitest.

/** A merchant/customer-facing option value on a preset axis. */
export interface PresetValue {
  key: string; // stable value key, e.g. "Ek" or "21x30"
  label: string; // shown to the merchant + customer
}

export interface PresetAxis {
  key: string; // "frame" | "size" | "paper"
  label: string; // "Ram" | "Storlek" | "Papper"
  values: PresetValue[];
  /** Value keys offered by default when a merchant enables the preset. When
   *  omitted, all values are default-on. */
  defaultValues?: string[];
}

/** The provider target a specific variant-combo resolves to. */
export interface PresetResolution {
  catalog: string; // Gelato catalogUid to search in
  filters: Record<string, string[]>; // attributeFilters that pin one product
}

export interface ProductPreset {
  id: string; // "poster"
  title: string;
  provider: string; // "gelato"
  axes: PresetAxis[];
  /**
   * Map ONE selected value per axis (keyed by axis.key) to the provider catalog
   * + attribute filters that pin a single product. Returns null for a
   * combination that has no product (e.g. a paper type a given frame doesn't
   * offer) — the caller skips it. This is where cross-catalog composition lives.
   */
  resolve(selection: Record<string, string>): PresetResolution | null;
}

// --- Poster preset -----------------------------------------------------------
//
// Composes three Gelato catalogs behind one "Ram" axis. Grounded in the live
// catalog attributes (verified): mounted-framed-posters has FrameColor
// {black,white,natural-wood,dark-wood,gold,silver,copper} × FrameMaterial
// {wood,aluminum}; the 21×30 framed size uses PaperFormat "A4" (a real quirk).

/** Ram value → which catalog + frame filters it selects. */
const POSTER_FRAME: Record<string, PresetResolution> = {
  Ingen: { catalog: "posters", filters: {} },
  Svart: { catalog: "mounted-framed-posters", filters: { FrameColor: ["black"], FrameMaterial: ["wood"] } },
  Vit: { catalog: "mounted-framed-posters", filters: { FrameColor: ["white"], FrameMaterial: ["wood"] } },
  Ek: { catalog: "mounted-framed-posters", filters: { FrameColor: ["natural-wood"], FrameMaterial: ["wood"] } },
  Valnöt: { catalog: "mounted-framed-posters", filters: { FrameColor: ["dark-wood"], FrameMaterial: ["wood"] } },
  // TODO(hanger): "Hängare Vit/Svart/Ek/Valnöt" → catalog "hanging-posters"
  // once its hanger-colour attribute is mapped. Left out here so the resolver
  // never returns a wrong SKU for a hanger; added in the next slice.
};

/** Size key → PaperFormat value PER catalog (framed 21×30 is "A4", not mm). */
const POSTER_FORMAT: Record<string, Record<string, string>> = {
  "13x18": { posters: "130x180-mm", "mounted-framed-posters": "130x180-mm" },
  "21x30": { posters: "210x300-mm", "mounted-framed-posters": "A4" },
  "30x40": { posters: "300x400-mm", "mounted-framed-posters": "300x400-mm" },
  "40x50": { posters: "400x500-mm", "mounted-framed-posters": "400x500-mm" },
  "50x70": { posters: "500x700-mm", "mounted-framed-posters": "500x700-mm" },
  "70x100": { posters: "700x1000-mm", "mounted-framed-posters": "700x1000-mm" },
};

/** Default paper — the one the frozen sku-map used. Expandable via the Paper axis. */
const POSTER_DEFAULT_PAPER = "200-gsm-uncoated";

export const POSTER_PRESET: ProductPreset = {
  id: "poster",
  title: "Poster",
  provider: "gelato",
  axes: [
    {
      key: "size",
      label: "Storlek",
      values: Object.keys(POSTER_FORMAT).map((k) => ({ key: k, label: k.replace("x", "×") + " cm" })),
    },
    {
      key: "frame",
      label: "Ram",
      values: Object.keys(POSTER_FRAME).map((k) => ({ key: k, label: k })),
    },
    {
      key: "paper",
      label: "Papper",
      // A curated shortlist; the full catalog has 32 paper types to expand into.
      values: [
        { key: "200-gsm-uncoated", label: "200 g obestruket" },
        { key: "250-gsm-uncoated", label: "250 g obestruket" },
        { key: "200-gsm-coated-silk", label: "200 g silke" },
      ],
      defaultValues: [POSTER_DEFAULT_PAPER],
    },
  ],
  resolve(selection) {
    const frame = POSTER_FRAME[selection.frame];
    if (!frame) return null;
    const format = POSTER_FORMAT[selection.size]?.[frame.catalog];
    if (!format) return null;
    const paper = selection.paper || POSTER_DEFAULT_PAPER;
    return {
      catalog: frame.catalog,
      filters: {
        ...frame.filters,
        PaperFormat: [format],
        PaperType: [paper],
        ProductStatus: ["activated"],
      },
    };
  },
};

/** Curated preset library (composed products). Single-catalog products use the
 *  base path directly and are not listed here. */
export const PRODUCT_PRESETS: Record<string, ProductPreset> = {
  poster: POSTER_PRESET,
};

export function getPreset(id: string): ProductPreset | null {
  return PRODUCT_PRESETS[id] ?? null;
}
