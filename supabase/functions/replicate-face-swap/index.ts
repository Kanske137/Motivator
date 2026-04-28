// Edge function: face-swap a customer's uploaded face onto an admin-curated
// reference image (e.g. king/princess/etc) via Replicate.
//
// Model: `cdingram/face-swap` — two-input face-swap model. Returns a single
// composited image with the swap applied. Output is uploaded to print-files
// so the client gets a stable public URL ready for Shopify cart properties.
//
// Inputs:
//   referenceImageUrl  — admin's curated body/scene image (face source target)
//   faceImageUrl       — customer's selfie (face that gets pasted)
//   prompt             — admin's free-text instruction (logged for debugging /
//                        future prompt-aware models; not all swap models use it)
//   subjectKind        — human | cat | dog | other (logged + may switch model)
//   designId           — used for the output filename
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// cdingram/face-swap is a stable face-swap model on Replicate. It takes two
// image inputs and pastes the face from `swap_image` onto `input_image`. It
// works well for human faces and reasonably for animals.
const FACE_SWAP_MODEL_VERSION =
  "d1d6ea8c8be89d664a07a457526f7128109dee7030fdac424788d762c71ed111";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN");
    if (!REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN not configured");

    const body = await req.json();
    const referenceImageUrl: string | undefined = body?.referenceImageUrl;
    const faceImageUrl: string | undefined = body?.faceImageUrl;
    const prompt: string = typeof body?.prompt === "string" ? body.prompt : "";
    const subjectKind: string =
      typeof body?.subjectKind === "string" ? body.subjectKind : "human";
    const designId: string =
      typeof body?.designId === "string" ? body.designId : crypto.randomUUID();

    if (!referenceImageUrl || !faceImageUrl) {
      return new Response(
        JSON.stringify({ error: "referenceImageUrl and faceImageUrl required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(
      `[face-swap] start subjectKind=${subjectKind} designId=${designId} prompt="${prompt.slice(0, 80)}"`,
    );

    // Kick off prediction. `input_image` is the scene the face gets pasted
    // INTO; `swap_image` is the customer's face source.
    const start = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "wait=30",
      },
      body: JSON.stringify({
        version: FACE_SWAP_MODEL_VERSION,
        input: {
          input_image: referenceImageUrl,
          swap_image: faceImageUrl,
        },
      }),
    });

    let prediction = await start.json();
    if (!start.ok) {
      console.error("[face-swap] start failed", prediction);
      throw new Error(prediction?.detail || "Replicate request failed");
    }

    // Poll until done (Prefer: wait=30 means we usually already have a final
    // result, but keep this loop for slower runs).
    const deadline = Date.now() + 90_000;
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
      throw new Error(
        `Replicate ${prediction.status}: ${prediction.error || "timeout"}`,
      );
    }

    const output = Array.isArray(prediction.output)
      ? prediction.output[0]
      : prediction.output;
    if (!output) throw new Error("Replicate succeeded but produced no output URL");

    // Upload to print-files so the customer gets a stable public URL.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const path = `${designId}.jpg`;
    const imgRes = await fetch(output);
    if (!imgRes.ok) throw new Error(`Replicate image fetch failed ${imgRes.status}`);
    const imgBlob = await imgRes.blob();

    const { error: upErr } = await supabase.storage
      .from("print-files")
      .upload(path, imgBlob, { contentType: "image/jpeg", upsert: true });
    if (upErr) throw new Error(`Print upload failed: ${upErr.message}`);

    const { data: pub } = supabase.storage.from("print-files").getPublicUrl(path);
    const printFileUrl = pub.publicUrl;
    console.log(`[face-swap] done → ${printFileUrl}`);

    return new Response(
      JSON.stringify({ output, previewUrl: output, printFileUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[face-swap] error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
