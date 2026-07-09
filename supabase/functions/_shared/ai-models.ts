// Model-adapter registry + the generic recipe executor (Step 2b).
//
// Each adapter builds one model's native Replicate input and runs it through the
// shared `replicatePredict`. `runRecipe` fills prompt placeholders, calls the
// recipe's model, then runs any `steps[]` chain. Returns image bytes + the URL —
// the caller uploads and keeps the existing `aiPhotoResults[layerId]` contract.
//
// This is ADDITIVE: the legacy `subjectKind` routes are untouched. The executor
// only runs when a request carries a `recipe`.
import { replicatePredict } from "./replicate.ts";

export type ModelId = "face-swap" | "ai-edit" | "art-style" | "cutout";

// Edge-side model identifiers (the frontend MODEL_CATALOG mirrors these for UI).
const PREDICTIONS_URL = "https://api.replicate.com/v1/predictions";
const FACE_SWAP_VERSION =
  "d1d6ea8c8be89d664a07a457526f7128109dee7030fdac424788d762c71ed111";
const NANO_BANANA_URL =
  "https://api.replicate.com/v1/models/google/nano-banana/predictions";
const FLUX_KONTEXT_URL =
  "https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions";
const BG_REMOVER_VERSION =
  "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc";

export interface RecipeParams {
  /** "match_reference" | "match_customer" | "match_layer" | a literal ratio. */
  aspectRatio?: string;
  outputFormat?: "png" | "jpg";
  backdropColor?: string;
}

export interface AdapterInput {
  prompt?: string;
  customerImageUrls: string[];
  referenceImageUrls: string[];
  params?: RecipeParams;
}

export type AdapterResult =
  | { ok: true; bytes: Uint8Array; contentType: string; outputUrl: string }
  | { ok: false; status: number; error: string };

/** Our aspectRatio param → Replicate's `aspect_ratio` value. The match_* values
 *  all resolve to `match_input_image` (which matches the FIRST input image). */
function mapAspect(a?: string): string | undefined {
  if (!a) return undefined;
  if (a === "match_reference" || a === "match_customer" || a === "match_layer") {
    return "match_input_image";
  }
  return a;
}

function toResult(res: Awaited<ReturnType<typeof replicatePredict>>): AdapterResult {
  return res.ok
    ? { ok: true, bytes: res.bytes, contentType: res.contentType, outputUrl: res.outputUrl }
    : { ok: false, status: res.status, error: `${res.stage}: ${res.error}` };
}

// ── Adapters ─────────────────────────────────────────────────────────────────

async function faceSwapAdapter(input: AdapterInput, apiKey: string): Promise<AdapterResult> {
  const ref = input.referenceImageUrls[0];
  const face = input.customerImageUrls[0];
  if (!ref || !face) {
    return { ok: false, status: 400, error: "face-swap needs 1 reference + 1 customer image" };
  }
  return toResult(
    await replicatePredict({
      apiKey,
      endpoint: PREDICTIONS_URL,
      body: { version: FACE_SWAP_VERSION, input: { input_image: ref, swap_image: face } },
      waitSeconds: 30,
      deadlineMs: 90_000,
    }),
  );
}

async function aiEditAdapter(input: AdapterInput, apiKey: string): Promise<AdapterResult> {
  // References first, then the customer image(s) — so "image #1" is the scene and
  // "image #2" the customer photo, matching the prompt conventions.
  const images = [...input.referenceImageUrls, ...input.customerImageUrls];
  if (images.length === 0) return { ok: false, status: 400, error: "ai-edit needs at least one image" };
  const modelInput: Record<string, unknown> = {
    prompt: input.prompt ?? "",
    image_input: images,
    output_format: input.params?.outputFormat ?? "png",
  };
  const aspect = mapAspect(input.params?.aspectRatio);
  if (aspect) modelInput.aspect_ratio = aspect;
  return toResult(
    await replicatePredict({
      apiKey,
      endpoint: NANO_BANANA_URL,
      body: { input: modelInput },
      waitSeconds: 55,
      deadlineMs: 60_000,
    }),
  );
}

