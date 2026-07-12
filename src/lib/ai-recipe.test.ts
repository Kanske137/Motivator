import { describe, expect, it } from "vitest";
import {
  aiRecipeSchema,
  BUILTIN_RECIPES,
  findBuiltinRecipe,
  hasCutoutFinish,
  MODEL_CATALOG,
  promptTokens,
  pruneCustomerOptions,
  recipeChain,
  resolveBindingRecipe,
  setCutoutFinish,
  validateRecipeOptions,
  customerTokens,
  isReservedToken,
  mediaLayerAiSchema,
  type ModelId,
} from "./ai-recipe";
import { DEFAULT_AI_STYLES } from "./ai-style-defaults";

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

  it("every customer-facing placeholder resolves to a declared customerOption", () => {
    // Reserved tokens like {motif} come from the binding, not an option.
    for (const r of BUILTIN_RECIPES) {
      const injectable = new Set((r.customerOptions ?? []).map((o) => o.injectAs));
      for (const token of customerTokens(r.prompt)) {
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

describe("style palette bridges", () => {
  const choices = (id: string) =>
    BUILTIN_RECIPES.find((r) => r.id === id)!.customerOptions![0].choices;

  it("every starter style declares a bridge", () => {
    for (const s of DEFAULT_AI_STYLES) {
      expect(s.bridge, `${s.id} has no bridge`).toBeTruthy();
      // The whole point: tell Kontext this is not a photograph.
      expect(s.bridge, `${s.id}`).toMatch(/not a photo$/);
    }
  });

  it("the chained recipe prefixes each terse instruction with its bridge", () => {
    for (const c of choices("builtin-style-cutout")) {
      const style = DEFAULT_AI_STYLES.find((s) => s.id === c.id)!;
      expect(c.value).toBe(`${style.bridge}. ${style.styleInstruction}`);
    }
  });

  it("the un-chained recipe uses the long prompt and adds no bridge", () => {
    // Its prompt already names the medium; a bridge would just repeat it.
    for (const c of choices("builtin-art-style")) {
      const style = DEFAULT_AI_STYLES.find((s) => s.id === c.id)!;
      expect(c.value).toBe(style.prompt);
      expect(c.value).not.toContain("not a photo");
    }
  });

  it("carries the medium as data, so nothing has to guess it from the label", () => {
    // Legacy regex-matched "akvarell|watercolor" etc. against the label. The
    // labels here are Swedish; the bridges are English. A regex on the value
    // would have to know both. It no longer has to know either.
    const watercolor = DEFAULT_AI_STYLES.find((s) => s.id === "watercolor")!;
    expect(watercolor.label).toBe("Akvarell");
    expect(watercolor.bridge).toContain("watercolor");
  });
});

describe("nano starter recipes (the old isWatercolorStyle branch, as a choice)", () => {
  const wc = BUILTIN_RECIPES.find((r) => r.id === "builtin-nano-watercolor")!;
  const solid = BUILTIN_RECIPES.find((r) => r.id === "builtin-nano-backdrop")!;

  it("both paint their own backdrop in one call — no cutout step", () => {
    // That is exactly why they work for oil, which the art-style chain cannot.
    for (const r of [wc, solid]) {
      expect(r.model).toBe("ai-edit");
      expect(r.steps).toBeUndefined();
    }
  });

  it("only the watercolor one asks for splatter; the other forbids it", () => {
    expect(wc.prompt).toContain("Add loose, organic watercolor splatter");
    expect(solid.prompt).toContain("Do NOT add any watercolor dots");
    expect(solid.prompt).not.toContain("Add loose, organic watercolor splatter");
  });

  it("keeps the merchant's style slot", () => {
    for (const r of [wc, solid]) {
      expect(customerTokens(r.prompt)).toEqual(["style"]);
      expect(promptTokens(r.prompt)).toContain("motif");
      expect(validateRecipeOptions(r)).toBeNull();
    }
  });

  it("leaves no unresolved template literal from the extraction", () => {
    for (const r of [wc, solid]) expect(r.prompt).not.toContain("${");
  });
});

describe("setCutoutFinish", () => {
  it("appends a cutout step and forces PNG out of the main model", () => {
    const r = setCutoutFinish({ model: "art-style" as ModelId, params: { outputFormat: "jpg" } }, true);
    expect(recipeChain(r)).toEqual(["art-style", "cutout"]);
    expect(r.params.outputFormat).toBe("png");
  });

  it("is idempotent — ticking twice does not cut out twice", () => {
    const once = setCutoutFinish({ model: "art-style" as ModelId, params: {} }, true);
    expect(recipeChain(setCutoutFinish(once, true))).toEqual(["art-style", "cutout"]);
  });

  it("removes the step when unticked", () => {
    const on = setCutoutFinish({ model: "ai-edit" as ModelId, params: {} }, true);
    expect(hasCutoutFinish(setCutoutFinish(on, false))).toBe(false);
  });

  it("refuses to finish a cutout with another cutout", () => {
    // Guards the setModel path: clone style+cutout, switch the model to cutout.
    const r = setCutoutFinish({ model: "cutout" as ModelId, params: {} }, true);
    expect(recipeChain(r)).toEqual(["cutout"]);
  });

  it("preserves unrelated steps", () => {
    const r = setCutoutFinish(
      {
        model: "art-style" as ModelId,
        params: {},
        steps: [{ model: "ai-edit" as ModelId, input: "previous" as const }],
      },
      true,
    );
    expect(recipeChain(r)).toEqual(["art-style", "ai-edit", "cutout"]);
  });
});

describe("reserved {motif} token", () => {
  it("motif is reserved; style is not", () => {
    expect(isReservedToken("motif")).toBe(true);
    expect(isReservedToken("style")).toBe(false);
  });

  it("customerTokens hides motif but keeps real choices", () => {
    expect(customerTokens("a {style} {motif} on white")).toEqual(["style"]);
  });

  it("a prompt whose ONLY token is {motif} needs no customer options", () => {
    // Otherwise the motif-only nano recipes could never be saved.
    expect(validateRecipeOptions({ prompt: "Isolate {motif} on white." })).toBeNull();
  });

  it("still demands options for a real token sitting next to {motif}", () => {
    expect(validateRecipeOptions({ prompt: "{style} of {motif}" })).toMatch(/\{style\}/);
  });

  it("the binding accepts an optional motif", () => {
    const bound = mediaLayerAiSchema.parse({ recipeId: "r1", motif: "a pet" });
    expect(bound.motif).toBe("a pet");
    expect(mediaLayerAiSchema.parse({ recipeId: "r1" }).motif).toBeUndefined();
  });
});

describe("customer options", () => {
  it("finds each distinct prompt token once", () => {
    expect(promptTokens("a {style} of {subject}, very {style}")).toEqual(["style", "subject"]);
  });

  it("rejects a prompt token with no option — runRecipe would ship it literally", () => {
    expect(validateRecipeOptions({ prompt: "{style}" })).toMatch(/\{style\}/);
  });

  it("rejects an option with no choices", () => {
    const err = validateRecipeOptions({
      prompt: "{style}",
      customerOptions: [{ id: "style", label: "Choose a style", injectAs: "style", choices: [] }],
    });
    expect(err).toMatch(/at least one choice/);
  });

  it("accepts a fully wired prompt", () => {
    expect(
      validateRecipeOptions({
        prompt: "{style}",
        customerOptions: [
          {
            id: "style",
            label: "Choose a style",
            injectAs: "style",
            choices: [{ id: "w", label: "Watercolour", value: "watercolour" }],
          },
        ],
      }),
    ).toBeNull();
  });

  it("prunes options the prompt no longer refers to", () => {
    const pruned = pruneCustomerOptions({
      prompt: "a plain portrait",
      customerOptions: [
        {
          id: "style",
          label: "Choose a style",
          injectAs: "style",
          choices: [{ id: "w", label: "W", value: "w" }],
        },
      ],
    });
    expect(pruned.customerOptions).toBeUndefined();
  });
});

describe("resolveBindingRecipe", () => {
  it("returns null when there is no binding or no recipeId", () => {
    expect(resolveBindingRecipe(undefined)).toBeNull();
    expect(resolveBindingRecipe(null)).toBeNull();
    expect(resolveBindingRecipe({ recipeId: "", references: [] } as never)).toBeNull();
  });

  it("resolves a built-in recipe and exposes its style option, motif and references", () => {
    const refs = [{ id: "r1", url: "https://x/r.png", orientation: "any" as const }];
    const res = resolveBindingRecipe({
      recipeId: "builtin-nano-backdrop",
      references: refs,
      motif: "a residential house",
    });
    expect(res).not.toBeNull();
    expect(res!.recipe.id).toBe("builtin-nano-backdrop");
    expect(res!.styleOption?.injectAs).toBe("style");
    expect(res!.styleOption!.choices.length).toBeGreaterThan(0);
    expect(res!.motif).toBe("a residential house");
    expect(res!.references).toEqual(refs);
  });

  it("has no style option for the reference-based recipes", () => {
    const face = resolveBindingRecipe({ recipeId: "builtin-face-swap", references: [] });
    expect(face!.recipe.id).toBe("builtin-face-swap");
    expect(face!.styleOption).toBeNull();

    const cut = resolveBindingRecipe({ recipeId: "builtin-cutout", references: [] });
    expect(cut!.styleOption).toBeNull();
  });

  it("returns null for a saved (non-builtin) recipe id — not resolvable storefront-side", () => {
    expect(resolveBindingRecipe({ recipeId: "8f3c-uuid-saved", references: [] })).toBeNull();
  });

  it("resolves a supplied recipe when the caller has it (admin preview / snapshot)", () => {
    const saved = { ...BUILTIN_RECIPES[0], id: "8f3c-uuid-saved", name: "My saved" };
    const res = resolveBindingRecipe({ recipeId: "8f3c-uuid-saved", references: [] }, [...BUILTIN_RECIPES, saved]);
    expect(res!.recipe.name).toBe("My saved");
  });

  it("findBuiltinRecipe looks up by id", () => {
    expect(findBuiltinRecipe("builtin-pet")?.model).toBe("ai-edit");
    expect(findBuiltinRecipe("nope")).toBeNull();
  });
});
