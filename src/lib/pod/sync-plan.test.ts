// Tests for the axis-agnostic sync-plan core (Phase 3b slice 2b).
// Two jobs: (1) PROVE wall-art option values + variant keys are byte-identical
// to the old fixed-slot layout (regression guard for the live sync), and
// (2) cover generic base planning (mugs).
import { describe, expect, it } from "vitest";
import {
  buildVariantInput,
  desiredOptionValuesByAxis,
  enumerateBaseCombos,
  fullComboFingerprint,
  keyFromPlannedVariant,
  keyFromSelectedOptions,
  planBaseGroup,
  planPresetGroup,
  pricingSlots,
  type PlannedGroup,
  type PlannedVariant,
} from "../../../supabase/functions/_shared/pod/sync-plan";
import { POSTER_PRESET } from "../../../supabase/functions/_shared/pod/presets";

// Mirror how wall-art plan() fills optionValues: [Storlek, <variantOptionName>].
function wallArtVariant(size: string, frame: string, sku: string, price: number): PlannedVariant {
  return {
    optionValues: [
      { optionName: "Storlek", value: size },
      { optionName: "Ram", value: frame },
    ],
    sku,
    price,
    size,
    variant: frame,
  };
}

const posterGroup: PlannedGroup = {
  kind: "poster",
  productType: "Poster",
  variantOptionName: "Ram",
  optionAxes: [
    { name: "Storlek", values: ["30x40", "50x70"] },
    { name: "Ram", values: ["Ingen", "Ek"] },
  ],
  variants: [
    wallArtVariant("30x40", "Ek", "uid-30-ek", 499),
    wallArtVariant("50x70", "Ingen", "uid-50-ingen", 699),
  ],
  skipped: [],
};

describe("wall-art parity (regression guard)", () => {
  it("buildVariantInput emits the same Shopify option values as the old fixed layout", () => {
    const input = buildVariantInput(posterGroup.variants[0]);
    expect(input.optionValues).toEqual([
      { optionName: "Storlek", name: "30x40" },
      { optionName: "Ram", name: "Ek" },
    ]);
    expect(input.price).toBe("499.00");
    expect(input.inventoryItem).toEqual({ sku: "uid-30-ek", tracked: false });
    expect(input.inventoryPolicy).toBe("CONTINUE");
  });

  it("desired key == old `${size}|${variant}` normalized form", () => {
    // old: normalizeOptionValue(size)|normalizeOptionValue(variant)
    expect(keyFromPlannedVariant(posterGroup.variants[0], posterGroup.optionAxes)).toBe("30x40|ek");
    expect(keyFromPlannedVariant(posterGroup.variants[1], posterGroup.optionAxes)).toBe("50x70|ingen");
  });

  it("existing-variant key from Shopify selectedOptions matches the desired key", () => {
    const selected = [
      { name: "Ram", value: "Ek" }, // Shopify may return axes in any order
      { name: "Storlek", value: "30x40" },
    ];
    expect(keyFromSelectedOptions(selected, posterGroup.optionAxes)).toBe("30x40|ek");
  });

  it("returns null for a variant that lacks a group axis (never matched/deleted)", () => {
    const selected = [{ name: "Storlek", value: "30x40" }]; // no Ram
    expect(keyFromSelectedOptions(selected, posterGroup.optionAxes)).toBeNull();
  });

  it("consolidated key preserves Produkttyp|Storlek|Utförande order", () => {
    const axes = [
      { name: "Produkttyp", values: ["Poster", "Canvas"] },
      { name: "Storlek", values: ["30x40"] },
      { name: "Utförande", values: ["Ek", "2cm"] },
    ];
    const v: PlannedVariant = {
      optionValues: [
        { optionName: "Produkttyp", value: "Canvas" },
        { optionName: "Storlek", value: "30x40" },
        { optionName: "Utförande", value: "2cm" },
      ],
      sku: "x",
      price: 1,
    };
    // "2cm" normalizes to "2" (trailing cm dropped) — same as the old code.
    expect(keyFromPlannedVariant(v, axes)).toBe("canvas|30x40|2");
  });

  it("fullComboFingerprint is order-independent", () => {
    const a = fullComboFingerprint([{ name: "Storlek", value: "30x40" }, { name: "Ram", value: "Ek" }]);
    const b = fullComboFingerprint([{ name: "Ram", value: "Ek" }, { name: "Storlek", value: "30x40" }]);
    expect(a).toBe(b);
  });

  it("desiredOptionValuesByAxis collects unique values per axis", () => {
    expect(desiredOptionValuesByAxis(posterGroup)).toEqual({
      Storlek: ["30x40", "50x70"],
      Ram: ["Ek", "Ingen"],
    });
  });
});

