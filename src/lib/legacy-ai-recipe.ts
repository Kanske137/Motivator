// Legacy-mode → built-in recipe resolver.
//
// The customer editor is being cut over to send a `recipe` to the edge function
// instead of a dozen `subjectKind`-driven behaviour flags. Templates that predate
// explicit recipe bindings still carry only `subjectKind` (+ `simpleStyleMode` +
// the customer's selected style), so this module is the backward-compat bridge:
// it maps that legacy state onto one of the built-in recipes plus the executor's
// `optionValues`, exactly reproducing the routing in
// `supabase/functions/replicate-face-swap/index.ts`.
//
// New layers carry `layer.defaults.ai.recipeId` directly and skip this entirely.
//
// Pure + fully unit-tested (`legacy-ai-recipe.test.ts`) — the risky cutover's
// core, isolated from any UI so the mapping can be proven before it is wired.
import {
  type AiRecipe,
  BUILTIN_RECIPES,
  hasCutoutFinish,
  resolveStyleValue,
} from "./ai-recipe";

export type LegacySubjectKind = "human" | "pet" | "removeBackground";

/** The customer-selected style preset, in the shape the resolver needs. Mirrors
 *  the fields `replicate-face-swap` read off the selected `AiStylePreset`. */
export interface LegacyStyleSelection {
  prompt?: string | null;
  styleInstruction?: string | null;
  bridge?: string | null;
  label?: string | null;
}

export interface LegacyModeInput {
  subjectKind: LegacySubjectKind;
  /** `layer.defaults.simpleStyleMode` — routes removeBackground through the
   *  art-style→cutout chain instead of the Nano backdrop/watercolor paths. */
  simpleStyleMode?: boolean;
  /** The customer's chosen style preset — removeBackground only. */
  style?: LegacyStyleSelection | null;
}

export interface ResolvedLegacyRecipe {
  /** A `BUILTIN_RECIPES` entry — the transformation to send as `body.recipe`. */
  recipe: AiRecipe;
  /** customerOption values keyed by `injectAs`, e.g. `{ style: "<prompt>" }`.
   *  Empty for the reference-based modes (human/pet) that take no style. */
  optionValues: Record<string, string>;
}

/** Watercolor is the one style whose signature is a colourful splatter ring. The
 *  regex and the "no style picked = watercolor" default are lifted verbatim from
 *  the edge function's `isWatercolorStyle`. */
const WATERCOLOR_RE = /water\s*colou?r|akvarell|aquarelle/;

export function isWatercolorStyle(style?: LegacyStyleSelection | null): boolean {
  const prompt = style?.prompt?.trim();
  if (!prompt) return true; // default (no style picked) = watercolor dots
  const haystack = `${style?.prompt ?? ""} ${style?.label ?? ""}`.toLowerCase();
  return WATERCOLOR_RE.test(haystack);
}

/** The built-in recipe id a legacy `subjectKind` (+ flags) maps onto:
 *    human            → builtin-face-swap   (cdingram)
 *    pet              → builtin-pet         (nano ai-edit)
 *    removeBackground → one of three, matching runRemoveBackground's routing:
 *      simpleStyleMode + a usable style instruction/prompt → builtin-style-cutout
 *      watercolor style (or none picked)                   → builtin-nano-watercolor
 *      any other style                                     → builtin-nano-backdrop
 *  The simpleStyleMode gate mirrors the edge exactly: it only takes the chain
 *  when there is a non-empty styleInstruction OR stylePrompt; otherwise it falls
 *  back to the Nano path. */
export function legacyBuiltinRecipeId(input: LegacyModeInput): string {
  switch (input.subjectKind) {
    case "human":
      return "builtin-face-swap";
    case "pet":
      return "builtin-pet";
    case "removeBackground": {
      const instruction =
        input.style?.styleInstruction?.trim() || input.style?.prompt?.trim();
      if (input.simpleStyleMode && instruction) return "builtin-style-cutout";
      return isWatercolorStyle(input.style)
        ? "builtin-nano-watercolor"
        : "builtin-nano-backdrop";
    }
  }
}

const BUILTIN_BY_ID = new Map(BUILTIN_RECIPES.map((r) => [r.id, r] as const));

/** Resolve a legacy layer's mode + selected style into the recipe to send and
 *  the `{style}` value to inject. The `pick` (long prompt vs bridged terse
 *  instruction) is derived from the recipe itself — a cutout-finishing chain
 *  needs the terse instruction that survives the bg-remover, everything else
 *  takes the descriptive prompt — so it stays in lockstep with how
 *  `BUILTIN_RECIPES` builds the very same style option. */
export function resolveLegacyRecipe(input: LegacyModeInput): ResolvedLegacyRecipe {
  const id = legacyBuiltinRecipeId(input);
  const recipe = BUILTIN_BY_ID.get(id);
  if (!recipe) {
    throw new Error(`legacy resolver produced unknown builtin recipe id: ${id}`);
  }

  const optionValues: Record<string, string> = {};
  const styleOption = recipe.customerOptions?.find((o) => o.injectAs === "style");
  if (styleOption && input.style) {
    const pick = hasCutoutFinish(recipe) ? "styleInstruction" : "prompt";
    optionValues.style = resolveStyleValue(
      {
        prompt: input.style.prompt ?? "",
        styleInstruction: input.style.styleInstruction ?? undefined,
        bridge: input.style.bridge ?? undefined,
      },
      pick,
    );
  }

  return { recipe, optionValues };
}
