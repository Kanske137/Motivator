import { describe, expect, it } from "vitest";
import { buildAiLayerDriver } from "./ai-layer-driver";
import type { TemplateLayer } from "./template-schema";

// Minimal layer fixtures — the driver only reads type/id/defaults, so cast past
// the full TemplateLayer shape.
const photo = (ai?: unknown): Extract<TemplateLayer, { type: "photo" }> =>
  ({ type: "photo", id: "L1", defaults: ai ? { ai } : {} }) as never;

describe("buildAiLayerDriver — plain photo", () => {
  it("returns null for a photo layer with no binding", () => {
    expect(buildAiLayerDriver(photo(), "portrait")).toBeNull();
    expect(buildAiLayerDriver(photo({ recipeId: "" }), "portrait")).toBeNull();
  });

  it("returns null for a binding to a non-builtin (saved) recipe — unresolvable here", () => {
    expect(buildAiLayerDriver(photo({ recipeId: "uuid-saved", references: [] }), "portrait")).toBeNull();
  });
});

describe("buildAiLayerDriver — binding path", () => {
  it("nano-backdrop: no reference, style choices from the recipe, motif carried", () => {
    const d = buildAiLayerDriver(
      photo({ recipeId: "builtin-nano-backdrop", references: [], motif: "a house" }),
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
    const d = buildAiLayerDriver(photo({ recipeId: "builtin-face-swap", references: refs }), "portrait")!;
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
    const d = buildAiLayerDriver(photo({ recipeId: "builtin-face-swap", references: refs }), "landscape")!;
    expect(d.references.map((r) => r.id).sort()).toEqual(["a", "l"]);
  });

  it("carries motif into the cache slot so a motif change can't reuse a stale image", () => {
    const d = buildAiLayerDriver(
      photo({ recipeId: "builtin-nano-backdrop", references: [], motif: "a residential house" }),
      "portrait",
    )!;
    expect(d.resolve(d.styleChoices[0].id, null).slot).toContain("a residential house");
  });
});
