import { describe, expect, it } from "vitest";
import { buildAiLayerDriver } from "./ai-layer-driver";
import { DEFAULT_AI_STYLES } from "./ai-style-defaults";
import type { TemplateLayer, AiStylePreset } from "./template-schema";

// Minimal layer fixtures — the driver only reads type/id/defaults, so cast past
// the full TemplateLayer shape.
const photo = (ai?: unknown): Extract<TemplateLayer, { type: "photo" }> =>
  ({ type: "photo", id: "L1", defaults: ai ? { ai } : {} }) as never;
const aiPhoto = (defaults: Record<string, unknown>): Extract<TemplateLayer, { type: "aiPhoto" }> =>
  ({ type: "aiPhoto", id: "L1", defaults }) as never;

const presets = DEFAULT_AI_STYLES as AiStylePreset[];

describe("buildAiLayerDriver — plain photo", () => {
  it("returns null for a photo layer with no binding", () => {
    expect(buildAiLayerDriver(photo(), presets, "portrait")).toBeNull();
    expect(buildAiLayerDriver(photo({ recipeId: "" }), presets, "portrait")).toBeNull();
  });

  it("returns null for a binding to a non-builtin (saved) recipe — unresolvable here", () => {
    expect(buildAiLayerDriver(photo({ recipeId: "uuid-saved", references: [] }), presets, "portrait")).toBeNull();
  });
});

describe("buildAiLayerDriver — binding path", () => {
  it("nano-backdrop: no reference, style choices from the recipe, motif carried", () => {
    const d = buildAiLayerDriver(
      photo({ recipeId: "builtin-nano-backdrop", references: [], motif: "a house" }),
      presets,
      "portrait",
    )!;
    expect(d.needsReference).toBe(false);
    expect(d.styleChoices.length).toBeGreaterThan(0);
    expect(d.motif).toBe("a house");
    const run = d.resolve(d.styleChoices[0].id, null);
    expect(run.recipe.id).toBe("builtin-nano-backdrop");
    expect(run.optionValues.style).toBeTruthy();
    expect(run.slot).toContain("builtin-nano-backdrop");
  });

  it("face-swap: needs a reference, no style choices", () => {
    const refs = [{ id: "r1", url: "https://x/r.png", orientation: "any" }];
    const d = buildAiLayerDriver(photo({ recipeId: "builtin-face-swap", references: refs }), presets, "portrait")!;
    expect(d.needsReference).toBe(true);
    expect(d.styleChoices).toEqual([]);
    expect(d.references).toHaveLength(1);
    const run = d.resolve(null, "https://x/r.png");
    expect(run.recipe.id).toBe("builtin-face-swap");
    expect(run.slot).toContain("https://x/r.png");
  });

  it("filters references by orientation", () => {
    const refs = [
      { id: "p", url: "https://x/p.png", orientation: "portrait" },
      { id: "l", url: "https://x/l.png", orientation: "landscape" },
      { id: "a", url: "https://x/a.png", orientation: "any" },
    ];
    const d = buildAiLayerDriver(photo({ recipeId: "builtin-face-swap", references: refs }), presets, "landscape")!;
    expect(d.references.map((r) => r.id).sort()).toEqual(["a", "l"]);
  });
});

describe("buildAiLayerDriver — legacy path", () => {
  it("removeBackground: style choices from presets, watercolor → nano-watercolor", () => {
    const d = buildAiLayerDriver(aiPhoto({ subjectKind: "removeBackground" }), presets, "portrait")!;
    expect(d.needsReference).toBe(false);
    expect(d.styleChoices.map((c) => c.id)).toContain("watercolor");
    const run = d.resolve("watercolor", null);
    expect(run.recipe.id).toBe("builtin-nano-watercolor");
    const oilRun = d.resolve("oil", null);
    expect(oilRun.recipe.id).toBe("builtin-nano-backdrop");
  });

  it("removeBackground + simpleStyleMode → the style-cutout chain", () => {
    const d = buildAiLayerDriver(
      aiPhoto({ subjectKind: "removeBackground", simpleStyleMode: true }),
      presets,
      "portrait",
    )!;
    expect(d.resolve("watercolor", null).recipe.id).toBe("builtin-style-cutout");
  });

  it("human: needs a reference, no style choices, hint key set", () => {
    const d = buildAiLayerDriver(
      aiPhoto({ subjectKind: "human", referenceImages: [{ id: "r", url: "https://x/r.png", orientation: "any" }] }),
      presets,
      "portrait",
    )!;
    expect(d.needsReference).toBe(true);
    expect(d.styleChoices).toEqual([]);
    expect(d.hintKey).toBe("aiPhoto.subjectHintHuman");
    expect(d.references).toHaveLength(1);
  });

  it("carries motif from the legacy fluxStylePrompt field", () => {
    const d = buildAiLayerDriver(
      aiPhoto({ subjectKind: "removeBackground", fluxStylePrompt: "a residential house" }),
      presets,
      "portrait",
    )!;
    expect(d.motif).toBe("a residential house");
    // motif enters the cache slot so a motif change can't reuse a stale image.
    expect(d.resolve("oil", null).slot).toContain("a residential house");
  });
});
