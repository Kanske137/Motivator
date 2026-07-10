import { describe, expect, it } from "vitest";
import { defaultLocks, photoLayerSchema } from "./template-schema";

// The photo/aiPhoto merge, additively: a photo layer that carries a recipe
// binding IS the unified media layer. Absent binding = plain photo.
const baseLayer = {
  id: "l1",
  name: "Photo",
  xPct: 0,
  yPct: 0,
  wPct: 100,
  hPct: 100,
  zIndex: 0,
  locks: defaultLocks(),
  type: "photo" as const,
  defaults: { shape: "rect", fit: "cover" },
};

describe("photo layer recipe binding", () => {
  it("stays plain when no recipe is bound", () => {
    const l = photoLayerSchema.parse(baseLayer);
    expect(l.defaults.ai).toBeUndefined();
  });

  it("carries a recipe binding with references and motif", () => {
    const l = photoLayerSchema.parse({
      ...baseLayer,
      defaults: {
        ...baseLayer.defaults,
        ai: {
          recipeId: "builtin-nano-backdrop",
          motif: "a residential house",
          references: [],
        },
      },
    });
    expect(l.defaults.ai?.recipeId).toBe("builtin-nano-backdrop");
    expect(l.defaults.ai?.motif).toBe("a residential house");
  });

  it("rejects a binding with no recipe id", () => {
    expect(() =>
      photoLayerSchema.parse({
        ...baseLayer,
        defaults: { ...baseLayer.defaults, ai: { recipeId: "" } },
      }),
    ).toThrow();
  });
});