async function artStyleAdapter(input: AdapterInput, apiKey: string): Promise<AdapterResult> {
  const img = input.customerImageUrls[0] ?? input.referenceImageUrls[0];
  if (!img) return { ok: false, status: 400, error: "art-style needs one image" };
  return toResult(
    await replicatePredict({
      apiKey,
      endpoint: FLUX_KONTEXT_URL,
      body: {
        input: {
          input_image: img,
          prompt: input.prompt ?? "",
          output_format: input.params?.outputFormat ?? "jpg",
          aspect_ratio: mapAspect(input.params?.aspectRatio) ?? "match_input_image",
          safety_tolerance: 2,
        },
      },
      waitSeconds: 30,
      deadlineMs: 60_000,
    }),
  );
}

async function cutoutAdapter(input: AdapterInput, apiKey: string): Promise<AdapterResult> {
  const img = input.customerImageUrls[0] ?? input.referenceImageUrls[0];
  if (!img) return { ok: false, status: 400, error: "cutout needs one image" };
  return toResult(
    await replicatePredict({
      apiKey,
      endpoint: PREDICTIONS_URL,
      body: { version: BG_REMOVER_VERSION, input: { image: img, format: "png", background_type: "rgba" } },
      waitSeconds: 30,
      deadlineMs: 60_000,
    }),
  );
}

const ADAPTERS: Record<ModelId, (input: AdapterInput, apiKey: string) => Promise<AdapterResult>> = {
  "face-swap": faceSwapAdapter,
  "ai-edit": aiEditAdapter,
  "art-style": artStyleAdapter,
  cutout: cutoutAdapter,
};

// ── Executor ─────────────────────────────────────────────────────────────────

export interface ExecStep {
  model: ModelId;
  prompt?: string;
  params?: RecipeParams;
  input: "previous" | "customer" | "reference";
}
export interface ExecRecipe {
  model: ModelId;
  prompt?: string;
  params?: RecipeParams;
  steps?: ExecStep[];
}
export interface RecipeInputs {
  customerImageUrls: string[];
  referenceImageUrls: string[];
  /** customerOption values keyed by their `injectAs` placeholder. */
  optionValues?: Record<string, string>;
}

/** Replace `{token}` placeholders from customerOption values. Unknown tokens are
 *  left as-is (they may be conceptual, like "image #1"). */
function fillPrompt(prompt: string | undefined, opts?: Record<string, string>): string | undefined {
  if (!prompt || !opts) return prompt;
  return prompt.replace(/\{(\w+)\}/g, (m, key) => (key in opts ? opts[key] : m));
}

export async function runRecipe(
  recipe: ExecRecipe,
  inputs: RecipeInputs,
  apiKey: string,
): Promise<AdapterResult> {
  const adapter = ADAPTERS[recipe.model];
  if (!adapter) return { ok: false, status: 400, error: `unknown model: ${recipe.model}` };

  let result = await adapter(
    {
      prompt: fillPrompt(recipe.prompt, inputs.optionValues),
      customerImageUrls: inputs.customerImageUrls,
      referenceImageUrls: inputs.referenceImageUrls,
      params: recipe.params,
    },
    apiKey,
  );
  if (!result.ok) return result;

  for (const step of recipe.steps ?? []) {
    const stepAdapter = ADAPTERS[step.model];
    if (!stepAdapter) return { ok: false, status: 400, error: `unknown step model: ${step.model}` };
    const stepInput: AdapterInput = {
      prompt: fillPrompt(step.prompt, inputs.optionValues),
      params: step.params,
      customerImageUrls:
        step.input === "previous" ? [result.outputUrl]
        : step.input === "customer" ? inputs.customerImageUrls
        : [],
      referenceImageUrls: step.input === "reference" ? inputs.referenceImageUrls : [],
    };
    result = await stepAdapter(stepInput, apiKey);
    if (!result.ok) return result;
  }
  return result;
}
