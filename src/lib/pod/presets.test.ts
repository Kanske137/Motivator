// Tests for the GENERIC preset resolver + the Poster preset DATA (Phase 3b).
// Proves one engine resolves any preset from data, and that Poster keeps plain +
// framed + hanger as ONE product by mapping each frame value to the right Gelato
// catalog + filters — including the per-catalog vocab differences.
import { describe, expect, it } from "vitest";
import { POSTER_PRESET, getPreset, resolvePreset } from "../../../supabase/functions/_shared/pod/presets";

describe("generic resolver + Poster preset data", () => {
  it("exposes Size / Ram / Papper axes with all frame values", () => {
    expect(POSTER_PRESET.axes.map((a) => a.key)).toEqual(["size", "frame", "paper"]);
    expect(POSTER_PRESET.axes.find((a) => a.key === "frame")!.values.map((v) => v.key)).toEqual([
      "Ingen", "Svart", "Vit", "Ek", "Valnöt",
      "Hängare Vit", "Hängare Svart", "Hängare Ek", "Hängare Valnöt",
    ]);
  });

  it("plain poster → flat `posters` catalog", () => {
    expect(resolvePreset(POSTER_PRESET, { size: "30x40", frame: "Ingen", paper: "200-gsm-uncoated" })).toEqual({
      catalog: "posters",
      filters: { ProductStatus: ["activated"], PaperFormat: ["300x400-mm"], PaperType: ["200-gsm-uncoated"] },
    });
  });

  it("oak-framed → mounted-framed-posters with frame filters", () => {
    expect(resolvePreset(POSTER_PRESET, { size: "30x40", frame: "Ek", paper: "200-gsm-uncoated" })).toEqual({
      catalog: "mounted-framed-posters",
      filters: {
        ProductStatus: ["activated"], FrameColor: ["natural-wood"], FrameMaterial: ["wood"],
        PaperFormat: ["300x400-mm"], PaperType: ["200-gsm-uncoated"],
      },
    });
  });

  it("21×30 framed uses the A4 PaperFormat quirk", () => {
    const p = "200-gsm-uncoated";
    const framed = resolvePreset(POSTER_PRESET, { size: "21x30", frame: "Svart", paper: p });
    const flat = resolvePreset(POSTER_PRESET, { size: "21x30", frame: "Ingen", paper: p });
    expect(framed!.filters.PaperFormat).toEqual(["A4"]);
    expect(flat!.filters.PaperFormat).toEqual(["210x300-mm"]);
  });

  it("hanger → hanging-posters with its OWN vocab (UnifiedPaperFormat/Type + WallHangerColor)", () => {
    expect(resolvePreset(POSTER_PRESET, { size: "30x40", frame: "Hängare Ek", paper: "200-gsm-uncoated" })).toEqual({
      catalog: "hanging-posters",
      filters: {
        ProductStatus: ["activated"], WallHangerColor: ["natural-wood"], WallHangerMaterial: ["wood"],
        UnifiedPaperFormat: ["300x400-mm-12x16-inch"], UnifiedPaperType: ["200-gsm-80lb-uncoated"],
      },
    });
  });

  it("returns null for combos with no product (hanger size not offered / unknown value)", () => {
    // Hangers aren't offered in 13×18 (not in FMT_HANGER).
    expect(resolvePreset(POSTER_PRESET, { size: "13x18", frame: "Hängare Ek" })).toBeNull();
    // Silk paper isn't in the hanger vocab.
    expect(resolvePreset(POSTER_PRESET, { size: "30x40", frame: "Hängare Ek", paper: "200-gsm-coated-silk" })).toBeNull();
    expect(resolvePreset(POSTER_PRESET, { size: "999", frame: "Ingen" })).toBeNull();
  });

  it("the engine is generic — a tiny ad-hoc preset resolves the same way", () => {
    const mini: typeof POSTER_PRESET = {
      id: "mini", title: "Mini", provider: "gelato", catalogAxis: "kind",
      axes: [], baseFilters: { ProductStatus: ["activated"] },
      targets: {
        a: { catalog: "cat-a", attributes: [{ axis: "sz", attribute: "Fmt", valueByAxisValue: { s: "small" } }] },
      },
    };
    expect(resolvePreset(mini, { kind: "a", sz: "s" })).toEqual({
      catalog: "cat-a", filters: { ProductStatus: ["activated"], Fmt: ["small"] },
    });
    expect(resolvePreset(mini, { kind: "b", sz: "s" })).toBeNull();
  });

  it("getPreset resolves by id", () => {
    expect(getPreset("poster")).toBe(POSTER_PRESET);
    expect(getPreset("nope")).toBeNull();
  });
});
