// Edge function: face-swap a customer's uploaded face onto an admin-curated
// reference image (e.g. king/princess/etc) via Replicate.
//
// Model: `flux-kontext-apps/face-swap` — a Kontext-based prompt-aware swap
// that handles humans AND animals (cats/dogs) much better than the older
// cdingram model, because it isn't gated by a strict human face detector.
// The admin's prompt is forwarded so behaviour can be tuned per template.
//
// Inputs:
//   referenceImageUrl  — admin's curated body/scene image (face source target)
//   faceImageUrl       — customer's selfie (face that gets pasted)
//   prompt             — admin's free-text instruction
//   subjectKind        — human | cat | dog | other (logged + used in prompt)
//   designId           — used for the output filename
//
// Always returns HTTP 200 with a JSON body. On recoverable errors the body
// contains { error, fallback: true, userMessage } so the client can show a
// friendly message instead of crashing on a non-2xx.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Prompt-aware multi-image Kontext model on Replicate. Accepts
// `input_image_1` (scene/character to keep), `input_image_2` (face/subject
// source) and a `prompt`. It is a general-purpose Kontext editor — NOT a
// face detector — so it works equally well for humans, cats and dogs.
// Officially hosted, predictable pricing (~$0.08/image).
const FACE_SWAP_MODEL = "flux-kontext-apps/multi-image-kontext-max";

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
    const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN");
    if (!REPLICATE_API_TOKEN) {
      return fallbackResponse(
        "Tjänsten är tillfälligt otillgänglig. Försök igen senare.",
        "REPLICATE_API_TOKEN not configured",
      );
    }

    const body = await req.json();
    const referenceImageUrl: string | undefined = body?.referenceImageUrl;
    const faceImageUrl: string | undefined = body?.faceImageUrl;
    const prompt: string = typeof body?.prompt === "string" ? body.prompt : "";
    const subjectKind: string =
      typeof body?.subjectKind === "string" ? body.subjectKind : "human";
    const designId: string =
      typeof body?.designId === "string" ? body.designId : crypto.randomUUID();

    if (!referenceImageUrl || !faceImageUrl) {
      return jsonResponse(
        { error: "referenceImageUrl and faceImageUrl required" },
        400,
      );
    }

    console.log(
      `[face-swap] start subjectKind=${subjectKind} designId=${designId} prompt="${prompt.slice(0, 80)}"`,
    );

    // Build the prompt sent to the model. The Kontext multi-image model
    // can be tricked into returning a side-by-side collage if the prompt
    // talks about "first image" / "second image". We instead phrase the
    // prompt as a single editing instruction and append a strict
    // "single edited image" guard so the model returns ONE picture.
    const subjectWord =
      subjectKind === "cat" ? "cat's" : subjectKind === "dog" ? "dog's" : "person's";
    const defaultPrompt =
      `Replace the ${subjectWord} face with the new face provided. ` +
      `Keep the original costume, pose, lighting and background exactly the same.`;
    const adminPrompt = prompt && prompt.trim().length > 0 ? prompt.trim() : defaultPrompt;
    const finalPrompt =
      `${adminPrompt} Output a single edited image only — do not return a collage, ` +
      `do not show the input images side by side, do not include any reference panels.`;

    const start = await fetch(
      `https://api.replicate.com/v1/models/${FACE_SWAP_MODEL}/predictions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
          Prefer: "wait=30",
        },
        body: JSON.stringify({
          input: {
            input_image_1: referenceImageUrl,
            input_image_2: faceImageUrl,
            prompt: finalPrompt,
            aspect_ratio: "match_input_image",
            output_format: "jpg",
            safety_tolerance: 2,
          },
        }),
      },
    );

    let prediction = await start.json();
    if (!start.ok) {
      console.error("[face-swap] start failed", prediction);
      return fallbackResponse(
        "Vi kunde inte skapa bilden just nu. Försök igen om en stund.",
        `Replicate start failed: ${prediction?.detail ?? start.status}`,
      );
    }

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
      const errStr = String(prediction.error ?? "").toLowerCase();
      const noFace =
        errStr.includes("no face") ||
        errStr.includes("face not detected") ||
        errStr.includes("could not detect");
      return fallbackResponse(
        noFace
          ? "Vi kunde inte hitta något ansikte i din bild. Prova en annan bild med tydligt ansikte och bra ljus."
          : "Vi kunde inte skapa bilden den här gången. Prova en annan bild eller försök igen.",
        `Replicate ${prediction.status}: ${prediction.error || "timeout"}`,
      );
    }

    const output = Array.isArray(prediction.output)
      ? prediction.output[0]
      : prediction.output;
    if (!output) {
      return fallbackResponse(
        "Vi kunde inte hitta något tydligt ansikte i din bild. Prova en annan bild med tydligt ansikte och bra ljus.",
        "Replicate succeeded but produced no output URL",
      );
    }

    // Upload to print-files so the customer gets a stable public URL.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const path = `${designId}.jpg`;
    const imgRes = await fetch(output);
    if (!imgRes.ok) {
      return fallbackResponse(
        "Vi kunde inte hämta den genererade bilden. Försök igen.",
        `Replicate image fetch failed ${imgRes.status}`,
      );
    }
    const imgBlob = await imgRes.blob();

    const { error: upErr } = await supabase.storage
      .from("print-files")
      .upload(path, imgBlob, { contentType: "image/jpeg", upsert: true });
    if (upErr) {
      return fallbackResponse(
        "Vi kunde inte spara den genererade bilden. Försök igen.",
        `Print upload failed: ${upErr.message}`,
      );
    }

    const { data: pub } = supabase.storage.from("print-files").getPublicUrl(path);
    const printFileUrl = pub.publicUrl;
    console.log(`[face-swap] done → ${printFileUrl}`);

    return jsonResponse({ output, previewUrl: output, printFileUrl });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[face-swap] error:", msg);
    return fallbackResponse(
      "Något gick fel. Försök igen om en stund.",
      msg,
    );
  }
});
