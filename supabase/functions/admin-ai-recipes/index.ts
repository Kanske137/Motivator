// Tenant-scoped CRUD for the shop's AI recipe library, plus a Test runner.
//
// Auth: header X-Shopify-Session-Token. Body: { action, ... }.
// Actions:
//   list                      -> { ok, recipes: AiRecipe[] }
//   save { recipe }           -> { ok, recipe }   (insert when recipe.id is absent)
//   delete { id }             -> { ok }
//   test { recipe, customerImageUrls, referenceImageUrls, optionValues }
//                             -> { ok, outputUrl, model, ms }
//
// The recipe shape mirrors src/lib/ai-recipe.ts (camelCase). The DB columns are
// snake_case, so this function is the only place that maps between them.
//
// `test` runs the SAME `runRecipe` executor the customer path uses, so what the
// merchant previews here is exactly what a customer would get. The output is the
// Replicate delivery URL (short-lived, fine for a preview) — nothing is written
// to storage, so testing never litters the print-files bucket.

import {
  AuthError,
  authErrorResponse,
  requireInstallation,
} from "../_shared/require-installation.ts";
import { runRecipe, type ExecRecipe, type ModelId } from "../_shared/ai-models.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-shopify-session-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const MODEL_IDS: ModelId[] = ["face-swap", "ai-edit", "art-style", "cutout"];

interface RecipeRow {
  id: string;
  name: string;
  description: string | null;
  model: string;
  prompt: string | null;
  params: unknown;
  customer_options: unknown;
  steps: unknown;
  updated_at: string;
}

/** DB row -> the client's AiRecipe shape. */
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
    updatedAt: row.updated_at,
  };
}

interface IncomingRecipe {
  id?: string;
  name?: string;
  description?: string;
  model?: string;
  prompt?: string;
  params?: Record<string, unknown>;
  customerOptions?: unknown;
  steps?: unknown;
}

/** Validate + normalise a recipe from the browser. Never trust it verbatim. */
function parseRecipe(input: unknown): { ok: true; value: Required<Pick<IncomingRecipe, "name" | "model">> & IncomingRecipe }
  | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "recipe krävs" };
  const r = input as IncomingRecipe;
  const name = r.name?.trim();
  if (!name) return { ok: false, error: "name krävs" };
  if (!r.model || !MODEL_IDS.includes(r.model as ModelId)) {
    return { ok: false, error: `okänd modell: ${r.model}` };
  }
  return { ok: true, value: { ...r, name, model: r.model } };
}

const SELECT_COLS = "id, name, description, model, prompt, params, customer_options, steps, updated_at";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let ctx;
  try {
    ctx = await requireInstallation(req);
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
    throw e;
  }
  const { installationId, supabase } = ctx;

  const body = (await req.json().catch(() => ({}))) as { action?: string } & Record<string, unknown>;
  const action = body.action;

  try {
    switch (action) {
      // ---- list ------------------------------------------------------------
      case "list": {
        const { data, error } = await supabase
          .from("ai_recipes")
          .select(SELECT_COLS)
          .eq("installation_id", installationId)
          .order("created_at");
        if (error) throw error;
        return json({ ok: true, recipes: (data ?? []).map((r) => toRecipe(r as RecipeRow)) });
      }

      // ---- save (insert when no id, else update this shop's row) -----------
      case "save": {
        const parsed = parseRecipe(body.recipe);
        if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
        const r = parsed.value;

        const row = {
          name: r.name,
          description: r.description?.trim() || null,
          model: r.model,
          prompt: r.prompt?.trim() || null,
          params: r.params ?? {},
          customer_options: r.customerOptions ?? null,
          steps: r.steps ?? null,
        };

        // A built-in starter's id ("builtin-…") is not a uuid — treat a save of
        // one as a clone, i.e. an insert.
        const isUpdate = typeof r.id === "string" && !r.id.startsWith("builtin-");

        if (isUpdate) {
          const { data, error } = await supabase
            .from("ai_recipes")
            .update({ ...row, updated_at: new Date().toISOString() })
            .eq("installation_id", installationId)
            .eq("id", r.id!)
            .select(SELECT_COLS)
            .maybeSingle();
          if (error) throw error;
          if (!data) return json({ ok: false, error: "Receptet finns inte" }, 404);
          return json({ ok: true, recipe: toRecipe(data as RecipeRow) });
        }

        const { data, error } = await supabase
          .from("ai_recipes")
          .insert({ ...row, installation_id: installationId })
          .select(SELECT_COLS)
          .maybeSingle();
        if (error) throw error;
        return json({ ok: true, recipe: toRecipe(data as RecipeRow) });
      }

      // ---- delete ----------------------------------------------------------
      case "delete": {
        const id = String((body as { id?: string }).id ?? "").trim();
        if (!id) return json({ ok: false, error: "id krävs" }, 400);
        const { error } = await supabase
          .from("ai_recipes")
          .delete()
          .eq("installation_id", installationId)
          .eq("id", id);
        if (error) throw error;
        return json({ ok: true });
      }

      // ---- test (run the recipe, return the model's output URL) ------------
      case "test": {
        const parsed = parseRecipe(body.recipe);
        if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
        const r = parsed.value;

        const apiKey = Deno.env.get("REPLICATE_API_TOKEN");
        if (!apiKey) return json({ ok: false, error: "REPLICATE_API_TOKEN saknas" }, 500);

        const urls = (v: unknown): string[] =>
          Array.isArray(v) ? v.filter((u): u is string => typeof u === "string" && !!u) : [];
        const customerImageUrls = urls(body.customerImageUrls);
        const referenceImageUrls = urls(body.referenceImageUrls);
        const optionValues =
          body.optionValues && typeof body.optionValues === "object"
            ? (body.optionValues as Record<string, string>)
            : {};

        if (customerImageUrls.length === 0 && referenceImageUrls.length === 0) {
          return json({ ok: false, error: "Ladda upp minst en bild att testa med" }, 400);
        }

        const recipe: ExecRecipe = {
          model: r.model as ModelId,
          prompt: r.prompt,
          params: r.params as ExecRecipe["params"],
          steps: r.steps as ExecRecipe["steps"],
        };

        const started = Date.now();
        console.log(
          `[admin-ai-recipes] test model=${recipe.model} steps=${recipe.steps?.length ?? 0} ` +
            `customer=${customerImageUrls.length} ref=${referenceImageUrls.length} shop=${ctx.shop}`,
        );
        const result = await runRecipe(
          recipe,
          { customerImageUrls, referenceImageUrls, optionValues },
          apiKey,
        );
        const ms = Date.now() - started;

        if (!result.ok) {
          console.error(`[admin-ai-recipes] test failed after ${ms}ms: ${result.error}`);
          return json({ ok: false, error: result.error }, 200);
        }
        return json({ ok: true, outputUrl: result.outputUrl, model: recipe.model, ms });
      }

      default:
        return json({ ok: false, error: `Okänd action: ${action}` }, 400);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[admin-ai-recipes] action=${action} failed:`, msg);
    return json({ ok: false, error: msg }, 500);
  }
});
