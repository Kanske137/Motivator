// AiRecipe — the one primitive for every AI image edit.
//
// See the design draft (artifact "airecipe-draft-v2"). This module is PURE
// TYPES + a curated catalog + built-in starter recipes. It is additive: nothing
// consumes it yet. The executor (Step 2b/2c) and the admin editor (Step 3) build
// on top; the existing `subjectKind` flow keeps working untouched until migrated.
//
// Split the HOW from the WHAT:
//   - AiRecipe (the how)   → model + prompt + params. Reusable; shop-level library.
//   - MediaLayerAi (the what) → a layer points at a recipe + supplies references.
import { z } from "zod";
import { DEFAULT_AI_STYLES } from "./ai-style-defaults";

// ─────────────────────────────────────────────────────────────────────────────
// Model catalog — curated. We own the Replicate identifiers + params. Merchants
// pick from this; they never wire a raw model. Adding a model later = one entry
// here + one adapter in the edge function.
// ─────────────────────────────────────────────────────────────────────────────
export const modelIdSchema = z.enum(["face-swap", "ai-edit", "art-style", "cutout"]);
export type ModelId = z.infer<typeof modelIdSchema>;

export const recipeParamKeys = ["aspectRatio", "outputFormat", "backdropColor"] as const;
export type RecipeParamKey = (typeof recipeParamKeys)[number];

export interface ModelSpec {
  id: ModelId;
  /** Merchant-facing name. */
  label: string;
  /** One line: what it's good at. */
  blurb: string;
  /** Replicate `owner/model[:version]` — used by the edge adapter, not the UI. */
  replicate: string;
  /** Whether the merchant's prompt is sent to the model (cutout/face-swap ignore it). */
  usesPrompt: boolean;
  /** How many photos the customer uploads. */
  customerImages: { min: number; max: number };
  /** How many admin reference images the recipe consumes. */
  referenceImages: { min: number; max: number };
  /** Which recipe params apply to this model (drives the Advanced UI). */
  params: RecipeParamKey[];
  costTier: "low" | "med" | "high";
}

export const MODEL_CATALOG: Record<ModelId, ModelSpec> = {
  "face-swap": {
    id: "face-swap",
    label: "Face swap (person)",
    blurb: "Deterministic person swap; preserves everything but the face; keeps the reference aspect ratio.",
    replicate: "cdingram/face-swap:d1d6ea8c8be89d664a07a457526f7128109dee7030fdac424788d762c71ed111",
    usesPrompt: false,
    customerImages: { min: 1, max: 1 },
    referenceImages: { min: 1, max: 1 },
    params: ["outputFormat"],
    costTier: "low",
  },
  "ai-edit": {
    id: "ai-edit",
    label: "AI photo edit",
    blurb: "Prompted multi-image edits — pet portraits, full-head swaps, scene compositing.",
    // Nano Banana 2 (Gemini 3.1) — the original app's model. cdingram can't do
    // animals, so pets / prompted edits run here.
    replicate: "google/nano-banana-2",
    usesPrompt: true,
    customerImages: { min: 1, max: 4 },
    referenceImages: { min: 0, max: 3 },
    params: ["aspectRatio", "outputFormat"],
    costTier: "med",
  },
  "art-style": {
    id: "art-style",
    label: "Art style",
    blurb: "Applies an artistic style while holding the subject's geometry.",
    replicate: "black-forest-labs/flux-kontext-pro",
    usesPrompt: true,
    customerImages: { min: 1, max: 1 },
    referenceImages: { min: 0, max: 0 },
    params: ["aspectRatio", "outputFormat"],
    costTier: "med",
  },
  cutout: {
    id: "cutout",
    label: "Cutout (remove background)",
    blurb: "Clean background removal to a transparent PNG; the template's own background shows through.",
    replicate: "851-labs/background-remover",
    usesPrompt: false,
    customerImages: { min: 1, max: 1 },
    referenceImages: { min: 0, max: 0 },
    // No backdropColor: the adapter always returns transparent RGBA. A solid
    // backdrop is the template's job, not the model's.
    params: ["outputFormat"],
    costTier: "low",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Recipe pieces
// ─────────────────────────────────────────────────────────────────────────────

/** Model params. The catalog says which apply to the chosen model; the executor
 *  translates these into each model's native inputs (e.g. aspectRatio →
 *  Replicate `aspect_ratio: "match_input_image"`). */
export const recipeParamsSchema = z.object({
  aspectRatio: z
    .union([z.enum(["match_reference", "match_customer", "match_layer"]), z.string()])
    .optional(),
  outputFormat: z.enum(["png", "jpg"]).optional(),
  backdropColor: z.string().regex(/^#([0-9a-fA-F]{6})$/).optional(),
});
export type RecipeParams = z.infer<typeof recipeParamsSchema>;

/** A runtime choice the CUSTOMER makes (e.g. an art-style picker). The chosen
 *  `value` is injected into the prompt at the `injectAs` placeholder. */
export const customerOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Placeholder name in the prompt, e.g. "style" → replaces `{style}`. */
  injectAs: z.string().min(1),
  choices: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        value: z.string(),
        thumbnailUrl: z.string().url().optional(),
      }),
    )
    .min(1),
});
export type CustomerOption = z.infer<typeof customerOptionSchema>;

