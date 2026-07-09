// Client for the tenant-scoped `admin-ai-recipes` edge function.
//
// The browser never touches the ai_recipes table (RLS denies it) — every read
// and write goes through the session-token guard, like templates and pricing.

import { invokeAdmin } from "./admin-api";
import type { AiRecipe } from "./ai-recipe";

/** A recipe as stored for this shop. `id` is a uuid; built-ins are not in here. */
export type SavedRecipe = AiRecipe & { updatedAt?: string };

export async function listRecipes(): Promise<SavedRecipe[]> {
  const res = await invokeAdmin<{ recipes: SavedRecipe[] }>("list", {}, "admin-ai-recipes");
  return res.recipes ?? [];
}

/** Insert when `recipe.id` is absent or a `builtin-…` id (i.e. a clone). */
export async function saveRecipe(recipe: Partial<AiRecipe>): Promise<SavedRecipe> {
  const res = await invokeAdmin<{ recipe: SavedRecipe }>("save", { recipe }, "admin-ai-recipes");
  return res.recipe;
}

export async function deleteRecipe(id: string): Promise<void> {
  await invokeAdmin("delete", { id }, "admin-ai-recipes");
}

export interface TestRecipeInput {
  recipe: Partial<AiRecipe>;
  customerImageUrls: string[];
  referenceImageUrls: string[];
  optionValues?: Record<string, string>;
}

export interface TestRecipeResult {
  outputUrl: string;
  model: string;
  ms: number;
}

/** Runs the recipe through the SAME executor the customer path uses. */
export async function testRecipe(input: TestRecipeInput): Promise<TestRecipeResult> {
  const res = await invokeAdmin<TestRecipeResult & { ok: true }>(
    "test",
    { ...input },
    "admin-ai-recipes",
  );
  return { outputUrl: res.outputUrl, model: res.model, ms: res.ms };
}
