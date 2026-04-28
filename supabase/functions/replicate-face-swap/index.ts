// Edge function: face-swap a customer's uploaded face onto an admin-curated
// reference image (e.g. king/princess/etc) via Replicate.
//
// IMPORTANT model choice:
// We previously used `flux-kontext-apps/multi-image-kontext-max` (a generic
// prompt-driven multi-image editor). It frequently produced a side-by-side
// collage of the two inputs instead of an actual face swap, even with strong
// "no collage" instructions. That model is not the right tool — it composes,
// it doesn't swap.
//
// We now use a dedicated face-swap model that has strict, structured inputs:
//   input_image (target) — the scene to keep (admin reference)
//   swap_image  (source) — the face to lift FROM (customer upload)
// Output: target image with source face blended in. No prompt, no collage.
//
// Inputs to this function:
//   referenceImageUrl  — admin's curated body/scene image (face TARGET)
//   faceImageUrl       — customer's selfie (face SOURCE)
//   prompt             — admin's free-text instruction (kept for logging only)
//   subjectKind        — human | cat | dog | other (logged; affects fallback)
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

// Dedicated face-swap model. Pinned to a specific version for stability.
// `cdingram/face-swap` accepts:
//   input_image: target image (face to be replaced lives here)
//   swap_image:  source image (face to lift FROM)
// Source: https://replicate.com/cdingram/face-swap
const FACE_SWAP_MODEL_VERSION =
  "cdingram/face-swap:d1d6ea8c8be89d664a07a457526f7128109dee7030fdac424788d762c71ed111";

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

// Decode JPEG/PNG dimensions from a Uint8Array. Returns null when the format
// isn't recognised — we then skip the dimension sanity check.
function readImageSize(bytes: Uint8Array): { w: number; h: number } | null {
  // PNG: 8-byte signature, then IHDR with width/height as big-endian u32.
  if (
    bytes.length > 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  // JPEG: scan SOF markers for size.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      i += 2;
      if (marker === 0xd8 || marker === 0xd9) return null;
      const len = (bytes[i] << 8) | bytes[i + 1];
      // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        const h = (bytes[i + 3] << 8) | bytes[i + 4];
        const w = (bytes[i + 5] << 8) | bytes[i + 6];
        return { w, h };
      }
      i += len;
    }
  }
  return null;
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
      `[face-swap] start model=${FACE_SWAP_MODEL_VERSION.split(":")[0]} ` +
        `subjectKind=${subjectKind} designId=${designId} ` +
        `targetImage(input_image)=${referenceImageUrl} ` +
        `sourceImage(swap_image)=${faceImageUrl} ` +
        `adminPromptIgnored="${prompt.slice(0, 80)}"`,
    );

    // The dedicated face-swap model is trained primarily on human faces. For
    // cat/dog the swap quality is limited; we still try it, but log so we can
    // diagnose if the result looks off.
    if (subjectKind === "cat" || subjectKind === "dog") {
      console.warn(
        `[face-swap] subjectKind=${subjectKind} — this model is optimised for humans. ` +
          `Animal swaps may produce weak results.`,
      );
    }

    const start = await fetch(
      `https://api.replicate.com/v1/predictions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
          Prefer: "wait=30",
        },
        body: JSON.stringify({
          version: FACE_SWAP_MODEL_VERSION.split(":")[1],
          input: {
            // Target image: the scene/character to keep.
            input_image: referenceImageUrl,
            // Source image: the face to paste in (customer upload).
            swap_image: faceImageUrl,
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

    // Fetch the generated image and run a sanity check on its dimensions
    // before saving. If the output is suspiciously wide (e.g. >2x as wide as
    // tall) it's almost certainly a side-by-side collage; reject so we don't
    // show a broken result to the customer.
    const imgRes = await fetch(output);
    if (!imgRes.ok) {
      return fallbackResponse(
        "Vi kunde inte hämta den genererade bilden. Försök igen.",
        `Replicate image fetch failed ${imgRes.status}`,
      );
    }
    const imgBuf = new Uint8Array(await imgRes.arrayBuffer());
    const dims = readImageSize(imgBuf);
    if (dims) {
      const ratio = dims.w / Math.max(1, dims.h);
      console.log(`[face-swap] outputDimensions=${dims.w}x${dims.h} aspectRatio=${ratio.toFixed(2)}`);
      if (ratio > 2.2 || ratio < 0.45) {
        return fallbackResponse(
          "AI-modellen returnerade en ogiltig bild. Prova att skapa igen, eller använd en tydligare bild.",
          `Suspicious output dimensions ${dims.w}x${dims.h} — likely a collage`,
        );
      }
    }

    // Upload to print-files so the customer gets a stable public URL.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const path = `${designId}.jpg`;
    const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";

    const { error: upErr } = await supabase.storage
      .from("print-files")
      .upload(path, imgBuf, { contentType, upsert: true });
    if (upErr) {
      return fallbackResponse(
        "Vi kunde inte spara den genererade bilden. Försök igen.",
        `Print upload failed: ${upErr.message}`,
      );
    }

    const { data: pub } = supabase.storage.from("print-files").getPublicUrl(path);
    const printFileUrl = pub.publicUrl;
    console.log(
      `[face-swap] done → printFileUrl=${printFileUrl} replicateOutputUrl=${output}`,
    );

    return jsonResponse({
      output,
      previewUrl: output,
      printFileUrl,
      replicateOutputUrl: output,
      usedReferenceImageUrl: referenceImageUrl,
      usedFaceImageUrl: faceImageUrl,
      modelUsed: FACE_SWAP_MODEL_VERSION.split(":")[0],
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[face-swap] error:", msg);
    return fallbackResponse(
      "Något gick fel. Försök igen om en stund.",
      msg,
    );
  }
});