/** An optional post-processing step — e.g. art-style → then cutout. Runs after
 *  the recipe's main model; `input` says what feeds it. */
export const recipeStepSchema = z.object({
  model: modelIdSchema,
  prompt: z.string().optional(),
  params: recipeParamsSchema.optional(),
  input: z.enum(["previous", "customer", "reference"]),
});
export type RecipeStep = z.infer<typeof recipeStepSchema>;

/** The reusable transformation. Lives in the shop's recipe library. */
export const aiRecipeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  model: modelIdSchema,
  /** Merchant-authored. Supports `{customer}`, `{reference}` and customerOption
   *  placeholders like `{style}`. Ignored by prompt-less models. */
  prompt: z.string().optional(),
  params: recipeParamsSchema.default({}),
  customerOptions: z.array(customerOptionSchema).optional(),
  steps: z.array(recipeStepSchema).optional(),
  /** System starter: clonable, not edited in place. */
  builtIn: z.boolean().optional(),
});
export type AiRecipe = z.infer<typeof aiRecipeSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Layer binding — per template (references are template content, not recipe logic)
// ─────────────────────────────────────────────────────────────────────────────

/** An admin reference image bound to a recipe's reference slot. Keeps today's
 *  focal + orientation semantics so it renders identically. */
export const recipeReferenceSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  label: z.string().optional(),
  orientation: z.enum(["portrait", "landscape", "any"]).default("any"),
  focalX: z.number().min(-50).max(50).optional(),
  focalY: z.number().min(-50).max(50).optional(),
  /** Which reference slot this fills (multi-reference recipes). */
  slot: z.number().int().nonnegative().optional(),
});
export type RecipeReference = z.infer<typeof recipeReferenceSchema>;

/** Attached to an aiPhoto (advanced) layer: which recipe + its references. */
export const mediaLayerAiSchema = z.object({
  recipeId: z.string().min(1),
  references: z.array(recipeReferenceSchema).default([]),
  customerHint: z.string().optional(),
  /** Preselected customerOption choices, keyed by CustomerOption.id. */
  optionDefaults: z.record(z.string()).optional(),
});
export type MediaLayerAi = z.infer<typeof mediaLayerAiSchema>;

/** The SIMPLE tier — attached to a regular photo layer. The customer can restyle
 *  their uploaded photo with one of the template's AI styles (art-style model).
 *  NOT the full recipe editor. */
export const photoLayerStyleSchema = z.object({
  enabled: z.boolean(),
  /** Which of the template's AiStyles to offer (default: all). */
  styleIds: z.array(z.string()).optional(),
});
export type PhotoLayerStyle = z.infer<typeof photoLayerStyleSchema>;

/** Template-level shared style palette (the ~6). Already exists today as
 *  `aiStylePresets`; declared here so both the simple photo-layer tier and an
 *  advanced recipe's style option can draw from the same list. Each is a
 *  flux-kontext-pro prompt. */
export const aiStyleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  prompt: z.string().min(1),
  thumbnailUrl: z.string().url().optional(),
});
export type AiStyle = z.infer<typeof aiStyleSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Built-in starter recipes — reproduce today's modes. Prompts are finalized
// against the current edge-function prompts when the executor is wired (2c/2d).
// ─────────────────────────────────────────────────────────────────────────────

/** The starter style palette as customerOption choices.
 *
 *  `pick` chooses which text reaches the model. Alone, art-style takes the long
 *  descriptive `prompt`, which already names its medium at length. In the
 *  style→cutout chain it takes the short `styleInstruction` — what the legacy
 *  `simpleStyleMode` path feeds Kontext — prefixed by the style's `bridge`,
 *  because Kontext hands back a photograph when the instruction is that terse.
 *  Legacy inferred that bridge with a regex over the label; here it is data, so
 *  a merchant's own style simply carries its own wording. */
function styleChoices(pick: "prompt" | "styleInstruction") {
  return DEFAULT_AI_STYLES.map((s) => {
    const terse = s.styleInstruction || s.prompt;
    return {
      id: s.id,
      label: s.label,
      value:
        pick === "prompt"
          ? s.prompt
          : s.bridge
            ? `${s.bridge}. ${terse}`
            : terse,
      thumbnailUrl: s.thumbnailUrl,
    };
  });
}

function styleOption(pick: "prompt" | "styleInstruction"): CustomerOption {
  return { id: "style", label: "Choose a style", injectAs: "style", choices: styleChoices(pick) };
}

/** Backs the editor's "fill from my styles" shortcut. Short instructions: the
 *  only chain we ship ends in a cutout, where terse styling survives best. */
export const STYLE_PALETTE_CHOICES = styleChoices("styleInstruction");

