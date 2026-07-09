import { describe, expect, it } from "vitest";
import { aiRecipeSchema, BUILTIN_RECIPES, MODEL_CATALOG, type ModelId } from "./ai-recipe";

describe("BUILTIN_RECIPES", () => {
  it("every starter recipe validates against the schema", () => {
    // A starter that can't parse can't be cloned or saved — the empty
    // `choices: []` on the old art-style starter failed customerOption's min(1).
    for (const r of BUILTIN_RECIPES) {
      expect(() => aiRecipeSchema.parse(r), r.id).not.toThrow();
    }
  });

  it("only sets params the chosen model actually accepts", () => {
    const check = (model: ModelId, params: object | undefined, where: string) => {
      const allowed = MODEL_CATALOG[model].params as readonly string[];
      for (const key of Object.keys(params ?? {})) {
        expect(allowed, `${where}: ${model} does not accept ${key}`).toContain(key);
      }
    };
    for (const r of BUILTIN_RECIPES) {
      check(r.model, r.params, r.id);
      for (const s of r.steps ?? []) check(s.model, s.params, `${r.id} step`);
    }
  });

  it("prompt placeholders resolve to a declared customerOption", () => {
    for (const r of BUILTIN_RECIPES) {
      const injectable = new Set((r.customerOptions ?? []).map((o) => o.injectAs));
      for (const [, token] of (r.prompt ?? "").matchAll(/\{(\w+)\}/g)) {
        expect(injectable, `${r.id}: {${token}} has no customerOption`).toContain(token);
      }
    }
  });

  it("style+cutout restyles before cutting out", () => {
    // Order matters: a cutout first would hand Kontext a transparent PNG.
    const r = BUILTIN_RECIPES.find((x) => x.id === "builtin-style-cutout")!;
    expect(r.model).toBe("art-style");
    expect(r.steps?.map((s) => s.model)).toEqual(["cutout"]);
    expect(r.params.outputFormat).toBe("png");
  });
});
