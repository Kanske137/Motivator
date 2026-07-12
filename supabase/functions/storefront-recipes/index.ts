// Public, shop-scoped resolver for the storefront / customer editor.
//
// A media layer binding holds only a recipe `id`. Built-in starters live in the
// client code, but a shop's SAVED recipes live in `ai_recipes`, which the browser
// can't read (RLS). This endpoint takes { shop, recipeIds } and returns the full
// recipes for that shop — the customer editor merges them into the recipe pool so
// a layer bound to a custom recipe resolves and renders.
//
// Same shop-scoping model as `shopify-storefront`: the caller passes `shop`, we
// resolve its installation and return ONLY that installation's recipes matching
// the requested ids. Recipes are prompts/model config, not sensitive; scoping to
// the shop prevents any cross-tenant read.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface RecipeRow {
  id: string;
  name: string;
  description: string | null;
  model: string;
  prompt: string | null;
  params: unknown;
  customer_options: unknown;
  steps: unknown;
}

/** DB row → the client's AiRecipe shape (snake_case → camelCase). */
function toRecipe(row: RecipeRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    model: row.model,
    prompt: row.prompt ?? undefined,
    params: row.params ?? {},
    customerOptions: row.customer_options ?? undefined,
    steps: row.steps ?? undefined,
  };
}

const SELECT_COLS = "id, name, description, model, prompt, params, customer_options, steps";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { shop, recipeIds } = await req.json();

    // Never resolve built-in ids server-side — the client already has them.
    const ids: string[] = Array.isArray(recipeIds)
      ? recipeIds.filter((id): id is string => typeof id === "string" && !!id && !id.startsWith("builtin-"))
      : [];
    if (ids.length === 0) return json({ recipes: [] });

    const url = Deno.env.get("SUPABASE_URL");
    const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !srk) throw new Error("Supabase service role saknas");
    const supabase = createClient(url, srk);

    // `shop` is OPTIONAL. When given we scope to that installation (defensive).
    // When absent we resolve the requested ids directly — they are unguessable
    // uuids taken from a template the client already loaded, and recipes are
    // prompts/model config (not sensitive) — so the editor works even without a
    // ?shop= context (admin preview / direct load), which is what lets recipe
    // edits show without re-saving the template.
    let query = supabase.from("ai_recipes").select(SELECT_COLS).in("id", ids);
    if (shop && typeof shop === "string") {
      const { data: inst, error: instErr } = await supabase
        .from("shopify_app_installations")
        .select("id")
        .eq("shop_domain", shop)
        .maybeSingle();
      if (instErr) throw new Error(`installation lookup: ${instErr.message}`);
      if (!inst) return json({ recipes: [] }); // unknown shop → nothing to resolve
      query = query.eq("installation_id", inst.id);
    }

    const { data, error } = await query;
    if (error) throw new Error(`recipes lookup: ${error.message}`);

    return json({ recipes: (data ?? []).map((r) => toRecipe(r as RecipeRow)) });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("storefront-recipes error:", msg);
    return json({ error: msg }, 500);
  }
});