describe("base planning (mugs)", () => {
  const mugAxes = [
    {
      key: "MugSize",
      name: "Size",
      values: [
        { key: "11-oz", label: "11 oz" },
        { key: "15-oz", label: "15 oz" },
      ],
    },
    {
      key: "MugMaterial",
      name: "Material",
      values: [
        { key: "ceramic-white", label: "Ceramic white" },
        { key: "ceramic-black", label: "Ceramic black" },
      ],
    },
  ];

  it("enumerates the full cartesian product when axes are selected", () => {
    const combos = enumerateBaseCombos(mugAxes, {
      MugSize: ["11-oz"],
      MugMaterial: ["ceramic-white", "ceramic-black"],
    });
    expect(combos).toHaveLength(2);
    expect(combos[0].map((c) => c.key)).toEqual(["11-oz", "ceramic-white"]);
  });

  it("treats an unselected axis as ALL its values (offer everything)", () => {
    const combos = enumerateBaseCombos(mugAxes, { MugSize: ["11-oz"] });
    expect(combos).toHaveLength(2); // 1 size × 2 materials
  });

  it("pricingSlots picks the *Size axis as the size slot", () => {
    const combo = [
      { key: "11-oz", axisKey: "MugSize" },
      { key: "ceramic-white", axisKey: "MugMaterial" },
    ];
    expect(pricingSlots(combo)).toEqual({ sizeSlot: "11-oz", variantSlot: "ceramic-white" });
  });

  it("planBaseGroup resolves UIDs, applies prices, and builds option values", async () => {
    const group = await planBaseGroup({
      baseId: "mugs",
      title: "Mugs",
      axes: mugAxes,
      selectedAxes: { MugSize: ["11-oz"], MugMaterial: ["ceramic-white", "ceramic-black"] },
      baseFilters: { ProductStatus: ["activated"] },
      // Fake the live Gelato search: return a UID mirroring the pinned filters.
      resolveUid: async (f) =>
        `mug_${f.MugSize[0]}_${f.MugMaterial[0]}_${f.ProductStatus[0]}`,
      priceOf: (size, variant) => (variant === "ceramic-black" ? 0 : 149), // black has no price → skipped
    });

    expect(group.kind).toBe("mugs");
    expect(group.optionAxes.map((a) => a.name)).toEqual(["Size", "Material"]);
    // Only ceramic-white priced → 1 variant; black skipped as "no price".
    expect(group.variants).toHaveLength(1);
    expect(group.variants[0].optionValues).toEqual([
      { optionName: "Size", value: "11 oz" },
      { optionName: "Material", value: "Ceramic white" },
    ]);
    expect(group.variants[0].sku).toBe("mug_11-oz_ceramic-white_activated");
    expect(group.skipped).toContainEqual({ size: "11-oz", variant: "ceramic-black", reason: "no price" });
    // No Orientation axis anywhere — mugs are orientation-less.
    expect(group.optionAxes.some((a) => a.name === "Orientation")).toBe(false);
  });

  it("skips a combo whose UID does not resolve", async () => {
    const group = await planBaseGroup({
      baseId: "mugs",
      title: "Mugs",
      axes: mugAxes,
      selectedAxes: { MugSize: ["11-oz"], MugMaterial: ["ceramic-white"] },
      resolveUid: async () => null,
      priceOf: () => 149,
    });
    expect(group.variants).toHaveLength(0);
    expect(group.skipped[0].reason).toBe("no Gelato SKU");
  });
});