export const BUILTIN_RECIPES: AiRecipe[] = [
  {
    id: "builtin-face-swap",
    name: "Face swap onto a costume",
    description: "Swap the customer's face onto your reference image.",
    model: "face-swap",
    params: {},
    builtIn: true,
  },
  {
    id: "builtin-pet",
    name: "Pet portrait",
    description: "Place the customer's pet into your reference scene.",
    model: "ai-edit",
    prompt:
      "Replace the pet in image #1 with the specific pet from image #2 — keep its markings, fur, breed and eye colour. Keep everything else in image #1 unchanged.",
    params: { aspectRatio: "match_reference" },
    builtIn: true,
  },
  {
    id: "builtin-cutout",
    name: "Cutout (transparent)",
    description:
      "Remove the background and keep the subject on transparency, over the template's own background.",
    model: "cutout",
    params: { outputFormat: "png" },
    builtIn: true,
  },
  {
    id: "builtin-art-style",
    name: "Art style",
    description: "Let the customer restyle their photo with one of your styles.",
    model: "art-style",
    prompt: "{style}",
    params: { aspectRatio: "match_customer", outputFormat: "jpg" },
    customerOptions: [styleOption("prompt")],
    builtIn: true,
  },
  {
    // Mirrors the legacy `simpleStyleMode` route: Kontext restyles, then the
    // background-remover cuts the styled subject out. Style FIRST — running the
    // cutout first would hand Kontext a transparent PNG and it would repaint the
    // background back in.
    id: "builtin-style-cutout",
    name: "Art style + cutout",
    description:
      "Restyle the customer's photo, then remove the background — the styled subject lands on your template's background.",
    model: "art-style",
    prompt: "{style}",
    params: { aspectRatio: "match_customer", outputFormat: "png" },
    customerOptions: [styleOption("styleInstruction")],
    steps: [{ model: "cutout", input: "previous", params: { outputFormat: "png" } }],
    builtIn: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Recipe shaping — shared by the editor and its tests.
// ─────────────────────────────────────────────────────────────────────────────

/** Shape of a recipe mid-edit: the editor's draft has no `id` yet. */
type RecipeShape = { model: ModelId; params?: RecipeParams; steps?: RecipeStep[] };

/** Models a background-removal finish can follow. `cutout` is absent because it
 *  already IS one, and `art-style` after a cutout would repaint the background. */
export const CUTOUT_FINISH_MODELS: ModelId[] = ["face-swap", "ai-edit", "art-style"];

export function canFinishWithCutout(model: ModelId): boolean {
  return CUTOUT_FINISH_MODELS.includes(model);
}

export function hasCutoutFinish(recipe: RecipeShape): boolean {
  return (recipe.steps ?? []).some((s) => s.model === "cutout");
}

/** Toggle the background-removal finish. Enabling forces the main model to emit
 *  PNG — the cutout needs an alpha channel to write into. Disabling (or a model
 *  that can't take the finish) strips the step. */
export function setCutoutFinish<T extends RecipeShape>(recipe: T, enabled: boolean): T {
  const steps = (recipe.steps ?? []).filter((s) => s.model !== "cutout");
  if (!enabled || !canFinishWithCutout(recipe.model)) {
    return { ...recipe, steps: steps.length > 0 ? steps : undefined };
  }
  return {
    ...recipe,
    params: { ...(recipe.params ?? {}), outputFormat: "png" },
    steps: [...steps, { model: "cutout", input: "previous", params: { outputFormat: "png" } }],
  };
}

/** `"a {style} of {subject}"` → `["style", "subject"]`. */
export function promptTokens(prompt: string | undefined): string[] {
  if (!prompt) return [];
  return [...new Set([...prompt.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
}

/** Save-time guard. `runRecipe` leaves an unmatched `{token}` untouched, so a
 *  prompt whose token has no customerOption ships the literal text `{style}` to
 *  the model — and the Test panel hides it, because there you type the value by
 *  hand. Returns an error message, or null when the recipe is coherent. */
export function validateRecipeOptions(recipe: {
  prompt?: string;
  customerOptions?: CustomerOption[];
}): string | null {
  const options = recipe.customerOptions ?? [];
  for (const token of promptTokens(recipe.prompt)) {
    const option = options.find((o) => o.injectAs === token);
    if (!option) return `Add customer choices for {${token}}, or remove it from the prompt.`;
    if (option.choices.length === 0) return `"${option.label}" needs at least one choice.`;
  }
  return null;
}

/** Drop options the prompt no longer refers to, so an edited prompt doesn't
 *  leave orphans behind. */
export function pruneCustomerOptions<T extends { prompt?: string; customerOptions?: CustomerOption[] }>(
  recipe: T,
): T {
  if (!recipe.customerOptions?.length) return recipe;
  const live = new Set(promptTokens(recipe.prompt));
  const kept = recipe.customerOptions.filter((o) => live.has(o.injectAs));
  return { ...recipe, customerOptions: kept.length > 0 ? kept : undefined };
}

/** The models a recipe runs, in order — `["art-style", "cutout"]`. */
export function recipeChain(recipe: RecipeShape): ModelId[] {
  return [recipe.model, ...(recipe.steps ?? []).map((s) => s.model)];
}
