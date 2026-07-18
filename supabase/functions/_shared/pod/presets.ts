// Product presets (Phase 3b) — merchant-facing products composed from one or
// more provider catalogs, as DATA interpreted by a GENERIC resolver.
//
// The split that matters:
//   * The ENGINE (resolvePreset below) is generic — no product- or provider-
//     specific branching. It walks a declarative definition and emits a
//     provider-neutral { catalog, attributeFilters }.
//   * A PRESET DEFINITION is curated DATA. Some curation is irreducible: only a
//     human decides that the merchant value "Ek" maps to Gelato's FrameColor
//     "natural-wood" in the `mounted-framed-posters` catalog, or that flat +
//     framed + hanging posters are ONE product. That knowledge can't be derived
//     from any API — but it lives as data, not as code, so adding a product
//     (Canvas) or a provider (Printful) is new data, never new engine logic.
//
// Pure (no Deno / esm.sh imports) so it is unit-testable from vitest.

/** A merchant/customer-facing option value on a preset axis. */
export interface PresetValue { key: string; label: string; }

export interface PresetAxis {
  key: string;   // "size" | "frame" | "paper"
  label: string; // "Storlek" | "Ram" | "Papper"
  values: PresetValue[];
  defaultValues?: string[]; // value keys enabled by default (all if omitted)
}

/** How one axis's selected value becomes a provider attribute filter, for a
 *  specific catalog. `valueByAxisValue` is per-catalog because the same
 *  merchant value maps to different provider vocab per catalog (30x40 →
 *  "300x400-mm" in one catalog, "300x400-mm-12x16-inch" in another). */
export interface AxisAttribute {
  axis: string;       // which preset axis, e.g. "size"
  attribute: string;  // provider attribute uid, e.g. "PaperFormat"
  valueByAxisValue: Record<string, string>; // axisValueKey → provider value uid
}

/** The provider catalog a given catalog-axis value selects, plus fixed filters
 *  and the per-axis attribute mappings for that catalog. */
export interface CatalogTarget {
  catalog: string;
  filters?: Record<string, string[]>; // fixed filters (e.g. FrameColor)
  attributes: AxisAttribute[];        // size/paper → provider attributes
}

export interface ProductPreset {
  id: string;
  title: string;
  provider: string;
  axes: PresetAxis[];
  baseFilters?: Record<string, string[]>; // every lookup carries these (e.g. ProductStatus)
  catalogAxis: string;                     // which axis picks the catalog, e.g. "frame"
  targets: Record<string, CatalogTarget>;  // catalogAxis value key → target
}

/** The provider lookup a variant-combo resolves to (provider-neutral shape). */
export interface PresetResolution {
  catalog: string;
  filters: Record<string, string[]>;
}

/**
 * GENERIC resolver. Given any preset + one selected value per axis, produce the
 * provider catalog + attributeFilters that pin a single product — or null for a
 * combination that has no product (caller skips it). No product/provider
 * branching lives here; everything specific comes from the preset DATA.
 */
export function resolvePreset(
  preset: ProductPreset,
  selection: Record<string, string>,
): PresetResolution | null {
  const catalogValue = selection[preset.catalogAxis];
  const target = preset.targets[catalogValue];
  if (!target) return null;

  const filters: Record<string, string[]> = { ...(preset.baseFilters ?? {}), ...(target.filters ?? {}) };
  for (const attr of target.attributes) {
    const axisValue = selection[attr.axis];
    if (axisValue === undefined) return null;
    const providerValue = attr.valueByAxisValue[axisValue];
    if (providerValue === undefined) return null; // this value isn't offered for this catalog
    filters[attr.attribute] = [providerValue];
  }
  return { catalog: target.catalog, filters };
}

// --- Size derivation (parse dimensions out of provider format keys) ----------
//
// Provider format keys ENCODE the mm dimensions ("300x400-mm",
// "300x400-mm-12x16-inch"), so the merchant-facing size list + per-catalog
// format mapping can be DERIVED from the imported catalog rather than
// hand-listed. This is how a composed product offers the whole catalog: feed it
// each catalog's format values and it builds the maps. Quirks that don't encode
// mm (framed "A4") are added as explicit specials.

