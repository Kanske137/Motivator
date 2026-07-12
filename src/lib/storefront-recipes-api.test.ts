import { describe, expect, it } from "vitest";
import { collectRecipeIds } from "./storefront-recipes-api";

describe("collectRecipeIds", () => {
  it("finds bound recipe ids across orientations and layouts, de-duped", () => {
    const template = {
      defaultLayout: {
        portrait: { layers: [{ type: "photo", defaults: { ai: { recipeId: "uuid-a" } } }, { type: "text" }] },
        landscape: { layers: [{ type: "photo", defaults: { ai: { recipeId: "uuid-a" } } }] },
      },
      canvasLayout: {
        portrait: { layers: [{ type: "photo", defaults: { ai: { recipeId: "builtin-face-swap" } } }] },
      },
      extraLayouts: [
        { portrait: { layers: [{ type: "photo", defaults: { ai: { recipeId: "uuid-b" } } }] } },
      ],
    };
    expect(collectRecipeIds(template).sort()).toEqual(["builtin-face-swap", "uuid-a", "uuid-b"]);
  });

  it("ignores plain photos and non-photo layers", () => {
    const template = {
      defaultLayout: {
        portrait: {
          layers: [
            { type: "photo", defaults: { shape: "rect" } }, // plain photo, no binding
            { type: "map", defaults: { ai: { recipeId: "not-a-photo" } } }, // wrong type
          ],
        },
      },
    };
    expect(collectRecipeIds(template)).toEqual([]);
  });

  it("returns [] for empty / malformed input", () => {
    expect(collectRecipeIds(null)).toEqual([]);
    expect(collectRecipeIds({})).toEqual([]);
    expect(collectRecipeIds({ defaultLayout: {} })).toEqual([]);
  });
});
