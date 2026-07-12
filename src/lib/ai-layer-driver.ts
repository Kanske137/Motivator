// One normalized "driver" for the customer AI section, produced from EITHER
// path so the UI never branches on layer type:
//   - a photo layer with an `.ai` recipe binding (the new, unified media layer), or
//   - a legacy `aiPhoto` layer with `subjectKind` + flags.
//
// The section reads a driver: which style choices to show, whether an admin
// reference is needed, the motif, and a `resolve(styleId, refUrl)` that returns
// the recipe to POST + its option values + the cache slot. Binding vs legacy
// differ only in HOW the recipe is chosen (fixed by id vs picked per style); the
// upload / cache / generate machinery downstream is identical.
import {
  MODEL_CATALOG,
  resolveBindingRecipe,
  type AiRecipe,
} from "./ai-recipe";
import { resolveLegacyRecipe, aiRecipeCacheSlot } from "./legacy-ai-recipe";
import type { TemplateLayer, AiStylePreset } from "./template-schema";

type MediaLayer = Extract<TemplateLayer, { type: "photo" | "aiPhoto" }>;

export type Orientation = "portrait" | "landscape";

export interface DriverStyleChoice {
  id: string;
  label: string;
  thumbnailUrl?: string;
}

export interface DriverReference {
  id: string;
  url: string;
  label?: string;
  orientation: "portrait" | "landscape" | "any";
}

export interface AiRun {
  recipe: AiRecipe;
  optionValues: Record<string, string>;
  slot: string;
}

export interface AiLayerDriver {
  /** Does the recipe consume an admin reference image (face-swap / pet)? When
   *  true the customer must have a reference selected before generating. */
  needsReference: boolean;
  /** Admin references for this orientation (subject picker + what we POST). */
  references: DriverReference[];
  /** Style choices for the customer picker (empty = no style option). */
  styleChoices: DriverStyleChoice[];
  /** Fills the reserved `{motif}` token. */
  motif?: string;
  /** i18n key for the upload hint, or undefined for a neutral prompt. */
  hintKey?: string;
  /** Resolve the recipe to POST, its option values and the cache slot for a
   *  chosen style + reference. Single source of truth for run + thumbnail keys. */
  resolve: (styleId: string | null, refUrl: string | null) => AiRun;
}

/** Refs tagged "any" (or missing the field on legacy data) show in both
 *  orientations. */
function forOrientation(refs: DriverReference[], orientation: Orientation): DriverReference[] {
  return refs.filter((r) => (r.orientation ?? "any") === "any" || r.orientation === orientation);
}

/** Legacy aiPhoto references: the `referenceImages[]` list, falling back to the
 *  single legacy `referenceImageUrl` so old templates keep working. */
function legacyReferences(layer: Extract<TemplateLayer, { type: "aiPhoto" }>): DriverReference[] {
  const list = layer.defaults.referenceImages ?? [];
  if (list.length > 0) {
    return list.map((r) => ({
      id: r.id,
      url: r.url,
      label: r.label,
      orientation: (r as { orientation?: DriverReference["orientation"] }).orientation ?? "any",
    }));
  }
  if (layer.defaults.referenceImageUrl) {
    return [{ id: "legacy", url: layer.defaults.referenceImageUrl, orientation: "any" }];
  }
  return [];
}

/** Build the driver, or null when the layer is a plain photo (no recipe) — i.e.
 *  not an AI layer and nothing for the AI section to render. */
export function buildAiLayerDriver(
  layer: MediaLayer,
  aiStylePresets: AiStylePreset[] | undefined,
  orientation: Orientation,
): AiLayerDriver | null {
  // ── Binding path: a photo layer that points at a recipe. ──────────────────
  const binding = layer.type === "photo" ? layer.defaults.ai : undefined;
  const bound = resolveBindingRecipe(binding);
  if (bound) {
    const { recipe, styleOption, motif } = bound;
    const references = forOrientation(
      bound.references.map((r) => ({ id: r.id, url: r.url, label: r.label, orientation: r.orientation })),
      orientation,
    );
    // face-swap requires a reference by catalog; a recipe the merchant bound
    // references to (e.g. pet) also uses them.
    const needsReference =
      MODEL_CATALOG[recipe.model].referenceImages.min > 0 || references.length > 0;
    const styleChoices: DriverStyleChoice[] = (styleOption?.choices ?? []).map((c) => ({
      id: c.id,
      label: c.label,
      thumbnailUrl: c.thumbnailUrl,
    }));
    const resolve = (styleId: string | null, refUrl: string | null): AiRun => {
      const optionValues: Record<string, string> = {};
      if (styleOption && styleId) {
        const choice = styleOption.choices.find((c) => c.id === styleId);
        if (choice) optionValues[styleOption.injectAs] = choice.value;
      }
      const slot = aiRecipeCacheSlot({
        recipeId: recipe.id,
        optionValues,
        motif,
        referenceImageUrl: needsReference ? refUrl : null,
      });
      return { recipe, optionValues, slot };
    };
    return { needsReference, references, styleChoices, motif, hintKey: undefined, resolve };
  }

  // ── Legacy path: an aiPhoto layer with subjectKind + flags. ───────────────
  if (layer.type === "aiPhoto") {
    const subjectKind = layer.defaults.subjectKind ?? "human";
    const isRemoveBg = subjectKind === "removeBackground";
    const simpleStyleMode = isRemoveBg && layer.defaults.simpleStyleMode === true;
    const motif = layer.defaults.fluxStylePrompt ?? undefined;
    const references = forOrientation(legacyReferences(layer), orientation);
    const presets = (aiStylePresets ?? []).filter((p) => p.enabled !== false);
    const styleChoices: DriverStyleChoice[] = isRemoveBg
      ? presets.map((p) => ({ id: p.id, label: p.label, thumbnailUrl: p.thumbnailUrl }))
      : [];
    const resolve = (styleId: string | null, refUrl: string | null): AiRun => {
      const preset = isRemoveBg && styleId ? presets.find((p) => p.id === styleId) ?? null : null;
      const { recipe, optionValues } = resolveLegacyRecipe({
        subjectKind,
        simpleStyleMode,
        style: preset
          ? { prompt: preset.prompt, styleInstruction: preset.styleInstruction, bridge: preset.bridge, label: preset.label }
          : null,
      });
      const slot = aiRecipeCacheSlot({
        recipeId: recipe.id,
        optionValues,
        motif,
        referenceImageUrl: isRemoveBg ? null : refUrl,
      });
      return { recipe, optionValues, slot };
    };
    const hintKey =
      subjectKind === "pet"
        ? "aiPhoto.subjectHintPet"
        : isRemoveBg
          ? "aiPhoto.subjectHintRemoveBg"
          : "aiPhoto.subjectHintHuman";
    return { needsReference: !isRemoveBg, references, styleChoices, motif, hintKey, resolve };
  }

  // Plain photo with no binding → not an AI layer.
  return null;
}
