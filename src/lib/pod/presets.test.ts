// Tests for the product-preset model (Phase 3b). Proves the Poster preset keeps
// plain + framed as ONE product by resolving each frame value to the right
// Gelato catalog + filters — grounded in the real catalog attributes.
import { describe, expect, it } from "vitest";
import { POSTER_PRESET, getPreset } from "../../../supabase/functions/_shared/pod/presets";

describe("Poster preset (composed across catalogs)", () => {
  it("exposes Size / Ram / Papper axes", () => {
    expect(POSTER_PRESET.axes.map((a) => a.key)).toEqual(["size", "frame", "paper"]);
    expect(POSTER_PRESET.axes.find((a) => a.key === "frame")!.values.map((v) => v.key)).toEqual([
      "Ingen", "Svart", "Vit", "Ek", "Valnöt",
    ]);
  });

  it("plain poster resolves to the flat `posters` catalog", () => {
    const r = POSTER_PRESET.resolve({ size: "30x40", frame: "Ingen", paper: "200-gsm-uncoated" });
    expect(r).toEqual({
      catalog: "posters",
      filters: {
        PaperFormat: ["300x400-mm"],
        PaperType: ["200-gsm-uncoated"],
        ProductStatus: ["activated"],
      },
    });
  });

  it("oak-framed poster resolves to mounted-framed-posters with the frame filters", () => {
    const r = POSTER_PRESET.resolve({ size: "30x40", frame: "Ek", paper: "200-gsm-uncoated" });
    expect(r).toEqual({
      catalog: "mounted-framed-posters",
      filters: {
        FrameColor: ["natural-wood"],
        FrameMaterial: ["wood"],
        PaperFormat: ["300x400-mm"],
        PaperType: ["200-gsm-uncoated"],
        ProductStatus: ["activated"],
      },
    });
  });

  it("honours the 21×30 framed PaperFormat quirk (A4, not 210x300-mm)", () => {
    const flat = POSTER_PRESET.resolve({ size: "21x30", frame: "Ingen" });
    const framed = POSTER_PRESET.resolve({ size: "21x30", frame: "Svart" });
    expect(flat!.filters.PaperFormat).toEqual(["210x300-mm"]);
    expect(framed!.filters.PaperFormat).toEqual(["A4"]); // the real Gelato quirk
  });

  it("defaults paper to 200-gsm-uncoated but allows expanding it", () => {
    const dflt = POSTER_PRESET.resolve({ size: "30x40", frame: "Ingen" });
    expect(dflt!.filters.PaperType).toEqual(["200-gsm-uncoated"]);
    const silk = POSTER_PRESET.resolve({ size: "30x40", frame: "Ingen", paper: "200-gsm-coated-silk" });
    expect(silk!.filters.PaperType).toEqual(["200-gsm-coated-silk"]);
    // Paper axis default is the frozen-map paper; the shortlist offers more.
    expect(POSTER_PRESET.axes.find((a) => a.key === "paper")!.defaultValues).toEqual(["200-gsm-uncoated"]);
  });

  it("returns null for an unknown frame (never a wrong SKU)", () => {
    expect(POSTER_PRESET.resolve({ size: "30x40", frame: "Hängare Ek" })).toBeNull();
    expect(POSTER_PRESET.resolve({ size: "999x999", frame: "Ingen" })).toBeNull();
  });

  it("getPreset resolves by id", () => {
    expect(getPreset("poster")).toBe(POSTER_PRESET);
    expect(getPreset("nope")).toBeNull();
  });
});