// --- planPresetGroup (composed poster as its own 3-axis product) ---
describe("planPresetGroup (composed poster)", () => {
  // Fake provider search: echo the pinned filters into a deterministic uid.
  const fakeResolve = async (catalog: string, filters: Record<string, string[]>) =>
    `${catalog}:${filters.PaperFormat?.[0] ?? filters.UnifiedPaperFormat?.[0] ?? "?"}:${filters.FrameColor?.[0] ?? filters.WallHangerColor?.[0] ?? "none"}`;

  it("builds one product with Storlek × Ram × Papper and resolves each combo", async () => {
    const g = await planPresetGroup({
      preset: POSTER_PRESET,
      productType: "Poster",
      selectedAxes: {
        size: ["30x40", "50x70"],
        frame: ["Ingen", "Ek", "Hängare Ek"],
        paper: ["200-gsm-uncoated"],
      },
      resolveUid: fakeResolve,
      priceOf: () => 249,
    });
    expect(g.kind).toBe("poster");
    // One paper (default) is PINNED, not a Shopify option → 2 visible axes, so
    // the poster stays Storlek × Ram exactly like today.
    expect(g.optionAxes.map((a) => a.name)).toEqual(["Storlek", "Ram & upphängning"]);
    // 2 sizes × 3 frames × 1 paper = 6 combos, all resolvable/priced → 6 variants.
    expect(g.variants).toHaveLength(6);
    // Paper is not in the variant's Shopify option values (it was pinned).
    expect(g.variants[0].optionValues.some((o) => o.optionName === "Papper")).toBe(false);
    // Frame value drives the catalog: Ingen→posters, Ek→mounted, Hängare→hanging.
    const ekVariant = g.variants.find((v) => v.optionValues.some((o) => o.value === "Ram ek") && v.size === "30x40");
    expect(ekVariant!.sku).toBe("mounted-framed-posters:300x400-mm:natural-wood");
    const hangerVariant = g.variants.find((v) => v.optionValues.some((o) => o.value === "Hängare ek") && v.size === "30x40");
    expect(hangerVariant!.sku).toBe("hanging-posters:300x400-mm-12x16-inch:natural-wood");
    // Pricing stays 2-D: size + frame (paper is not a price dimension).
    expect(ekVariant!.size).toBe("30x40");
    expect(ekVariant!.variant).toBe("Ek");
  });

  it("promotes Papper to a real axis once the merchant offers more than one", async () => {
    const g = await planPresetGroup({
      preset: POSTER_PRESET, productType: "Poster",
      selectedAxes: { size: ["30x40", "50x70"], frame: ["Ingen", "Ek"], paper: ["200-gsm-uncoated", "250-gsm-uncoated"] },
      resolveUid: fakeResolve, priceOf: () => 249,
    });
    expect(g.optionAxes.map((a) => a.name)).toEqual(["Storlek", "Ram & upphängning", "Papper"]);
    expect(g.variants).toHaveLength(8); // 2 sizes × 2 frames × 2 papers
    expect(g.variants[0].optionValues.some((o) => o.optionName === "Papper")).toBe(true);
  });

  it("skips combos with no product (a flat-only size on a hanger) instead of a bad SKU", async () => {
    // 21×28 (210x279) exists in the flat catalog but not for hangers.
    const g = await planPresetGroup({
      preset: POSTER_PRESET, productType: "Poster",
      selectedAxes: { size: ["21x28"], frame: ["Hängare Ek"], paper: ["200-gsm-uncoated"] },
      resolveUid: fakeResolve, priceOf: () => 249,
    });
    expect(g.variants).toHaveLength(0);
    expect(g.skipped[0].reason).toBe("no product for combo");
  });
});
