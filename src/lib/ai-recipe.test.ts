import { describe, expect, it } from "vitest";
import {
  aiRecipeSchema,
  BUILTIN_RECIPES,
  hasCutoutFinish,
  MODEL_CATALOG,
  promptTokens,
  pruneCustomerOptions,
  recipeChain,
  setCutoutFinish,
  validateRecipeOptions,
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
