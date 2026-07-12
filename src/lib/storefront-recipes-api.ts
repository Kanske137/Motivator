// Storefront-side recipe resolution for the customer editor.
//
// A media-layer binding holds only a recipe id. Built-ins live in code and always
// resolve; a shop's SAVED recipes live in `ai_recipes`, which the browser can't
// read (RLS). This calls the public, shop-scoped `storefront-recipes` edge fn to
// fetch the saved recipes a template needs, so a layer bound to a custom recipe
// resolves and renders. (Published templates can instead embed the recipes — see
// shopify-sync-template — and skip this call.)
import { supabase } from "@/integrations/supabase/client";
import type { AiRecipe } from "./ai-recipe";

/** Walk a parsed template and collect every media layer's bound recipe id.
 *  Structure-agnostic (defaultLayout / canvasLayout / extraLayouts, both
 *  orientations) — just finds photo layers with an `.ai.recipeId`. */
export function collectRecipeIds(template: unknown): string[] {
  const ids = new Set<string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      const ai = (o.defaults as { ai?: { recipeId?: string } } | undefined)?.ai;
      if (o.type === "photo" && ai?.recipeId) ids.add(ai.recipeId);
      Object.values(o).forEach(walk);
    }
  };
  walk(template);
  return [...ids];
}

/** Resolve the shop's saved (non-builtin) recipes by id. Returns [] on any
 *  failure or when there is nothing to resolve — built-ins keep working. */
export async function resolveStorefrontRecipes(
  shop: string | null,
  recipeIds: string[],
): Promise<AiRecipe[]> {
  const ids = recipeIds.filter((id) => id && !id.startsWith("builtin-"));
  if (ids.length === 0) return [];
  try {
    // `shop` is optional: when present the endpoint scopes to that installation,
    // otherwise it resolves the (unguessable-uuid, non-sensitive) recipe ids
    // directly. Without this the editor falls back to the stale embedded snapshot
    // whenever there's no ?shop= in the URL, so recipe edits wouldn't show until
    // the template was re-saved.
    const { data, error } = await supabase.functions.invoke("storefront-recipes", {
      body: { shop: shop ?? null, recipeIds: ids },
    });
    if (error) {
      console.warn("[storefront-recipes] resolve failed:", error.message);
      return [];
    }
    return (data as { recipes?: AiRecipe[] })?.recipes ?? [];
  } catch (e) {
    console.warn("[storefront-recipes] resolve threw:", e);
    return [];
  }
}