/** "300x400-mm…" → { sizeKey:"30x40", label:"30×40 cm" }. Null if no mm prefix. */
export function parseMmSize(fmt: string): { sizeKey: string; label: string } | null {
  const m = /^(\d{2,4})x(\d{2,4})-mm/.exec(fmt);
  if (!m) return null;
  const w = Math.round(parseInt(m[1], 10) / 10);
  const h = Math.round(parseInt(m[2], 10) / 10);
  return { sizeKey: `${w}x${h}`, label: `${w}×${h} cm` };
}

/** Build a sizeKey → formatKey map from a catalog's format values. When a size
 *  has several keys (framed lists both "300x400-mm" and the combined variant),
 *  keep the SHORTEST — the plain mm key our orders use; hanger has only combined
 *  keys so it keeps those. */
export function sizeMapFromFormats(
  formatKeys: string[],
  specials: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const fmt of formatKeys) {
    const p = parseMmSize(fmt);
    if (!p) continue;
    if (!out[p.sizeKey] || fmt.length < out[p.sizeKey].length) out[p.sizeKey] = fmt;
  }
  return { ...out, ...specials };
}

// --- Poster preset (DATA) ----------------------------------------------------
//
// Composes three Gelato catalogs behind one "Ram & upphängning" axis. All keys
// below are verified against the live catalogs. The size→format vocab genuinely
// differs per catalog — that difference is DATA the generic engine reads, not
// special-case code.

// The raw format values Gelato offers per poster catalog (imported into
// product_bases; snapshotted here — a later refinement reads them live so they
// auto-update per provider). The maps below are DERIVED by parsing dimensions.
const POSTERS_FORMATS = [
  "130x180-mm", "140x180-mm", "150x200-mm", "200x250-mm", "210x279-mm", "210x300-mm",
  "250x250-mm", "270x350-mm", "280x430-mm", "300x300-mm", "300x400-mm", "300x450-mm",
  "305x406-mm", "350x350-mm", "400x400-mm", "400x500-mm", "400x600-mm", "450x450-mm",
  "450x600-mm", "500x500-mm", "500x700-mm", "533x711-mm", "600x800-mm", "600x900-mm",
  "610x910-mm", "700x700-mm", "700x1000-mm", "750x1000-mm",
];
const FRAMED_FORMATS = [
  "130x180-mm", "150x200-mm", "200x500-mm", "250x600-mm", "270x350-mm", "300x300-mm",
  "300x400-mm", "300x450-mm", "400x400-mm", "400x500-mm", "400x600-mm", "450x600-mm",
  "500x500-mm", "500x700-mm", "600x800-mm", "600x900-mm", "700x700-mm", "700x1000-mm",
  "800x1200-mm",
];
const HANGER_FORMATS = [
  "130x180-mm-5R", "150x200-mm-6x8-inch", "200x250-mm-8x10-inch", "200x500-mm-8x20-inch",
  "250x250-mm-10x10-inch", "250x600-mm-10x24-inch", "270x350-mm-11x14-inch", "280x430-mm-XL",
  "300x300-mm-12x12-inch", "300x400-mm-12x16-inch", "300x450-mm-12x18-inch", "350x350-mm-14x14-inch",
  "400x400-mm-16x16-inch", "400x500-mm-16x20-inch", "400x600-mm-16x24-inch", "450x450-mm-18x18-inch",
  "450x600-mm-18x24-inch", "500x500-mm-20x20-inch", "500x700-mm-20x28-inch", "600x800-mm-24x32-inch",
  "600x900-mm-24x36-inch", "700x700-mm-28x28-inch", "700x1000-mm-28x40-inch", "750x1000-mm-30x40-inch",
];

/** size → PaperFormat in the flat `posters` catalog. */
const FMT_FLAT = sizeMapFromFormats(POSTERS_FORMATS);
/** size → PaperFormat in `mounted-framed-posters` (21×30 uses "A4", not mm). */
const FMT_FRAMED = sizeMapFromFormats(FRAMED_FORMATS, { "21x30": "A4" });
/** size → UnifiedPaperFormat in `hanging-posters` (combined mm+inch vocab;
 *  21×30 is the "A4-8x12-inch" special). */
const FMT_HANGER = sizeMapFromFormats(HANGER_FORMATS, { "21x30": "A4-8x12-inch" });

