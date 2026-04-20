// Edge function: applicera AI-stil på bild via Replicate Flux Kontext Pro
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN");
    if (!REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN not configured");

    const { imageUrl, prompt } = await req.json();
    if (!imageUrl || !prompt) {
      return new Response(JSON.stringify({ error: "imageUrl and prompt required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Starta prediction
    const start = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "wait=30",
      },
      body: JSON.stringify({
        input: {
          input_image: imageUrl,
          prompt,
          output_format: "jpg",
          aspect_ratio: "match_input_image",
          safety_tolerance: 2,
        },
      }),
    });

    let prediction = await start.json();
    if (!start.ok) {
      console.error("Replicate start failed", prediction);
      throw new Error(prediction?.detail || "Replicate request failed");
    }

    // Polla om inte klar
    const deadline = Date.now() + 60_000;
    while (
      prediction.status !== "succeeded" &&
      prediction.status !== "failed" &&
      prediction.status !== "canceled" &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 1500));
      const poll = await fetch(prediction.urls.get, {
        headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
      });
      prediction = await poll.json();
    }

    if (prediction.status !== "succeeded") {
      throw new Error(`Replicate ${prediction.status}: ${prediction.error || "timeout"}`);
    }

    const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    return new Response(JSON.stringify({ output }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("replicate-style error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
