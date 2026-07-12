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
import {
  NANO_SOLID_BACKDROP_PROMPT,
  NANO_WATERCOLOR_CUTOUT_PROMPT,
} from "./ai-recipe-prompts";

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

/** The recipe binding on a media layer: which recipe, its references, and what
 *  the customer's photo depicts. Per-template — the same recipe reused across
 *  products has a different motif on each. */
export const mediaLayerAiSchema = z.object({
  recipeId: z.string().min(1),
  references: z.array(recipeReferenceSchema).default([]),
  customerHint: z.string().optional(),
  /** What the customer uploads, e.g. "a pet" / "a residential house". Injected
   *  into the prompt at `{motif}`. NOT a customer choice — it describes this
   *  template's subject. Load-bearing: without it a background-removal recipe
   *  keeps the whole scene (measured on diag6/stress/house1.jpg). */
  motif: z.string().optional(),
  /** Preselected customerOption choices, keyed by CustomerOption.id. */
  optionDefaults: z.record(z.string()).optional(),
});
export type MediaLayerAi = z.infer<typeof mediaLayerAiSchema>;

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
/** The text a style contributes to a recipe's `{style}` slot. `prompt` picks the
 *  long descriptive prompt (art-style / nano, which already name their own
 *  medium); `styleInstruction` picks the terse instruction prefixed by the
 *  style's `bridge` (the style→cutout chain, where Kontext needs the medium named
 *  up front or it returns a photograph). Legacy inferred the bridge from the
 *  label with a regex; here it is data. Shared with the legacy resolver so the
 *  customer editor injects the identical value whether a layer carries an
 *  explicit recipe or an old `subjectKind` mode. */
export function resolveStyleValue(
  style: { prompt: string; styleInstruction?: string; bridge?: string },
  pick: "prompt" | "styleInstruction",
): string {
  if (pick === "prompt") return style.prompt;
  const terse = style.styleInstruction || style.prompt;
  return style.bridge ? `${style.bridge}. ${terse}` : terse;
}

