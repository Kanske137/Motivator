// Edge function: applicera AI-stil på bild via Replicate Flux Kontext Pro.
// Output laddas upp till `print-files` bucket DIREKT så att klienten har en
// färdig print-URL att skicka in i Shopify cart properties (single pipeline).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { replicatePredict } from "../_shared/replicate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN");
    if (!REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN not configured");

    const { imageUrl, prompt, designId } = await req.json();
    if (!imageUrl || !prompt) {
      return new Response(JSON.stringify({ error: "imageUrl and prompt required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Adapter: Flux Kontext Pro via the shared prediction runner.
    const res = await replicatePredict({
      apiKey: REPLICATE_API_TOKEN,
      endpoint: "https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions",
      body: {
        input: {
          input_image: imageUrl,
          prompt,
          output_format: "jpg",
          aspect_ratio: "match_input_image",
          safety_tolerance: 2,
        },
      },
      waitSeconds: 30,
      deadlineMs: 60_000,
    });
    if (!res.ok) throw new Error(`Replicate ${res.stage}: ${res.error}`);
    const output = res.outputUrl;

    // Pass-through to print-files bucket so the client can use the public URL
    // directly as `_print_file_url` in the Shopify cart.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const id = (designId && typeof designId === "string" ? designId : crypto.randomUUID());
    const path = `${id}.jpg`;

    const { error: upErr } = await supabase.storage
      .from("print-files")
      .upload(path, res.bytes, { contentType: "image/jpeg", upsert: true });
    if (upErr) throw new Error(`Print upload failed: ${upErr.message}`);

    const { data: pub } = supabase.storage.from("print-files").getPublicUrl(path);
    const printFileUrl = pub.publicUrl;

    return new Response(
      JSON.stringify({ output, previewUrl: output, printFileUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("replicate-style error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
