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
    blurb: "Clean background removal; pairs with a backdrop/ring step.",
    replicate: "851-labs/background-remover",
    usesPrompt: false,
    customerImages: { min: 1, max: 1 },
    referenceImages: { min: 0, max: 0 },
    params: ["backdropColor", "outputFormat"],
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
// Built-in starter recipes — reproduce today's five modes. Prompts are finalized
// against the current edge-function prompts when the executor is wired (2c/2d).
// ─────────────────────────────────────────────────────────────────────────────
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
    name: "Cutout on a backdrop",
    description: "Remove the background and place the subject on a clean backdrop.",
    model: "cutout",
    params: { backdropColor: "#FFFFFF" },
    builtIn: true,
  },
  {
    id: "builtin-art-style",
    name: "Art style",
    description: "Let the customer restyle their photo with one of your styles.",
    model: "art-style",
    prompt: "{style}",
    customerOptions: [
      { id: "style", label: "Choose a style", injectAs: "style", choices: [] },
    ],
    builtIn: true,
  },
];