function styleChoices(pick: "prompt" | "styleInstruction") {
  return DEFAULT_AI_STYLES.map((s) => ({
    id: s.id,
    label: s.label,
    value: resolveStyleValue(s, pick),
    thumbnailUrl: s.thumbnailUrl,
  }));
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
    // A general image editor regenerates the whole frame, so the background only
    // holds if the prompt frames this as an EDIT of image #1 and enumerates what
    // to preserve. Ported from the original app's pet route, which held the scene
    // near-identical on prompt alone.
    prompt:
      "You are editing image #1 (the reference scene). Image #2 is a photograph of the customer's own pet (a cat or a dog). " +
      "Replace the pet that appears in image #1 with the specific pet from image #2 — keep the unique markings, fur colour/pattern, breed traits, eye colour, ear shape and overall identity from image #2. " +
      "Keep EVERYTHING ELSE from image #1 unchanged: the costume/clothing, props, background, lighting, camera angle, art style, composition, framing and aspect ratio. Do not change the pose unless required to make the new pet fit naturally. " +
      "Return ONE single edited image (not a collage, side-by-side or comparison).",
    params: { aspectRatio: "match_layer" },
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
    params: { aspectRatio: "match_layer", outputFormat: "jpg" },
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
    params: { aspectRatio: "match_layer", outputFormat: "png" },
    customerOptions: [styleOption("styleInstruction")],
    steps: [{ model: "cutout", input: "previous", params: { outputFormat: "png" } }],
    builtIn: true,
  },
  {
    // Arthena's signature look. Was imposed on any style whose LABEL matched
    // /water\s*colou?r|akvarell|aquarelle/; now you choose it.
    id: "builtin-nano-watercolor",
    name: "Watercolor cutout with splatter",
    description:
      "Removes the background onto white, restyles the subject, and scatters loose paint droplets around it.",
    model: "ai-edit",
    prompt: NANO_WATERCOLOR_CUTOUT_PROMPT,
    params: { aspectRatio: "match_layer", outputFormat: "png" },
    customerOptions: [styleOption("prompt")],
    builtIn: true,
  },
  {
    // The other half of the old `isWatercolorStyle` branch. Nano paints its own
    // backdrop in one call, so this is what oil and other surface-implying
    // styles need — they cannot survive the art-style→cutout chain.
    id: "builtin-nano-backdrop",
    name: "Cutout on a solid backdrop",
    description:
      "Removes the background onto a clean white backdrop and restyles the subject. No droplets. Works with painterly styles.",
    model: "ai-edit",
    prompt: NANO_SOLID_BACKDROP_PROMPT,
    params: { aspectRatio: "match_layer", outputFormat: "png" },
    customerOptions: [styleOption("prompt")],
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

/** Tokens the executor fills from the layer binding, not from a customer choice.
 *  They must NOT get a customerOption or a save-blocking validation error. */
export const RESERVED_TOKENS = new Set(["motif"]);

export function isReservedToken(token: string): boolean {
  return RESERVED_TOKENS.has(token);
}

/** Prompt tokens the merchant must wire as customer choices — the reserved ones
 *  removed. This is what the editor renders choice editors for. */
export function customerTokens(prompt: string | undefined): string[] {
  return promptTokens(prompt).filter((t) => !isReservedToken(t));
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
  for (const token of customerTokens(recipe.prompt)) {
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

/** Does this recipe composite the customer's photo onto an admin reference (so a
 *  reference-image editor makes sense)? Face-swap always does; an ai-edit recipe
 *  that composites the customer's photo onto a reference (its prompt refers to
 *  "image #2") does too. Background-removal / art-style recipes work on the
 *  customer photo alone, so they take no references. The references are a PICKER
 *  pool — the customer chooses one and only that (+ their photo) is sent — so
 *  there is no upper bound on how many the merchant can offer. */
export function recipeUsesReferences(recipe: { model: ModelId; prompt?: string }): boolean {
  return (
    MODEL_CATALOG[recipe.model].referenceImages.min > 0 ||
    /image\s*#?\s*2/i.test(recipe.prompt ?? "")
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Aspect ratio buckets — models (flux-kontext-pro, nano-banana-2) accept a fixed
// set of `aspect_ratio` values, not arbitrary ratios. `match_layer` resolves to
// the nearest of these to the layer's own width/height (computed client-side and
// sent literally), so the output fills the layer box with minimal cropping.
// ─────────────────────────────────────────────────────────────────────────────
const ASPECT_BUCKETS: Array<[string, number]> = [
  ["21:9", 21 / 9], ["16:9", 16 / 9], ["3:2", 3 / 2], ["4:3", 4 / 3], ["5:4", 5 / 4],
  ["1:1", 1], ["4:5", 4 / 5], ["3:4", 3 / 4], ["2:3", 2 / 3], ["9:16", 9 / 16], ["9:21", 9 / 21],
];

/** The supported `aspect_ratio` bucket nearest to a width/height ratio, chosen in
 *  log space so proportional error (not absolute) decides the match. */
export function nearestAspectBucket(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return "1:1";
  let best = ASPECT_BUCKETS[0];
  let bestErr = Infinity;
  for (const b of ASPECT_BUCKETS) {
    const err = Math.abs(Math.log(ratio) - Math.log(b[1]));
    if (err < bestErr) {
      bestErr = err;
      best = b;
    }
  }
  return best[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Binding resolution — turn a media layer's recipe binding into a runnable
// recipe for the customer editor / preview. The counterpart to the legacy
// `resolveLegacyRecipe`: a bound layer names a recipe explicitly, so there is no
// subjectKind guessing — just look the recipe up and expose its style option.
// ─────────────────────────────────────────────────────────────────────────────

/** Look up a built-in recipe by id. */
export function findBuiltinRecipe(recipeId: string): AiRecipe | null {
  return BUILTIN_RECIPES.find((r) => r.id === recipeId) ?? null;
}

export interface ResolvedBinding {
  recipe: AiRecipe;
  /** The customer's style choice, if this recipe has one (injectAs "style").
   *  Null for the reference-based recipes (face-swap / pet) and plain cutout. */
  styleOption: CustomerOption | null;
  /** What the customer's photo depicts — fills the reserved `{motif}`. */
  motif?: string;
  references: RecipeReference[];
}

/** Resolve a media-layer recipe binding for RUNTIME. Returns null when there is
 *  no binding, or when the bound recipe isn't in `available` — the storefront
 *  can't read `ai_recipes` (RLS), so a saved (non-builtin) recipe resolves to
 *  null here and is instead embedded into the template at publish time. Callers
 *  that DO have the recipes (admin preview, a published snapshot) pass them in
 *  via `available`; the default pool is the built-ins, which always resolve. */
export function resolveBindingRecipe(
  binding: MediaLayerAi | undefined | null,
  available: AiRecipe[] = BUILTIN_RECIPES,
): ResolvedBinding | null {
  if (!binding?.recipeId) return null;
  const recipe = available.find((r) => r.id === binding.recipeId);
  if (!recipe) return null;
  const styleOption = recipe.customerOptions?.find((o) => o.injectAs === "style") ?? null;
  return { recipe, styleOption, motif: binding.motif, references: binding.references ?? [] };
}