/** paper → PaperType (flat + framed catalogs share this vocab). */
const PAPER_STD: Record<string, string> = {
  "200-gsm-uncoated": "200-gsm-uncoated",
  "250-gsm-uncoated": "250-gsm-uncoated",
  "200-gsm-coated-silk": "200-gsm-coated-silk",
};
/** paper → UnifiedPaperType (hanging-posters uses the 80lb-suffixed vocab). */
const PAPER_HANGER: Record<string, string> = {
  "200-gsm-uncoated": "200-gsm-80lb-uncoated",
};

const framedTarget = (frameColor: string): CatalogTarget => ({
  catalog: "mounted-framed-posters",
  filters: { FrameColor: [frameColor], FrameMaterial: ["wood"] },
  attributes: [
    { axis: "size", attribute: "PaperFormat", valueByAxisValue: FMT_FRAMED },
    { axis: "paper", attribute: "PaperType", valueByAxisValue: PAPER_STD },
  ],
});
const hangerTarget = (hangerColor: string): CatalogTarget => ({
  catalog: "hanging-posters",
  filters: { WallHangerColor: [hangerColor], WallHangerMaterial: ["wood"] },
  attributes: [
    { axis: "size", attribute: "UnifiedPaperFormat", valueByAxisValue: FMT_HANGER },
    { axis: "paper", attribute: "UnifiedPaperType", valueByAxisValue: PAPER_HANGER },
  ],
});

export const POSTER_PRESET: ProductPreset = {
  id: "poster",
  title: "Poster",
  provider: "gelato",
  baseFilters: { ProductStatus: ["activated"] },
  catalogAxis: "frame",
  axes: [
    {
      key: "size", label: "Storlek",
      // Derived from the flat-poster catalog, sorted by area (smallest first).
      values: Object.keys(FMT_FLAT)
        .sort((a, b) => {
          const area = (s: string) => s.split("x").reduce((n, x) => n * parseInt(x, 10), 1);
          return area(a) - area(b);
        })
        .map((k) => ({ key: k, label: k.replace("x", "×") + " cm" })),
    },
    {
      key: "frame", label: "Ram & upphängning",
      // Value keys match the frozen sku-map's frame labels exactly.
      values: [
        { key: "Ingen", label: "Ingen ram" },
        { key: "Svart", label: "Ram svart" }, { key: "Vit", label: "Ram vit" },
        { key: "Ek", label: "Ram ek" }, { key: "Valnöt", label: "Ram valnöt" },
        { key: "Hängare Vit", label: "Hängare vit" }, { key: "Hängare Svart", label: "Hängare svart" },
        { key: "Hängare Ek", label: "Hängare ek" }, { key: "Hängare Valnöt", label: "Hängare valnöt" },
      ],
    },
    {
      key: "paper", label: "Papper",
      values: [
        { key: "200-gsm-uncoated", label: "200 g obestruket" },
        { key: "250-gsm-uncoated", label: "250 g obestruket" },
        { key: "200-gsm-coated-silk", label: "200 g silke" },
      ],
      defaultValues: ["200-gsm-uncoated"],
    },
  ],
  targets: {
    Ingen: {
      catalog: "posters",
      attributes: [
        { axis: "size", attribute: "PaperFormat", valueByAxisValue: FMT_FLAT },
        { axis: "paper", attribute: "PaperType", valueByAxisValue: PAPER_STD },
      ],
    },
    Svart: framedTarget("black"),
    Vit: framedTarget("white"),
    Ek: framedTarget("natural-wood"),
    Valnöt: framedTarget("dark-wood"),
    "Hängare Vit": hangerTarget("white"),
    "Hängare Svart": hangerTarget("black"),
    "Hängare Ek": hangerTarget("natural-wood"),
    "Hängare Valnöt": hangerTarget("dark-wood"),
  },
};

/** Curated preset library (composed products). Single-catalog products (a mug)
 *  use the base path directly and are not listed here. */
export const PRODUCT_PRESETS: Record<string, ProductPreset> = { poster: POSTER_PRESET };

export function getPreset(id: string): ProductPreset | null {
  return PRODUCT_PRESETS[id] ?? null;
}
