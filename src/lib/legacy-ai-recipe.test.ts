import { describe, expect, it } from "vitest";
import { DEFAULT_AI_STYLES } from "./ai-style-defaults";
import { BUILTIN_RECIPES, resolveStyleValue } from "./ai-recipe";
import {
  isWatercolorStyle,
  legacyBuiltinRecipeId,
  resolveLegacyRecipe,
  type LegacyStyleSelection,
} from "./legacy-ai-recipe";

const styleById = (id: string): LegacyStyleSelection => {
  const s = DEFAULT_AI_STYLES.find((x) => x.id === id);
  if (!s) throw new Error(`test fixture missing style ${id}`);
  return { prompt: s.prompt, styleInstruction: s.styleInstruction, bridge: s.bridge, label: s.label };
};

const watercolor = styleById("watercolor");
const oil = styleById("oil");

describe("isWatercolorStyle", () => {
  it("defaults to watercolor when no style is picked (empty prompt)", () => {
    expect(isWatercolorStyle(null)).toBe(true);
    expect(isWatercolorStyle({ prompt: "" })).toBe(true);
    expect(isWatercolorStyle({ prompt: "   " })).toBe(true);
  });

  it("matches the medium in the prompt or label, English and Swedish", () => {
    expect(isWatercolorStyle({ prompt: "a soft watercolor wash" })).toBe(true);
    expect(isWatercolorStyle({ prompt: "watercolour with a u" })).toBe(true);
    expect(isWatercolorStyle({ prompt: "water colour with a space" })).toBe(true);
    expect(isWatercolorStyle({ prompt: "aquarelle" })).toBe(true);
    expect(isWatercolorStyle({ prompt: "generic art", label: "Akvarell" })).toBe(true);
  });

  it("is false for any other medium", () => {
    expect(isWatercolorStyle(oil)).toBe(false);
    expect(isWatercolorStyle({ prompt: "a classical oil painting", label: "Olja" })).toBe(false);
    expect(isWatercolorStyle({ prompt: "clean minimalist line art" })).toBe(false);
  });
});

describe("legacyBuiltinRecipeId", () => {
  it("maps the reference-based modes", () => {
    expect(legacyBuiltinRecipeId({ subjectKind: "human" })).toBe("builtin-face-swap");
    expect(legacyBuiltinRecipeId({ subjectKind: "pet" })).toBe("builtin-pet");
  });

  it("routes removeBackground + simpleStyleMode with a usable style to the cutout chain", () => {
    expect(
      legacyBuiltinRecipeId({ subjectKind: "removeBackground", simpleStyleMode: true, style: oil }),
    ).toBe("builtin-style-cutout");
  });

  it("falls back off the chain when simpleStyleMode has no usable style text", () => {
    // Mirrors the edge: simpleStyleMode=true but empty instruction/prompt → Nano.
    // Empty prompt also means isWatercolorStyle → watercolor.
    expect(
      legacyBuiltinRecipeId({ subjectKind: "removeBackground", simpleStyleMode: true, style: { prompt: "" } }),
    ).toBe("builtin-nano-watercolor");
  });

  it("routes the Nano paths by watercolor-ness when simpleStyleMode is off", () => {
    expect(legacyBuiltinRecipeId({ subjectKind: "removeBackground", style: watercolor })).toBe(
      "builtin-nano-watercolor",
    );
    expect(legacyBuiltinRecipeId({ subjectKind: "removeBackground", style: oil })).toBe(
      "builtin-nano-backdrop",
    );
    // No style picked at all → watercolor default.
    expect(legacyBuiltinRecipeId({ subjectKind: "removeBackground" })).toBe("builtin-nano-watercolor");
  });

  it("does not take the chain for a non-simple watercolor even with an instruction", () => {
    expect(legacyBuiltinRecipeId({ subjectKind: "removeBackground", style: watercolor })).toBe(
      "builtin-nano-watercolor",
    );
  });
});

describe("resolveLegacyRecipe", () => {
  it("returns the reference-mode recipes with no style option", () => {
    const human = resolveLegacyRecipe({ subjectKind: "human" });
    expect(human.recipe.id).toBe("builtin-face-swap");
    expect(human.optionValues).toEqual({});

    const pet = resolveLegacyRecipe({ subjectKind: "pet" });
    expect(pet.recipe.id).toBe("builtin-pet");
    expect(pet.optionValues).toEqual({});
  });

  it("injects the long prompt for the Nano paths", () => {
    const wc = resolveLegacyRecipe({ subjectKind: "removeBackground", style: watercolor });
    expect(wc.recipe.id).toBe("builtin-nano-watercolor");
    expect(wc.optionValues.style).toBe(watercolor.prompt);

    const o = resolveLegacyRecipe({ subjectKind: "removeBackground", style: oil });
    expect(o.recipe.id).toBe("builtin-nano-backdrop");
    expect(o.optionValues.style).toBe(oil.prompt);
  });

  it("injects the bridged terse instruction for the cutout chain", () => {
    const r = resolveLegacyRecipe({ subjectKind: "removeBackground", simpleStyleMode: true, style: oil });
    expect(r.recipe.id).toBe("builtin-style-cutout");
    expect(r.optionValues.style).toBe(`${oil.bridge}. ${oil.styleInstruction}`);
  });

  it("injects exactly what the built-in recipe's own style option would, for every default style", () => {
    // Cross-check against the choices BUILTIN_RECIPES builds, so the legacy path
    // and an explicit binding send byte-identical values to the model.
    const nano = BUILTIN_RECIPES.find((r) => r.id === "builtin-nano-backdrop")!;
    const chain = BUILTIN_RECIPES.find((r) => r.id === "builtin-style-cutout")!;
    for (const s of DEFAULT_AI_STYLES) {
      const sel: LegacyStyleSelection = {
        prompt: s.prompt, styleInstruction: s.styleInstruction, bridge: s.bridge, label: s.label,
      };
      // Nano backdrop path (oil-like) — long prompt.
      const nanoChoice = nano.customerOptions![0].choices.find((c) => c.id === s.id)!;
      expect(resolveStyleValue({ prompt: s.prompt, styleInstruction: s.styleInstruction, bridge: s.bridge }, "prompt"))
        .toBe(nanoChoice.value);
      // Cutout chain path — bridged terse instruction.
      const backdrop = resolveLegacyRecipe({ subjectKind: "removeBackground", style: sel });
      void backdrop;
      const chainChoice = chain.customerOptions![0].choices.find((c) => c.id === s.id)!;
      const chained = resolveLegacyRecipe({ subjectKind: "removeBackground", simpleStyleMode: true, style: sel });
      expect(chained.optionValues.style).toBe(chainChoice.value);
    }
  });
});
