// Unit tests for the product_bases client data layer (Phase 3b slice 2).
// Exercises the jsonb → typed narrowing with real-shaped rows (the t-shirts
// axes mirror what pod-catalog-import actually wrote) and with junk input.
import { describe, expect, it } from "vitest";
import { parsePrintAreas, parseVariantAxes, rowToProductBase, selectableAxes } from "./bases";

describe("parseVariantAxes", () => {
  it("parses real imported axes (Gelato t-shirts shape)", () => {
    const axes = parseVariantAxes([
      {
        key: "GarmentSize",
        label: "Size",
        values: [
          { key: "s", label: "S" },
          { key: "m", label: "M" },
          { key: "l", label: "L" },
        ],
      },
      {
        key: "GarmentColor",
        label: "Color",
        values: [{ key: "black", label: "Black" }],
      },
    ]);
    expect(axes).toHaveLength(2);
    expect(axes[0].key).toBe("GarmentSize");
    expect(axes[0].values.map((v) => v.key)).toEqual(["s", "m", "l"]);
    expect(axes[1].values[0]).toEqual({ key: "black", label: "Black" });
  });

  it("falls back label→key and drops entries without a key", () => {
    const axes = parseVariantAxes([
      { key: "MugSize", values: [{ key: "11-oz" }] }, // no labels
      { values: [{ key: "x", label: "X" }] }, // missing axis key → dropped
      "junk",
      null,
    ]);
    expect(axes).toHaveLength(1);
    expect(axes[0].label).toBe("MugSize");
    expect(axes[0].values[0].label).toBe("11-oz");
  });

  it("returns [] for non-array jsonb", () => {
    expect(parseVariantAxes(null)).toEqual([]);
    expect(parseVariantAxes({})).toEqual([]);
    expect(parseVariantAxes("[]")).toEqual([]);
  });
});

describe("parsePrintAreas", () => {
  it("parses well-formed areas and drops incomplete ones", () => {
    const areas = parsePrintAreas([
      { id: "front", label: "Front", widthMm: 300, heightMm: 400, bleedMm: 3 },
      { id: "back", widthMm: "300", heightMm: 400 }, // numeric string is fine
      { id: "bad", widthMm: "wide" }, // NaN width → dropped
      { label: "no-id", widthMm: 1, heightMm: 1 }, // no id → dropped
    ]);
    expect(areas.map((a) => a.id)).toEqual(["front", "back"]);
    expect(areas[0].bleedMm).toBe(3);
    expect(areas[0].safeAreaMm).toBeUndefined();
    expect(areas[1].widthMm).toBe(300);
  });

  it("returns [] for the default empty jsonb", () => {
    expect(parsePrintAreas([])).toEqual([]);
    expect(parsePrintAreas(null)).toEqual([]);
  });
});

describe("rowToProductBase", () => {
  it("maps a DB row to the typed ProductBase", () => {
    const base = rowToProductBase({
      id: "00000000-0000-0000-0000-000000000001",
      provider: "gelato",
      provider_product_id: "t-shirts",
      title: "T-shirts",
      category: null,
      variant_axes: [{ key: "GarmentSize", label: "Size", values: [] }],
      print_areas: [],
      mockup: "api",
      imported_at: "2026-07-16T00:00:00Z",
    });
    expect(base.providerProductId).toBe("t-shirts");
    expect(base.variantAxes[0].key).toBe("GarmentSize");
    expect(base.printAreas).toEqual([]);
    expect(base.mockup).toBe("api");
  });

  it("selectableAxes keeps only real customer choices (mugs shape)", () => {
    // Exactly what pod-catalog-import wrote for the "mugs" catalog.
    const base = rowToProductBase({
      id: "m",
      provider: "gelato",
      provider_product_id: "mugs",
      title: "Mugs",
      category: null,
      variant_axes: [
        { key: "ColorType", label: "Color type", values: [{ key: "4-0", label: "4/0" }] },
        {
          key: "MugMaterial",
          label: "Material",
          values: [
            { key: "ceramic-white", label: "Ceramic white" },
            { key: "ceramic-black", label: "Ceramic black" },
          ],
        },
        {
          key: "MugSize",
          label: "Size",
          values: [
            { key: "11-oz", label: "11 oz" },
            { key: "15-oz", label: "15 oz" },
          ],
        },
        { key: "ProductModel", label: "Model", values: [] },
        { key: "ProductStatus", label: "Status", values: [{ key: "activated", label: "Activated" }] },
        { key: "State", label: "State", values: [{ key: "published", label: "Published" }] },
      ],
      print_areas: [],
      mockup: "api",
      imported_at: "2026-07-17T00:00:00Z",
    });
    const axes = selectableAxes(base);
    // Only the two multi-value, non-bookkeeping axes survive — and crucially
    // there is NO Orientation axis, so portrait/landscape never shows for mugs.
    expect(axes.map((a) => a.key)).toEqual(["MugMaterial", "MugSize"]);
    expect(axes.some((a) => a.key === "Orientation")).toBe(false);
  });

  it("selectableAxes keeps Orientation when the base actually has it", () => {
    const base = rowToProductBase({
      id: "p",
      provider: "gelato",
      provider_product_id: "posters",
      title: "Posters",
      category: null,
      variant_axes: [
        {
          key: "Orientation",
          label: "Orientation",
          values: [
            { key: "hor", label: "Landscape" },
            { key: "ver", label: "Portrait" },
          ],
        },
      ],
      print_areas: [],
      mockup: "api",
      imported_at: "2026-07-17T00:00:00Z",
    });
    expect(selectableAxes(base).map((a) => a.key)).toEqual(["Orientation"]);
  });

  it("normalizes unknown mockup values to \"api\"", () => {
    const base = rowToProductBase({
      id: "x",
      provider: "gelato",
      provider_product_id: "mugs",
      title: "Mugs",
      category: null,
      variant_axes: [],
      print_areas: [],
      mockup: "weird-future-value",
      imported_at: "2026-07-16T00:00:00Z",
    });
    expect(base.mockup).toBe("api");
  });
});
