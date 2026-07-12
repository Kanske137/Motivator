// Edge function: the AI image executor for the editor's media (photo) layers.
// The client always sends a `recipe` (an AiRecipe resolved from the layer's
// binding); this runs it through the generic `runRecipe` executor and uploads
// the result to `print-files`. The legacy subjectKind routing (human / pet /
// removeBackground and its bespoke model functions) is retired — every AI edit
// is now a recipe.
//
// Inputs (JSON body):
//   recipe             — the AiRecipe to run (model + prompt + params + steps)
//   customerImageUrls  — the customer's uploaded photo(s); falls back to the
//                        legacy single `faceImageUrl`
//   referenceImageUrls — admin reference image(s); falls back to `referenceImageUrl`
//   optionValues       — customer choices keyed by their `{token}` (e.g. style)
//   motif              — reserved `{motif}` value from the layer binding
//   designId           — used for the output filename
//
// Always returns HTTP 200. On recoverable errors the body is
// { error, fallback: true, userMessage } so the client can show a friendly
// toast instead of crashing on a non-2xx.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { replicatePredict } from "../_shared/replicate.ts";
import { runRecipe, type ExecRecipe } from "../_shared/ai-models.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fallbackResponse(userMessage: string, internal: string) {
  console.error(`[face-swap] fallback: ${internal}`);
  return jsonResponse({
    error: internal,
    fallback: true,
    userMessage,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const referenceImageUrl: string | undefined = body?.referenceImageUrl;
    const faceImageUrl: string | undefined = body?.faceImageUrl;
    const designId: string =
      typeof body?.designId === "string" ? body.designId : crypto.randomUUID();

    // ── Recipe executor path — the only path. The client always sends a
    //    `recipe`; a request without one is a bug (handled below). ─────────────
    if (body?.recipe && typeof body.recipe === "object") {
      const RECIPE_TOKEN = Deno.env.get("REPLICATE_API_TOKEN");
      if (!RECIPE_TOKEN) {
        return fallbackResponse(
          "Tjänsten är tillfälligt otillgänglig. Försök igen senare.",
          "REPLICATE_API_TOKEN not configured (recipe)",
        );
      }
      const customerImageUrls: string[] = Array.isArray(body.customerImageUrls)
        ? body.customerImageUrls.filter((u: unknown) => typeof u === "string")
        : faceImageUrl ? [faceImageUrl] : [];
      const referenceImageUrls: string[] = Array.isArray(body.referenceImageUrls)
        ? body.referenceImageUrls.filter((u: unknown) => typeof u === "string")
        : referenceImageUrl ? [referenceImageUrl] : [];
      const optionValues: Record<string, string> =
        body.optionValues && typeof body.optionValues === "object" ? body.optionValues : {};
      // `motif` describes what the customer's photo depicts, from the layer
      // binding. Reserved (not a customer choice); the executor injects it at
      // `{motif}`. Load-bearing for the nano starters — without it a
      // background-removal recipe keeps the whole scene.
      const motif: string | undefined =
        typeof body.motif === "string" ? body.motif : undefined;

      const recipe = body.recipe as ExecRecipe;
      console.log(
        `[face-swap] recipe run model=${recipe.model} steps=${recipe.steps?.length ?? 0} ` +
          `customer=${customerImageUrls.length} ref=${referenceImageUrls.length} ` +
          `motif=${motif ? "set" : "none"} designId=${designId}`,
      );
      const rec = await runRecipe(
        recipe,
        { customerImageUrls, referenceImageUrls, optionValues, motif },
        RECIPE_TOKEN,
      );
      if (!rec.ok) {
        return fallbackResponse(
          "Vi kunde inte skapa bilden den här gången. Försök igen.",
          `recipe ${recipe.model}: ${rec.error}`,
        );
      }
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const ext = rec.contentType.includes("png") ? "png" : "jpg";
      const path = `${designId}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("print-files")
        .upload(path, rec.bytes, { contentType: rec.contentType, upsert: true });
      if (upErr) {
        return fallbackResponse(
          "Vi kunde inte spara den genererade bilden. Försök igen.",
          `recipe upload failed: ${upErr.message}`,
        );
      }
      const { data: pub } = supabase.storage.from("print-files").getPublicUrl(path);
      const printFileUrl = pub.publicUrl;
      return jsonResponse({
        output: printFileUrl,
        previewUrl: printFileUrl,
        printFileUrl,
        replicateOutputUrl: rec.outputUrl,
        modelUsed: recipe.model,
        route: "recipe",
      });
    }

    // The client always sends a `recipe`; the legacy subjectKind path is gone.
    return fallbackResponse(
      "Vi kunde inte skapa bilden. Försök igen.",
      "replicate-face-swap requires a `recipe` in the request body",
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[face-swap] error:", msg);
    return fallbackResponse(
      "Något gick fel. Försök igen om en stund.",
      msg,
    );
  }
});
